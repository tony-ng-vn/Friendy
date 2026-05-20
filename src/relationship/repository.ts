import { createCandidateId, mapCandidateToEvents } from "./eventMapper";
import type {
  CalendarEvent,
  ContactCandidate,
  ContactCandidateDetected,
  EventContextMatch,
  RelationshipMemory,
  User
} from "./types";

type RepositorySeed = {
  users?: User[];
  calendarEvents?: CalendarEvent[];
  candidates?: ContactCandidate[];
  eventMatches?: EventContextMatch[];
  memories?: RelationshipMemory[];
};

export type RelationshipRepository = ReturnType<typeof createRelationshipRepository>;

export function createRelationshipRepository(seed: RepositorySeed = {}) {
  const calendarEvents = [...(seed.calendarEvents ?? [])];
  const candidates = [...(seed.candidates ?? [])];
  const eventMatches = [...(seed.eventMatches ?? [])];
  const memories = [...(seed.memories ?? [])];

  return {
    listCalendarEvents(userId: string) {
      return calendarEvents.filter((event) => event.userId === userId);
    },

    createCandidateFromDetectedContact(contact: ContactCandidateDetected): ContactCandidate {
      const candidate: ContactCandidate = {
        ...contact,
        id: createCandidateId(contact),
        status: "pending"
      };

      candidates.push(candidate);
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

    confirmCandidate(candidateId: string, contextNote: string, eventId?: string): RelationshipMemory {
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }

      candidate.status = "confirmed";
      const selectedMatch = selectEventMatch(eventMatches, candidateId, eventId);
      const memory: RelationshipMemory = {
        id: `memory_${candidate.id}`,
        userId: candidate.userId,
        candidateId: candidate.id,
        displayName: candidate.displayName,
        primaryContactLabel: candidate.phoneNumbers[0] ?? candidate.emails[0] ?? "contact saved",
        eventId: selectedMatch?.calendarEventId,
        eventTitle: selectedMatch?.eventTitle,
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
    }
  };
}

export function extractTags(text: string): string[] {
  const stopWords = new Set(["about", "with", "from", "that", "this", "there", "their", "should", "person"]);
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
  return candidateMatches.sort((a, b) => a.rank - b.rank)[0];
}
