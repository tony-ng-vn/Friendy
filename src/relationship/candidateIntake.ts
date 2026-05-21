import { resolveCandidateConfirmation } from "./candidateConfirmation";
import type { createRelationshipTools } from "./tools";
import type {
  CalendarEvent,
  ContactCandidate,
  ContactCandidateDetected,
  EventContextMatch,
  RelationshipMemory
} from "./types";

type RelationshipTools = ReturnType<typeof createRelationshipTools>;

export type CandidateIntakeScope = {
  userId: string;
  spaceId?: string;
};

export type CandidateReviewPrompt = {
  kind: "candidate_review";
  candidateId: string;
  displayName: string;
  eventGuess?: {
    eventId: string;
    title: string;
    confidence: number;
    rank: number;
  };
};

export type CandidateIntakeCreateResult = {
  kind: "reviewable_candidates_created";
  candidates: Array<Pick<ContactCandidate, "id" | "displayName" | "status">>;
  reviewPrompts: CandidateReviewPrompt[];
};

export type CandidateReplyResult =
  | { kind: "confirmed"; candidateId: string; memory: RelationshipMemory }
  | { kind: "ambiguous"; candidates: Array<Pick<ContactCandidate, "id" | "displayName">> }
  | { kind: "no_pending" };

export type CandidateIgnoreResult =
  | { kind: "ignored"; candidateId: string; displayName: string }
  | { kind: "no_pending" };

/**
 * Owns the detected-contact pending-candidate lifecycle.
 *
 * Candidate Intake returns structured outcomes only; response composition stays outside this
 * module so wording can change without changing candidate lifecycle behavior.
 */
export function createCandidateIntake({ tools }: { tools: RelationshipTools }) {
  return {
    createReviewableCandidates(input: {
      scope: CandidateIntakeScope;
      detectedContacts: ContactCandidateDetected[];
      calendarEvents: CalendarEvent[];
    }): CandidateIntakeCreateResult {
      tools.sync_calendar_events(input.scope.userId, input.calendarEvents);
      const candidates = input.detectedContacts.map((contact) => tools.create_contact_candidate(contact));
      const reviewPrompts = candidates.map((candidate) => {
        const [bestMatch] = tools.list_candidate_event_matches(input.scope.userId, candidate.id);
        return toReviewPrompt(candidate, bestMatch);
      });

      return {
        kind: "reviewable_candidates_created",
        candidates: candidates.map(({ id, displayName, status }) => ({ id, displayName, status })),
        reviewPrompts
      };
    },

    resolveCandidateReply(input: { scope: CandidateIntakeScope; replyText: string }): CandidateReplyResult {
      const candidates = tools.list_pending_candidates(input.scope.userId);
      if (candidates.length === 0) {
        return { kind: "no_pending" };
      }

      const selected = selectCandidate(candidates, input.replyText);
      if (!selected && candidates.length > 1) {
        return {
          kind: "ambiguous",
          candidates: candidates.map(({ id, displayName }) => ({ id, displayName }))
        };
      }

      const candidate = selected ?? candidates[0];
      const eventMatches = tools.list_candidate_event_matches(input.scope.userId, candidate.id);
      const confirmation = resolveCandidateConfirmation(stripCandidateSelector(input.replyText, candidate), eventMatches);
      const memory = tools.confirm_candidate(
        input.scope.userId,
        candidate.id,
        confirmation.contextNote,
        confirmation.eventId,
        {
          eventTitle: confirmation.eventTitle,
          relationshipContext: confirmation.relationshipContext
        }
      );

      return { kind: "confirmed", candidateId: candidate.id, memory };
    },

    ignoreCandidate(input: {
      scope: CandidateIntakeScope;
      candidateId?: string;
      candidateName?: string;
    }): CandidateIgnoreResult {
      const candidates = tools.list_pending_candidates(input.scope.userId);
      const candidate = input.candidateId
        ? candidates.find((item) => item.id === input.candidateId)
        : selectCandidate(candidates, input.candidateName ?? "") ?? candidates[0];

      if (!candidate) {
        return { kind: "no_pending" };
      }

      tools.ignore_candidate(input.scope.userId, candidate.id);
      return { kind: "ignored", candidateId: candidate.id, displayName: candidate.displayName };
    }
  };
}

function toReviewPrompt(candidate: ContactCandidate, match?: EventContextMatch): CandidateReviewPrompt {
  return {
    kind: "candidate_review",
    candidateId: candidate.id,
    displayName: candidate.displayName,
    eventGuess: match
      ? {
          eventId: match.calendarEventId,
          title: match.eventTitle,
          confidence: match.confidence,
          rank: match.rank
        }
      : undefined
  };
}

function selectCandidate(candidates: ContactCandidate[], text: string): ContactCandidate | undefined {
  const normalized = text.toLowerCase();
  return candidates.find((candidate) => {
    const nameParts = candidate.displayName.toLowerCase().split(/\s+/).filter(Boolean);
    return nameParts.some((part) => normalized.includes(part));
  });
}

function stripCandidateSelector(replyText: string, candidate: ContactCandidate): string {
  const firstName = candidate.displayName.split(/\s+/).filter(Boolean)[0];
  if (!firstName) {
    return replyText;
  }

  const selectorPattern = new RegExp(`^(yes|yep|yeah)\\s+${escapeRegExp(firstName)}\\b\\s*,?\\s*`, "i");
  return replyText.replace(selectorPattern, "$1, ").replace(/,\s*$/, "").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
