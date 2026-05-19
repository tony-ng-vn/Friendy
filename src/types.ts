export type User = {
  id: string;
  name: string;
  phoneNumber?: string;
  createdAt: string;
};

export type CalendarEvent = {
  id: string;
  userId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  source: "mock_calendar" | "native_calendar";
};

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

export type AgentInteraction = {
  id: string;
  userId: string;
  kind: "event_prompt" | "candidate_review" | "context_capture" | "memory_search" | "follow_up_draft";
  input: string;
  response: string;
  createdAt: string;
};
