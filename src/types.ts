/**
 * Legacy Vite demo domain types.
 *
 * Production relationship types live in `src/relationship/types.ts`.
 * Agent routing and interpretation live in `src/relationship/agentCore.ts` and
 * `src/relationship/interpretedAgent.ts`.
 */

/** Demo user record scoped to the in-browser mock store. */
export type User = {
  id: string;
  name: string;
  phoneNumber?: string;
  createdAt: string;
};

/** Calendar event that seeds a memory session in the demo flow. */
export type CalendarEvent = {
  id: string;
  userId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  source: "mock_calendar" | "native_calendar";
};

/** Tracks an approved event window from suggestion through candidate review. */
export type MemorySession = {
  id: string;
  userId: string;
  calendarEventId?: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "suggested" | "active" | "review_ready" | "completed" | "declined";
  createdAt: string;
};

/** New contact detected after an event window; pending user confirmation. */
export type CandidateConnection = {
  id: string;
  userId: string;
  memorySessionId?: string;
  displayName: string;
  phoneNumber?: string;
  email?: string;
  source: "mock_contact_delta" | "native_contacts" | "shared_link" | "manual";
  detectedAt: string;
  status: "pending" | "confirmed" | "ignored";
};

/** Confirmed relationship memory saved from a candidate and context note. */
export type RelationshipMemory = {
  id: string;
  userId: string;
  candidateConnectionId: string;
  memorySessionId?: string;
  displayName: string;
  contactLabel: string;
  eventTitle?: string;
  contextNote: string;
  tags: string[];
  confirmedAt: string;
};

/** Logged chat turn in the demo UI; not persisted beyond the session. */
export type AgentInteraction = {
  id: string;
  userId: string;
  kind: "event_prompt" | "candidate_review" | "context_capture" | "memory_search" | "follow_up_draft";
  input: string;
  response: string;
  createdAt: string;
};
