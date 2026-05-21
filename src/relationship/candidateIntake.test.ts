import { describe, expect, it } from "vitest";
import { fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent, fixtureUser } from "./fixtures";
import { createRelationshipRepository } from "./repository";
import { createRelationshipTools } from "./tools";
import type { CalendarEvent, ContactCandidateDetected } from "./types";

type CandidateIntakeModule = {
  createCandidateIntake(input: { tools: ReturnType<typeof createRelationshipTools> }): {
    createReviewableCandidates(input: {
      scope: CandidateIntakeScope;
      detectedContacts: ContactCandidateDetected[];
      calendarEvents: CalendarEvent[];
    }): CandidateIntakeCreateResult;
    resolveCandidateReply(input: {
      scope: CandidateIntakeScope;
      replyText: string;
    }): CandidateIntakeReplyResult;
    ignoreCandidate(input: {
      scope: CandidateIntakeScope;
      candidateId?: string;
      candidateName?: string;
    }): CandidateIntakeIgnoreResult;
  };
};

type CandidateIntakeScope = {
  userId: string;
  spaceId?: string;
};

type CandidateIntakeCreateResult = {
  kind: "reviewable_candidates_created";
  candidates: Array<{ id: string; displayName: string; status: "pending" }>;
  reviewPrompts: Array<{
    kind: "candidate_review";
    candidateId: string;
    displayName: string;
    eventGuess?: {
      eventId: string;
      title: string;
      confidence: number;
      rank: number;
    };
  }>;
};

type CandidateIntakeReplyResult =
  | {
      kind: "confirmed";
      candidateId: string;
      memory: { displayName: string; eventTitle?: string; contextNote: string };
    }
  | {
      kind: "ambiguous";
      candidates: Array<{ id: string; displayName: string }>;
    }
  | {
      kind: "no_pending";
    };

type CandidateIntakeIgnoreResult =
  | {
      kind: "ignored";
      candidateId: string;
      displayName: string;
    }
  | {
      kind: "no_pending";
    };

describe("candidate intake interface spec", () => {
  it("creates reviewable pending candidates with event guesses and structured prompt data", async () => {
    const { intake } = await createSubject();

    const result = intake.createReviewableCandidates({
      scope: scope(),
      detectedContacts: [fixtureDetectedContact],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });

    expect(result).toMatchObject({
      kind: "reviewable_candidates_created",
      candidates: [
        {
          displayName: "Maya Chen",
          status: "pending"
        }
      ],
      reviewPrompts: [
        {
          kind: "candidate_review",
          displayName: "Maya Chen",
          eventGuess: {
            eventId: fixtureShortEvent.id,
            title: "Photon Residency Dinner",
            confidence: 0.92,
            rank: 1
          }
        }
      ]
    });
    expect(result.reviewPrompts[0]).toHaveProperty("candidateId", result.candidates[0].id);
    expect(result.reviewPrompts[0]).not.toHaveProperty("text");
  });

  it("confirms a bare yes only when one pending candidate is in scope", async () => {
    const { intake, tools } = await createSubject({ calendarEvents: [fixtureShortEvent] });
    const candidate = tools.create_contact_candidate(fixtureDetectedContact);

    const result = intake.resolveCandidateReply({
      scope: scope(),
      replyText: "yes, recruiting agents"
    });

    expect(result).toMatchObject({
      kind: "confirmed",
      candidateId: candidate.id,
      memory: {
        displayName: "Maya Chen",
        eventTitle: "Photon Residency Dinner",
        contextNote: "recruiting agents"
      }
    });
    expect(result).not.toHaveProperty("replyText");
  });

  it("returns an ambiguous outcome for a bare yes with multiple pending candidates", async () => {
    const { intake, tools, repo } = await createSubject({ calendarEvents: [fixtureShortEvent] });
    const maya = tools.create_contact_candidate(fixtureDetectedContact);
    const nina = tools.create_contact_candidate({
      ...fixtureDetectedContact,
      displayName: "Nina Park",
      detectedAt: "2026-05-15T21:44:00-07:00",
      phoneNumbers: ["+15550101021"],
      emails: []
    });

    const result = intake.resolveCandidateReply({
      scope: scope(),
      replyText: "yes"
    });

    expect(result).toEqual({
      kind: "ambiguous",
      candidates: [
        { id: maya.id, displayName: "Maya Chen" },
        { id: nina.id, displayName: "Nina Park" }
      ]
    });
    expect(repo.listMemories(fixtureUser.id)).toEqual([]);
  });

  it("uses a name fragment reply to select the matching pending candidate", async () => {
    const { intake, tools } = await createSubject({ calendarEvents: [fixtureShortEvent] });
    tools.create_contact_candidate({
      ...fixtureDetectedContact,
      displayName: "Nina Park",
      detectedAt: "2026-05-15T21:44:00-07:00",
      phoneNumbers: ["+15550101021"],
      emails: []
    });
    const maya = tools.create_contact_candidate(fixtureDetectedContact);

    const result = intake.resolveCandidateReply({
      scope: scope(),
      replyText: "yes Maya, recruiting agents founder"
    });

    expect(result).toMatchObject({
      kind: "confirmed",
      candidateId: maya.id,
      memory: {
        displayName: "Maya Chen",
        contextNote: "recruiting agents founder"
      }
    });
  });

  it("returns structured ignored and no-pending outcomes without user-facing copy", async () => {
    const { intake, tools } = await createSubject({ calendarEvents: [fixtureShortEvent] });
    const candidate = tools.create_contact_candidate(fixtureDetectedContact);

    expect(intake.ignoreCandidate({ scope: scope(), candidateName: "Maya" })).toEqual({
      kind: "ignored",
      candidateId: candidate.id,
      displayName: "Maya Chen"
    });

    expect(intake.ignoreCandidate({ scope: scope(), candidateName: "Maya" })).toEqual({
      kind: "no_pending"
    });
  });
});

async function createSubject(seed: { calendarEvents?: CalendarEvent[] } = {}) {
  const candidateIntakeModulePath = "./candidateIntake";
  const candidateIntakeModule = (await import(candidateIntakeModulePath)) as CandidateIntakeModule;
  const repo = createRelationshipRepository({
    users: [fixtureUser],
    calendarEvents: seed.calendarEvents ?? []
  });
  const tools = createRelationshipTools(repo);
  const intake = candidateIntakeModule.createCandidateIntake({ tools });

  return { intake, repo, tools };
}

function scope(): CandidateIntakeScope {
  return {
    userId: fixtureUser.id,
    spaceId: "imessage_space_candidate_intake"
  };
}
