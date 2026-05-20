import { createCandidateId, mapCandidateToEvents } from "./eventMapper";
import type {
  CalendarEvent,
  ContactCandidate,
  ContactCandidateDetected,
  EventContextMatch,
  AgentInteraction,
  RelationshipMemory,
  User
} from "./types";

type RepositorySeed = {
  users?: User[];
  calendarEvents?: CalendarEvent[];
  candidates?: ContactCandidate[];
  eventMatches?: EventContextMatch[];
  memories?: RelationshipMemory[];
  interactions?: AgentInteraction[];
};

type ConfirmCandidateOptions = {
  eventTitle?: string;
};

/** Minimal repository contract inferred from the in-memory implementation. */
export type RelationshipRepository = ReturnType<typeof createRelationshipRepository>;

/**
 * Creates the MVP memory repository.
 *
 * It is intentionally in-memory so the agent loop can be tested without Notion, Mem0,
 * or a production database. The returned API is the boundary those stores can replace later.
 */
export function createRelationshipRepository(seed: RepositorySeed = {}) {
  const calendarEvents = [...(seed.calendarEvents ?? [])];
  const candidates = [...(seed.candidates ?? [])];
  const eventMatches = [...(seed.eventMatches ?? [])];
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
      const candidate: ContactCandidate = {
        ...contact,
        id: createCandidateId(contact),
        status: "pending"
      };

      candidates.push(candidate);
      // Persist event guesses at detection time so the later confirmation prompt can explain its assumption.
      eventMatches.push(...mapCandidateToEvents(candidate.id, contact, calendarEvents));
      return candidate;
    },

    listPendingCandidates(userId: string): ContactCandidate[] {
      return candidates.filter((candidate) => candidate.userId === userId && candidate.status === "pending");
    },

    getCandidate(candidateId: string): ContactCandidate | undefined {
      return candidates.find((candidate) => candidate.id === candidateId);
    },

    listEventMatches(candidateId: string): EventContextMatch[] {
      return eventMatches
        .filter((match) => match.candidateId === candidateId)
        .sort((a, b) => a.rank - b.rank);
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
        contextNote,
        tags: extractTags(contextNote),
        confidence: selectedMatch?.confidence ?? 0.5,
        createdAt: "2026-05-20T12:00:00.000Z",
        updatedAt: "2026-05-20T12:00:00.000Z"
      };

      memories.push(memory);
      return memory;
    },

    ignoreCandidate(candidateId: string): void {
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      candidate.status = "ignored";
    },

    listMemories(userId?: string): RelationshipMemory[] {
      return userId ? memories.filter((memory) => memory.userId === userId) : [...memories];
    },

    addMemory(memory: RelationshipMemory): RelationshipMemory {
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
