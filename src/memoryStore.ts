/**
 * Legacy Vite demo in-memory state transitions.
 *
 * Production persistence and repository boundaries live in `src/relationship/`.
 * See `src/relationship/types.ts` for domain types and `src/relationship/agentCore.ts`
 * / `src/relationship/interpretedAgent.ts` for agent routing.
 */
import type { CalendarEvent, CandidateConnection, MemorySession, RelationshipMemory, User } from "./types";

/** In-browser demo state: user, events, sessions, candidates, and saved memories. */
export type MemoryState = {
  user: User;
  calendarEvents: CalendarEvent[];
  sessions: MemorySession[];
  candidates: CandidateConnection[];
  memories: RelationshipMemory[];
};

const STOP_WORDS = new Set(["about", "with", "from", "that", "this", "there", "their", "should", "up"]);

/** Seeds demo state from a user and calendar event with a suggested session. */
export function createInitialState(user: User, calendarEvent: CalendarEvent): MemoryState {
  return {
    user,
    calendarEvents: [calendarEvent],
    sessions: [
      {
        id: `session_${calendarEvent.id}`,
        userId: user.id,
        calendarEventId: calendarEvent.id,
        title: calendarEvent.title,
        startsAt: calendarEvent.startsAt,
        endsAt: calendarEvent.endsAt,
        status: "suggested",
        createdAt: "2026-05-19T09:00:00.000Z"
      }
    ],
    candidates: [],
    memories: []
  };
}

/** Marks the session for the given calendar event as active after user approval. */
export function approveSession(state: MemoryState, calendarEventId: string): MemoryState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.calendarEventId === calendarEventId ? { ...session, status: "active" } : session
    )
  };
}

/** Attaches contact deltas to the active session and moves it to review_ready. */
export function loadContactDelta(state: MemoryState, candidates: CandidateConnection[]): MemoryState {
  const activeSession = state.sessions.find((session) => session.status === "active");
  if (!activeSession) {
    return state;
  }

  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === activeSession.id ? { ...session, status: "review_ready" } : session
    ),
    candidates: candidates.map((candidate) => ({
      ...candidate,
      memorySessionId: activeSession.id,
      status: "pending"
    }))
  };
}

/** Confirms a candidate, saves a relationship memory, and extracts search tags. */
export function confirmCandidate(state: MemoryState, candidateId: string, contextNote: string): MemoryState {
  const candidate = state.candidates.find((item) => item.id === candidateId);
  if (!candidate) {
    return state;
  }

  const session = state.sessions.find((item) => item.id === candidate.memorySessionId);
  const contactLabel = candidate.phoneNumber ?? candidate.email ?? "contact saved";
  const memory: RelationshipMemory = {
    id: `memory_${candidate.id}`,
    userId: candidate.userId,
    candidateConnectionId: candidate.id,
    memorySessionId: candidate.memorySessionId,
    displayName: candidate.displayName,
    contactLabel,
    eventTitle: session?.title,
    contextNote,
    tags: extractTags(contextNote),
    confirmedAt: "2026-05-19T09:30:00.000Z"
  };

  return {
    ...state,
    candidates: state.candidates.map((item) =>
      item.id === candidateId ? { ...item, status: "confirmed" } : item
    ),
    memories: [...state.memories.filter((item) => item.candidateConnectionId !== candidateId), memory]
  };
}

/** Marks a pending candidate as ignored without creating a memory. */
export function ignoreCandidate(state: MemoryState, candidateId: string): MemoryState {
  return {
    ...state,
    candidates: state.candidates.map((candidate) =>
      candidate.id === candidateId ? { ...candidate, status: "ignored" } : candidate
    )
  };
}

/** Derives lowercase search tokens from free-text context, dropping common stop words. */
export function extractTags(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));

  return Array.from(new Set(tokens));
}
