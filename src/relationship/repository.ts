/**
 * In-memory relationship persistence boundary for the MVP agent loop.
 *
 * Callers: `createRuntimeRelationshipRepository` (default store), tests, and eval fixtures.
 * Production SQLite persistence lives in `sqliteRepository.ts` but must honor this interface.
 *
 * Invariants:
 * - One `RelationshipMemory` per confirmed candidate (`assertCandidateHasNoMemory`).
 * - Memories require a confirmed candidate (`assertMemoryHasConfirmedCandidate`).
 * - Pending/prompted candidates expire after {@link CANDIDATE_EXPIRATION_DAYS} so stale contact
 *   prompts do not linger indefinitely.
 */
import { createCandidateId, mapCandidateToEvents } from "./eventMapper";
import type {
  CalendarEvent,
  CandidatePromptAttempt,
  ContactCandidate,
  ContactCandidateDetected,
  EventContextMatch,
  AgentInteraction,
  RelationshipDateContext,
  RelationshipMemory,
  User
} from "./types";

/** Optional bootstrap data for tests and local fixtures. */
export type RepositorySeed = {
  users?: User[];
  calendarEvents?: CalendarEvent[];
  candidates?: ContactCandidate[];
  eventMatches?: EventContextMatch[];
  promptAttempts?: CandidatePromptAttempt[];
  memories?: RelationshipMemory[];
  interactions?: AgentInteraction[];
};

/** Optional overrides when confirming a detected contact into a durable memory. */
export type ConfirmCandidateOptions = {
  eventTitle?: string;
  relationshipContext?: string;
  dateContext?: RelationshipDateContext;
};

/** Links a proactive review prompt to the Spectrum space that received it. */
export type MarkCandidatePromptedOptions = {
  spaceId?: string;
  promptedAt?: string;
};

/**
 * Pending candidates older than this are auto-expired on read.
 *
 * Two weeks balances giving the user time to reply in iMessage against not keeping ambiguous
 * contact prompts in the review queue forever.
 */
const CANDIDATE_EXPIRATION_DAYS = 14;

/**
 * Persistence contract for calendar context, contact candidates, memories, and agent interactions.
 *
 * Implementations must preserve candidate lifecycle ordering and the one-memory-per-candidate rule.
 */
export type RelationshipRepository = {
  listCalendarEvents(userId: string): CalendarEvent[];
  addCalendarEvents(events: CalendarEvent[]): CalendarEvent[];
  createCandidateFromDetectedContact(contact: ContactCandidateDetected): ContactCandidate;
  listPendingCandidates(userId: string): ContactCandidate[];
  getCandidate(candidateId: string): ContactCandidate | undefined;
  listEventMatches(candidateId: string): EventContextMatch[];
  recordPromptAttempt(attempt: CandidatePromptAttempt): CandidatePromptAttempt;
  listCandidatePromptAttempts(candidateId: string): CandidatePromptAttempt[];
  markCandidatePrompted(
    candidateId: string,
    interactionId: string,
    options?: MarkCandidatePromptedOptions
  ): ContactCandidate;
  markCandidatePromptFailed(candidateId: string, reason: string): ContactCandidate;
  confirmCandidate(
    candidateId: string,
    contextNote: string,
    eventId?: string,
    options?: ConfirmCandidateOptions
  ): RelationshipMemory;
  ignoreCandidate(candidateId: string): void;
  listMemories(userId?: string): RelationshipMemory[];
  addMemory(memory: RelationshipMemory): RelationshipMemory;
  addInteraction(interaction: AgentInteraction): AgentInteraction;
  listInteractions(userId?: string): AgentInteraction[];
};

/**
 * Creates the MVP memory repository.
 *
 * It is intentionally in-memory so the agent loop can be tested without Notion, Mem0,
 * or a production database. The returned API is the boundary those stores can replace later.
 */
export function createRelationshipRepository(seed: RepositorySeed = {}): RelationshipRepository {
  const calendarEvents = [...(seed.calendarEvents ?? [])];
  const candidates = [...(seed.candidates ?? [])];
  const eventMatches = [...(seed.eventMatches ?? [])];
  const promptAttempts = [...(seed.promptAttempts ?? [])];
  const memories = [...(seed.memories ?? [])];
  const interactions = [...(seed.interactions ?? [])];

  return {
    listCalendarEvents(userId: string) {
      return calendarEvents.filter((event) => event.userId === userId);
    },

    addCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
      for (const event of events) {
        const existingIndex = calendarEvents.findIndex((item) => item.id === event.id);
        if (existingIndex >= 0) {
          calendarEvents[existingIndex] = event;
        } else {
          calendarEvents.push(event);
        }
      }

      return events;
    },

    createCandidateFromDetectedContact(contact: ContactCandidateDetected): ContactCandidate {
      const candidateId = createCandidateId(contact);
      const existing = candidates.find((candidate) => candidate.id === candidateId);
      if (existing) {
        return existing;
      }

      const candidate: ContactCandidate = {
        ...contact,
        id: candidateId,
        status: "pending",
        expiresAt: calculateCandidateExpiresAt(contact.detectedAt)
      };

      candidates.push(candidate);
      // Persist event guesses at detection time so the later confirmation prompt can explain its assumption.
      eventMatches.push(...mapCandidateToEvents(candidate.id, contact, calendarEvents));
      return candidate;
    },

    listPendingCandidates(userId: string): ContactCandidate[] {
      return candidates.filter((candidate) => {
        expireCandidateIfStale(candidate);
        return candidate.userId === userId && isReviewableCandidateStatus(candidate.status);
      });
    },

    getCandidate(candidateId: string): ContactCandidate | undefined {
      return candidates.find((candidate) => candidate.id === candidateId);
    },

    listEventMatches(candidateId: string): EventContextMatch[] {
      return eventMatches
        .filter((match) => match.candidateId === candidateId)
        .sort((a, b) => a.rank - b.rank);
    },

    recordPromptAttempt(attempt: CandidatePromptAttempt): CandidatePromptAttempt {
      const existingIndex = promptAttempts.findIndex((item) => item.id === attempt.id);
      if (existingIndex >= 0) {
        promptAttempts[existingIndex] = attempt;
      } else {
        promptAttempts.push(attempt);
      }
      return attempt;
    },

    listCandidatePromptAttempts(candidateId: string): CandidatePromptAttempt[] {
      return promptAttempts.filter((attempt) => attempt.candidateId === candidateId);
    },

    confirmCandidate(
      candidateId: string,
      contextNote: string,
      eventId?: string,
      options: ConfirmCandidateOptions = {}
    ): RelationshipMemory {
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      expireCandidateIfStale(candidate);
      if (!isReviewableCandidateStatus(candidate.status)) {
        throw new Error(`Candidate is not confirmable: ${candidateId}`);
      }

      candidate.status = "confirmed";
      const selectedMatch = options.eventTitle && !eventId ? undefined : selectEventMatch(eventMatches, candidateId, eventId);
      const memory: RelationshipMemory = {
        id: `memory_${candidate.id}`,
        userId: candidate.userId,
        candidateId: candidate.id,
        displayName: candidate.displayName,
        primaryContactLabel: candidate.phoneNumbers[0] ?? candidate.emails[0] ?? "contact saved",
        eventId: selectedMatch?.calendarEventId,
        eventTitle: options.eventTitle ?? selectedMatch?.eventTitle,
        dateContext: options.dateContext,
        contextNote,
        relationshipContext: options.relationshipContext,
        tags: extractTags(contextNote),
        confidence: selectedMatch?.confidence ?? 0.5,
        createdAt: "2026-05-20T12:00:00.000Z",
        updatedAt: "2026-05-20T12:00:00.000Z"
      };

      memories.push(memory);
      return memory;
    },

    markCandidatePrompted(
      candidateId: string,
      interactionId: string,
      options: MarkCandidatePromptedOptions = {}
    ): ContactCandidate {
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      expireCandidateIfStale(candidate);
      if (candidate.status !== "pending") {
        throw new Error(`Candidate is not promptable: ${candidateId}`);
      }

      candidate.status = "prompted";
      candidate.promptInteractionId = interactionId;
      candidate.promptSpaceId = options.spaceId;
      candidate.promptedAt = options.promptedAt;
      delete candidate.statusReason;
      return candidate;
    },

    markCandidatePromptFailed(candidateId: string, reason: string): ContactCandidate {
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      expireCandidateIfStale(candidate);
      if (candidate.status !== "pending") {
        throw new Error(`Candidate is not pending: ${candidateId}`);
      }

      candidate.statusReason = reason;
      return candidate;
    },

    ignoreCandidate(candidateId: string): void {
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      expireCandidateIfStale(candidate);
      if (!isReviewableCandidateStatus(candidate.status)) {
        throw new Error(`Candidate is not ignorable: ${candidateId}`);
      }
      candidate.status = "ignored";
    },

    listMemories(userId?: string): RelationshipMemory[] {
      return userId ? memories.filter((memory) => memory.userId === userId) : [...memories];
    },

    addMemory(memory: RelationshipMemory): RelationshipMemory {
      assertMemoryHasConfirmedCandidate(memory, candidates);
      assertCandidateHasNoMemory(memory, memories);
      if (memories.some((existing) => existing.id === memory.id)) {
        throw new Error(`Memory already exists: ${memory.id}`);
      }
      memories.push(memory);
      return memory;
    },

    addInteraction(interaction: AgentInteraction): AgentInteraction {
      interactions.push(interaction);
      return interaction;
    },

    listInteractions(userId?: string): AgentInteraction[] {
      return userId ? interactions.filter((interaction) => interaction.userId === userId) : [...interactions];
    }
  };
}

function assertMemoryHasConfirmedCandidate(memory: RelationshipMemory, candidates: ContactCandidate[]): void {
  const candidate = memory.candidateId ? candidates.find((item) => item.id === memory.candidateId) : undefined;
  if (!candidate || candidate.userId !== memory.userId || candidate.status !== "confirmed") {
    throw new Error("Memory requires a confirmed candidate");
  }
}

function assertCandidateHasNoMemory(memory: RelationshipMemory, memories: RelationshipMemory[]): void {
  if (memory.candidateId && memories.some((existing) => existing.candidateId === memory.candidateId)) {
    throw new Error("Memory already exists for candidate");
  }
}

/** Computes the ISO expiry timestamp from a contact detection time. */
export function calculateCandidateExpiresAt(detectedAt: string): string {
  return new Date(Date.parse(detectedAt) + CANDIDATE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Mutates reviewable candidates to `expired` when past {@link CANDIDATE_EXPIRATION_DAYS}.
 *
 * Called lazily on read so callers do not need a background sweeper in the MVP store.
 */
export function expireCandidateIfStale(candidate: ContactCandidate, now = new Date()): ContactCandidate {
  if (
    isReviewableCandidateStatus(candidate.status) &&
    candidate.expiresAt &&
    Date.parse(candidate.expiresAt) <= now.getTime()
  ) {
    candidate.status = "expired";
  }

  return candidate;
}

function isReviewableCandidateStatus(status: ContactCandidate["status"]): boolean {
  return status === "pending" || status === "prompted";
}

/**
 * Extracts low-cost keyword tags for the first search version.
 *
 * This is deliberately transparent and deterministic; embeddings can be layered in only after
 * we know lexical search is the bottleneck.
 */
export function extractTags(text: string): string[] {
  const stopWords = new Set([
    "about",
    "also",
    "and",
    "are",
    "did",
    "for",
    "from",
    "have",
    "her",
    "him",
    "his",
    "i",
    "in",
    "into",
    "me",
    "of",
    "ok",
    "on",
    "person",
    "same",
    "she",
    "should",
    "that",
    "the",
    "their",
    "there",
    "this",
    "through",
    "to",
    "was",
    "we",
    "who",
    "with",
    "you",
    "your"
  ]);
  const tags = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !stopWords.has(token));

  return Array.from(new Set(tags));
}

function selectEventMatch(matches: EventContextMatch[], candidateId: string, eventId?: string) {
  const candidateMatches = matches.filter((match) => match.candidateId === candidateId);
  if (eventId) {
    return candidateMatches.find((match) => match.calendarEventId === eventId);
  }
  // Default to the highest-ranked event guess when the user confirms without correcting the event.
  return candidateMatches.sort((a, b) => a.rank - b.rank)[0];
}
