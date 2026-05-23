import { describe, expect, it } from "vitest";
import {
  composeClarificationReply,
  composeIgnoreCandidateReply,
  composeListPeopleReply,
  composeOnboardingControlReply,
  composeRuntimeStartupReply,
  composeNoMatchReply,
  composeSaveConfirmation,
  composeSearchReply
} from "./responseComposer";
import type { ListPeopleResult, MemorySearchResult } from "./tools";
import type { RelationshipMemory } from "./types";

describe("relationship response composer", () => {
  it("formats a grounded single-match reply without leaking search internals", () => {
    const reply = composeSearchReply({
      matches: [
        searchResult(
          memory({
            displayName: "Amaya",
            eventTitle: "Photon Residency II",
            contextNote:
              "event: Photon Residency II | User met Amaya and they shared a bed because they ran out of beds.",
            primaryContactLabel: "manual contact"
          }),
          'Your saved note says "..." and matched: bed.'
        )
      ]
    });

    expect(reply).toContain("I think that was Amaya");
    expect(reply).toContain("Photon Residency II");
    expect(reply.toLowerCase()).toContain("bed");
    expect(reply).toContain("I don't have a contact link saved yet.");
    expectNoInternalLanguage(reply);
  });

  it("formats multiple matches briefly and asks a narrowing question when confidence is close", () => {
    const reply = composeSearchReply({
      matches: [
        searchResult(memory({ displayName: "Amaya", eventTitle: "Photon Residency II", contextNote: "bed context" }), "matched: residency"),
        searchResult(
          memory({
            displayName: "Zhiyuan",
            eventTitle: "Photon Residency II",
            contextNote: "Swift project, CMU, clicky UI"
          }),
          "matched: residency"
        )
      ],
      ambiguous: true
    });

    expect(reply).toContain("Amaya");
    expect(reply).toContain("Zhiyuan");
    expect(reply).toMatch(/which one|which person|narrow/i);
    expectNoInternalLanguage(reply);
  });

  it("formats save, no-match, clarification, and ignore replies conversationally", () => {
    const saved = composeSaveConfirmation({
      memories: [
        memory({
          displayName: "Sarah Fah",
          eventTitle: "Photon Residency II",
          contextNote: "event: Photon Residency II | role: community lead"
        })
      ]
    });
    const noMatch = composeNoMatchReply();
    const clarification = composeClarificationReply("What do you remember about them, like a name or event?");
    const ignored = composeIgnoreCandidateReply({ candidateName: "Maya Chen" });
    const noPendingIgnore = composeIgnoreCandidateReply();

    expect(saved).toContain("Got it, saved Sarah Fah from Photon Residency II.");
    expect(saved).toContain("Sarah Fah");
    expect(saved).toContain("Photon Residency II");
    expect(saved).toContain("I'll remember they were the community lead.");
    expect(saved).not.toContain('"');
    expect(noMatch).toMatch(/I don't have enough/i);
    expect(clarification).toBe("What do you remember about them, like a name or event?");
    expect(ignored).toContain("Ignored Maya Chen");
    expect(noPendingIgnore).toMatch(/don't see a pending contact/i);

    [saved, noMatch, clarification, ignored, noPendingIgnore].forEach(expectNoInternalLanguage);
  });

  it("formats filtered people lists with bullets and duplicate groups", () => {
    const reply = composeListPeopleReply({
      result: listPeopleResult({
        appliedFilterLabel: "testing friendy",
        people: [
          { displayName: "Testing 12", memories: [{ memoryId: "memory_testing_12", summary: "Met them during testing Friendy" }] },
          {
            displayName: "Testing 1",
            memories: [{ memoryId: "memory_testing_1", summary: "Testing Friendy" }],
            duplicateGroupId: "duplicate_testing_1"
          }
        ],
        duplicateGroups: [
          {
            duplicateGroupId: "duplicate_testing_1",
            reason: "same_display_name",
            displayNames: ["Testing 1"],
            memoryIds: ["memory_testing_1", "memory_testing_1_retry"],
            pendingCandidateIds: []
          }
        ]
      }),
      preferBullets: true
    });

    expect(reply).toContain("I remember these people from testing friendy:");
    expect(reply).toContain("- Testing 12 - Met them during testing Friendy");
    expect(reply).toContain("- Testing 1 - Testing Friendy");
    expect(reply).toContain("I also see possible duplicates:");
    expect(reply).toContain("- Testing 1 appears twice");
    expectNoInternalLanguage(reply);
  });

  it("formats unsupported Apple Contacts source without pretending it checked contacts", () => {
    const reply = composeListPeopleReply({
      result: listPeopleResult({
        people: [],
        unsupportedSources: ["apple_contacts"]
      })
    });

    expect(reply).toBe("I can list people from Friendy memory right now. Apple Contacts listing is not connected yet.");
  });

  it("formats the foreground runtime startup message without technical language", () => {
    expect(composeRuntimeStartupReply()).toContain("Reply start");
    expect(composeRuntimeStartupReply()).not.toMatch(/sqlite|sensor|runtime/i);
  });

  it("formats start, pause, and resume control replies without technical language", () => {
    expect(composeOnboardingControlReply("started")).toBe(
      "Great. Friendy is on. Add a new contact on your Mac, and I'll ask before saving anything."
    );
    expect(composeOnboardingControlReply("paused")).toBe(
      'Contact memory is paused. I won\'t prompt you about new contacts until you reply "resume".'
    );
    expect(composeOnboardingControlReply("resumed")).toBe(
      "Friendy is back on. I'll ask before saving any new contact memories."
    );
  });
});

function memory(overrides: Partial<RelationshipMemory>): RelationshipMemory {
  return {
    id: `memory_${overrides.displayName ?? "person"}`,
    userId: "user_fixture",
    displayName: "Person",
    primaryContactLabel: "manual contact",
    contextNote: "met at an event",
    tags: [],
    confidence: 0.6,
    createdAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:00:00.000Z",
    ...overrides
  };
}

function searchResult(memoryValue: RelationshipMemory, reason: string, score = 6): MemorySearchResult {
  return {
    memory: memoryValue,
    reason,
    score
  };
}

function listPeopleResult(overrides: Partial<ListPeopleResult>): ListPeopleResult {
  return {
    people: [],
    duplicateGroups: [],
    pendingCandidates: [],
    ...overrides
  };
}

function expectNoInternalLanguage(reply: string) {
  expect(reply).not.toContain("matched:");
  expect(reply).not.toContain("Your saved note");
  expect(reply).not.toContain("manual contact");
  expect(reply).not.toContain("score");
}
