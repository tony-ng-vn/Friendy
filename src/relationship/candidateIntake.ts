/**
 * Pending-contact intake and confirmation routing.
 *
 * Callers: `agentCore.ts`, `interpretedAgent.ts`, ingestion pipeline after contact detection.
 *
 * Returns structured outcomes only — `responseComposer.ts` owns all user-facing wording.
 *
 * Candidate selection priority (when multiple pending):
 * 1. Name mentioned in the reply text.
 * 2. Single `prompted` candidate in the same Spectrum `spaceId` (ties on `promptedAt` → ambiguous).
 * 3. Sole pending candidate with an event guess.
 * 4. Otherwise ambiguous, or fall back to the only remaining candidate.
 */
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

/** User and optional messaging space for correlating proactive prompts with replies. */
export type CandidateIntakeScope = {
  userId: string;
  spaceId?: string;
};

/** Structured payload for composing a proactive candidate review message. */
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

/** Result of ingesting newly detected contacts into the pending review queue. */
export type CandidateIntakeCreateResult = {
  kind: "reviewable_candidates_created";
  candidates: Array<Pick<ContactCandidate, "id" | "displayName" | "status">>;
  reviewPrompts: CandidateReviewPrompt[];
};

/** Outcome of resolving a user reply against pending candidates. */
export type CandidateReplyResult =
  | { kind: "confirmed"; candidateId: string; memory: RelationshipMemory }
  | { kind: "ambiguous"; candidates: Array<Pick<ContactCandidate, "id" | "displayName">> }
  | { kind: "no_pending" };

/** Outcome of ignoring a pending candidate. */
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
    /** Syncs calendar context, creates candidates, and builds review prompts with event guesses. */
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

    /** Resolves yes/no/event-correction replies using the selection priority documented above. */
    resolveCandidateReply(input: { scope: CandidateIntakeScope; replyText: string }): CandidateReplyResult {
      const candidates = tools.list_pending_candidates(input.scope.userId);
      if (candidates.length === 0) {
        return { kind: "no_pending" };
      }

      const selected = selectCandidate(candidates, input.replyText);
      const promptedForSpace = selected ? undefined : selectPromptedCandidateForSpace(candidates, input.scope.spaceId);
      const onlyReviewable =
        selected || promptedForSpace ? undefined : selectOnlyCandidateWithEventGuess(candidates, input.scope.userId, tools);
      if (!selected && !promptedForSpace && !onlyReviewable && candidates.length > 1) {
        return {
          kind: "ambiguous",
          candidates: candidates.map(({ id, displayName }) => ({ id, displayName }))
        };
      }

      const candidate = selected ?? promptedForSpace ?? onlyReviewable ?? candidates[0];
      const eventMatches = tools.list_candidate_event_matches(input.scope.userId, candidate.id);
      const contextText = cleanCandidateContextReply(stripCandidateSelector(input.replyText, candidate), candidate);
      const confirmation = resolveCandidateConfirmation(contextText, eventMatches);
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

    /** Marks a pending candidate ignored, optionally selected by id or name fragment. */
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

/**
 * Prefer the candidate already prompted in this Spectrum space when the user replies "yes"
 * without repeating the contact name — ties on promptedAt stay ambiguous on purpose.
 */
function selectPromptedCandidateForSpace(
  candidates: ContactCandidate[],
  spaceId?: string
): ContactCandidate | undefined {
  if (!spaceId) {
    return undefined;
  }

  const matches = candidates
    .filter((candidate) => candidate.status === "prompted" && candidate.promptSpaceId === spaceId)
    .sort((a, b) => comparePromptedAtDesc(a.promptedAt, b.promptedAt));

  if (matches.length === 0) {
    return undefined;
  }

  if (matches.length > 1 && comparePromptedAtDesc(matches[0].promptedAt, matches[1].promptedAt) === 0) {
    return undefined;
  }

  return matches[0];
}

function comparePromptedAtDesc(left?: string, right?: string): number {
  return (right ?? "").localeCompare(left ?? "");
}

function selectOnlyCandidateWithEventGuess(
  candidates: ContactCandidate[],
  userId: string,
  tools: RelationshipTools
): ContactCandidate | undefined {
  const candidatesWithEventGuesses = candidates.filter(
    (candidate) => tools.list_candidate_event_matches(userId, candidate.id).length > 0
  );

  return candidatesWithEventGuesses.length === 1 ? candidatesWithEventGuesses[0] : undefined;
}

function stripCandidateSelector(replyText: string, candidate: ContactCandidate): string {
  const firstName = candidate.displayName.split(/\s+/).filter(Boolean)[0];
  if (!firstName) {
    return replyText;
  }

  const selectorPattern = new RegExp(`^(yes|yep|yeah)\\s+${escapeRegExp(firstName)}\\b\\s*,?\\s*`, "i");
  return replyText.replace(selectorPattern, "$1, ").replace(/,\s*$/, "").trim();
}

export function cleanCandidateContextReply(replyText: string, candidate: Pick<ContactCandidate, "displayName">): string {
  const normalized = replyText.trim().replace(/\s+/g, " ");
  const firstName = candidate.displayName.split(/\s+/).filter(Boolean)[0] ?? "";
  const escapedFullName = escapeRegExp(candidate.displayName);
  const escapedFirstName = escapeRegExp(firstName);
  const nameAlternatives = [escapedFullName, escapedFirstName].filter(Boolean).join("|");

  if (nameAlternatives.length > 0) {
    const nameCopula = new RegExp(
      `^(?:${nameAlternatives})\\s+(?:is|was|are|were)\\s+(?:an?\\s+|the\\s+)?`,
      "i"
    );
    const cleaned = normalized.replace(nameCopula, "").trim();
    if (cleaned !== normalized && cleaned.length > 0) {
      return cleaned;
    }
  }

  const pronounCopula = /^(?:she|he|they|them|her|him)\s+(?:is|was|are|were)\s+(?:an?\s+|the\s+)?/i;
  const cleaned = normalized.replace(pronounCopula, "").trim();
  return cleaned.length > 0 ? cleaned : normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
