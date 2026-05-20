export type ContactCandidateSource = "contacts_delta" | "manual" | "simulated";
export type ContactCandidateStatus = "pending" | "confirmed" | "ignored";
export type CalendarSource = "apple_calendar" | "google_calendar" | "simulated";
export type CalendarEventKind = "short" | "long" | "all_day";
export type AgentPlatform = "imessage" | "terminal" | "web";

export type User = {
  id: string;
  phoneNumber: string;
  displayName: string;
  createdAt: string;
};

export type ContactCandidateDetected = {
  userId: string;
  displayName: string;
  phoneNumbers: string[];
  emails: string[];
  detectedAt: string;
  source: "simulated" | "contacts_delta";
};

export type ContactCandidate = ContactCandidateDetected & {
  id: string;
  status: ContactCandidateStatus;
};

export type CalendarEvent = {
  id: string;
  userId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  location?: string;
  calendarSource: CalendarSource;
  eventKind: CalendarEventKind;
};

export type EventContextMatch = {
  id: string;
  candidateId: string;
  calendarEventId: string;
  eventTitle: string;
  confidence: number;
  reason: string;
  rank: number;
};

export type RelationshipMemory = {
  id: string;
  userId: string;
  candidateId?: string;
  displayName: string;
  primaryContactLabel: string;
  eventId?: string;
  eventTitle?: string;
  contextNote: string;
  tags: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentInteraction = {
  id: string;
  userId: string;
  platform: AgentPlatform;
  spaceId?: string;
  inboundText: string;
  outboundText: string;
  toolCalls: string[];
  createdAt: string;
};

export type InboundAgentMessage = {
  userId: string;
  platform: AgentPlatform;
  spaceId?: string;
  text: string;
  receivedAt: string;
};

export type OutboundAgentMessage = {
  userId: string;
  platform: AgentPlatform;
  spaceId?: string;
  text: string;
};

export type AgentToolCall =
  | "search_memories"
  | "list_pending_candidates"
  | "get_candidate"
  | "confirm_candidate"
  | "ignore_candidate"
  | "create_manual_memory";

export type AgentCoreResult = {
  outbound: OutboundAgentMessage;
  toolCalls: AgentToolCall[];
};
