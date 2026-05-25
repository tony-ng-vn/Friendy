import { describe, expect, it } from "vitest";
import {
  composeClarificationReply,
  composeDeleteMemoryConfirmReply,
  composeDeleteMemoryDisambiguationReply,
  composeDeleteMemorySingleConfirmReply,
  composeDuplicateResolutionPrompt,
  composeIgnoreCandidateReply,
  composeListPeopleReply,
  composeOnboardingControlReply,
  composePendingContactsFooter,
  composePendingContactsInventoryReply,
  composeRuntimeStartupReply,
  composeNoMatchReply,
  composeSaveConfirmation,
  composeSaveConfirmationWithAdditionalMemoryPrompt,
  composeSearchReply,
  composeUpdateMemoryConfirmReply,
  composeUpdateMemoryDisambiguationReply
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

  it("formats non-ambiguous multi-person recall as context bullets", () => {
    const reply = composeSearchReply({
      matches: [
        searchResult(
          memory({ displayName: "Sarah Fan", eventTitle: "Photon Residency", contextNote: "met at Photon Residency" }),
          "matched: photon residency"
        ),
        searchResult(
          memory({ displayName: "Cecelia", eventTitle: "Photon Residency", contextNote: "met at Photon Residency" }),
          "matched: photon residency"
        )
      ],
      ambiguous: false
    });

    expect(reply).toBe(["I found 2 people:", "", "- Sarah Fan - Photon Residency", "- Cecelia - Photon Residency"].join("\n"));
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
    expect(saved).toContain("I'll remember Sarah Fah is the community lead.");
    expect(saved).not.toContain('"');
    expect(noMatch).toMatch(/I don't have enough/i);
    expect(clarification).toBe("What do you remember about them, like a name or event?");
    expect(ignored).toContain("Ignored Maya Chen");
    expect(noPendingIgnore).toMatch(/don't see a pending contact/i);

    [saved, noMatch, clarification, ignored, noPendingIgnore].forEach(expectNoInternalLanguage);
  });

  it("phrases first-person meeting context as a saved fact instead of echoing it", () => {
    const saved = composeSaveConfirmation({
      memories: [
        memory({
          displayName: "Z2",
          eventTitle: "AI dinner",
          contextNote: "I met them at AI dinner"
        })
      ]
    });

    expect(saved).toBe("Got it, saved Z2 from AI dinner. I'll remember you met Z2 at AI dinner.");
    expect(saved).not.toContain("I'll remember I met them");
  });

  it("appends the additional-memory follow-up question after save confirmation", () => {
    const text = composeSaveConfirmationWithAdditionalMemoryPrompt({
      memories: [
        memory({
          displayName: "Harold",
          contextNote: "my best friend at USF"
        })
      ],
      displayName: "Harold"
    });

    expect(text).toContain("Got it, saved Harold");
    expect(text).toContain("Anything else you want to remember about Harold?");
  });

  it("phrases short event-only context as a meeting fact", () => {
    expect(
      composeSaveConfirmation({
        memories: [
          memory({
            displayName: "Z4",
            eventTitle: "AI dinner",
            contextNote: "At AI dinner"
          })
        ]
      })
    ).toBe("Got it, saved Z4 from AI dinner. I'll remember you met Z4 at AI dinner.");

    expect(
      composeSaveConfirmation({
        memories: [
          memory({
            displayName: "Z5",
            eventTitle: "AI dinner",
            contextNote: "AI dinner in SF"
          })
        ]
      })
    ).toBe("Got it, saved Z5 from AI dinner. I'll remember you met Z5 at AI dinner in SF.");
  });

  it("formats filtered people lists with name and context bullets plus duplicate groups", () => {
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

    expect(reply).toBe(
      [
        "I remember these people from testing friendy:",
        "",
        "1. Testing 12 - Met them during testing Friendy",
        "2. Testing 1 - Testing Friendy",
        "",
        "I also see possible duplicates:",
        "",
        "- Testing 1 appears twice"
      ].join("\n")
    );
    expectNoInternalLanguage(reply);
  });

  it("numbers saved people so follow-up delete can refer to the visible row", () => {
    const reply = composeListPeopleReply({
      result: listPeopleResult({
        people: [
          { displayName: "Daniel", memories: [{ memoryId: "memory_daniel_hack", summary: "HackPrinceton, Photon CEO" }] },
          { displayName: "Daniel", memories: [{ memoryId: "memory_daniel_school", summary: "school/company: Photon" }] }
        ]
      })
    });

    expect(reply).toContain("1. Daniel - HackPrinceton, Photon CEO");
    expect(reply).toContain("2. Daniel - school/company: Photon");
    expect(reply).not.toContain("- Daniel -");
  });

  it("formats pending candidates without exposing candidate internals", () => {
    const reply = composeListPeopleReply({
      result: listPeopleResult({
        people: [],
        pendingCandidates: [{ candidateId: "candidate_testing_3", displayName: "Testing 3", status: "prompted" }]
      }),
      preferBullets: true
    });

    expect(reply).toBe(
      [
        "I don't have any saved people in Friendy memory yet.",
        "",
        "I also see pending contacts not saved as memories yet:",
        "",
        "- Testing 3"
      ].join("\n")
    );
    expect(reply).not.toContain("I still need context");
    expectNoInternalLanguage(reply);
  });

  it("formats duplicate-resolution prompts with all deterministic reply options", () => {
    const reply = composeDuplicateResolutionPrompt({ displayName: "Sarah Fan" });

    expect(reply).toContain("I already have Sarah Fan saved in Friendy memory");
    expect(reply).toContain("new Sarah Fan contact");
    expect(reply.toLowerCase()).toContain("reply same");
    expect(reply.toLowerCase()).toContain("different");
    expect(reply.toLowerCase()).toContain("ignore");
    expect(reply.toLowerCase()).toContain("not sure");
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

  it("keeps pending candidates visible when Apple Contacts listing is unsupported", () => {
    const reply = composeListPeopleReply({
      result: listPeopleResult({
        unsupportedSources: ["apple_contacts"],
        pendingCandidates: [
          {
            candidateId: "candidate_testing_3",
            displayName: "Testing 3",
            status: "prompted"
          }
        ]
      })
    });

    expect(reply).toBe(
      [
        "I don't have any saved people in Friendy memory yet.",
        "",
        "I also see pending contacts not saved as memories yet:",
        "",
        "- Testing 3",
        "",
        "Apple Contacts listing is not connected yet, so this is from Friendy memory only."
      ].join("\n")
    );
    expectNoInternalLanguage(reply);
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

  it("formats a pending contacts inventory reply", () => {
    expect(composePendingContactsInventoryReply({ candidates: [] })).toMatch(/do not see a pending contact/i);
    expect(composePendingContactsInventoryReply({ candidates: [{ displayName: "Testing 4" }] })).toBe(
      "Yes — I have 1 unsaved contact waiting: Testing 4."
    );
    expect(
      composePendingContactsInventoryReply({
        candidates: [{ displayName: "Testing 2" }, { displayName: "Testing 1" }]
      })
    ).toBe("Yes — I have 2 unsaved contacts waiting: Testing 2, Testing 1.");
  });

  it("formats a pending contacts footer with singular copy", () => {
    expect(
      composePendingContactsFooter({
        items: [{ displayName: "Sarah Fan" }]
      })
    ).toBe("Also, I still have 1 unsaved contact waiting for context:\n- Sarah Fan - what should I remember about them?");
  });

  it("formats a pending contacts footer with max three items and overflow", () => {
    expect(
      composePendingContactsFooter({
        items: [
          { displayName: "Testing 1" },
          { displayName: "Testing 2" },
          { displayName: "Testing 3" },
          { displayName: "Testing 4" }
        ]
      })
    ).toBe(
      [
        "Also, I still have 4 unsaved contacts waiting for context:",
        "- Testing 1 - what should I remember about them?",
        "- Testing 2 - what should I remember about them?",
        "- Testing 3 - what should I remember about them?",
        "and 1 more"
      ].join("\n")
    );
  });

  it("formats single-match delete confirmation without exposing memory ids", () => {
    const reply = composeDeleteMemorySingleConfirmReply({ displayName: "Unnamed Contact" });

    expect(reply).toBe("Do you want me to forget Unnamed Contact?\nReply yes to confirm or no to cancel.");
    expect(composeDeleteMemoryConfirmReply({ matches: [{ displayName: "Unnamed Contact" }] })).toBe(reply);
    expectNoInternalLanguage(reply);
  });

  it("formats multi-match delete disambiguation with numbered options", () => {
    const reply = composeDeleteMemoryDisambiguationReply({
      query: "Srah",
      options: [
        { displayName: "Sarah", detail: "met at Photon dinner" },
        { displayName: "Sara Kim", detail: "met at recruiting meetup" }
      ]
    });

    expect(reply).toBe(
      [
        'I found multiple possible matches for "Srah":',
        "1. Sarah - met at Photon dinner",
        "2. Sara Kim - met at recruiting meetup",
        "Which one do you want to delete, or should I delete both?"
      ].join("\n")
    );
    expectNoInternalLanguage(reply);
  });

  it("strips internal candidate ids from delete disambiguation options", () => {
    const reply = composeDeleteMemoryDisambiguationReply({
      query: "Noah Kostesku",
      options: [
        {
          displayName: "Noah Kostesku (candidate_noah_kostesku_1779655573000_484ee5a9_41cd_4a90_9203_a611c7877223_abperson)"
        },
        {
          displayName: "Noah Kostesku (candidate_noah_kostesku_1779655573000_16eec589_ec65_48d5_aaa1_832092dc797a_abperson)",
          detail: "candidate_noah_kostesku_1779655573000_16eec589_ec65_48d5_aaa1_832092dc797a_abperson"
        }
      ]
    });

    expect(reply).toBe(
      [
        "I found multiple people named Noah Kostesku:",
        "1. Noah Kostesku",
        "2. Noah Kostesku",
        "Which one do you want to delete, or should I delete both?"
      ].join("\n")
    );
    expectNoInternalLanguage(reply);
  });

  it("formats update confirmation and disambiguation copy", () => {
    const confirm = composeUpdateMemoryConfirmReply({
      displayName: "Sarah",
      proposedContextNote: "community lead at Photon"
    });
    const disambiguation = composeUpdateMemoryDisambiguationReply({
      query: "Srah",
      options: [
        { displayName: "Sarah", detail: "met at Photon dinner" },
        { displayName: "Sara Kim", detail: "met at recruiting meetup" }
      ]
    });

    expect(confirm).toBe(
      'I found Sarah. Update the note to "community lead at Photon"?\nReply yes to confirm or no to cancel.'
    );
    expect(disambiguation).toContain('I found two possible matches for "Srah":');
    expect(disambiguation).toContain("Reply 1 or 2, or say cancel.");
    [confirm, disambiguation].forEach(expectNoInternalLanguage);
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
  expect(reply.toLowerCase()).not.toContain("score");
  expect(reply).not.toContain("memory_");
  expect(reply).not.toContain("duplicate_");
  expect(reply).not.toContain("candidate_");
  expect(reply).not.toContain("same_display_name");
  expect(reply).not.toContain("similar_display_name");
  expect(reply).not.toContain("same_contact_method");
  expect(reply).not.toContain("pending_matches_saved");
  expect(reply).not.toContain("prompted");
}
