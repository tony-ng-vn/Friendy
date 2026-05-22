/**
 * Shared relationship-agent domain types.
 *
 * These stay as plain data objects so the same core can run behind terminal tests,
 * Spectrum/iMessage, and later persistence layers without transport-specific state.
 */
export type ContactCandidateSource = "contacts_delta" | "manual" | "simulated";

/** Lifecycle for a newly detected contact before it becomes searchable memory. */
export type ContactCandidateStatus = "pending" | "prompted" | "confirmed" | "ignored" | "expired" | "error";

export type CalendarSource = "apple_calendar" | "google_calendar" | "simulated";

/** Calendar event kind controls match priority when event windows overlap. */
export type CalendarEventKind = "short" | "long" | "all_day";

export type AgentPlatform = "imessage" | "terminal" | "web";

/** Normalized natural-language date context parsed from the user's message. */
export type RelationshipDateContext = {
  rawText: string;
  localDate: string;
  startsAt: string;
  endsAt?: string;
  timezone: string;
};

/** Product user whose personal contacts, calendar context, and memories are scoped together. */
export type User = {
  id: string;
  phoneNumber: string;
  displayName: string;
  createdAt: string;
};

/** Raw contact delta detected from setup-approved contact monitoring. */
export type ContactCandidateDetected = {
  userId: string;
  displayName: string;
  phoneNumbers: string[];
  emails: string[];
  detectedAt: string;
  source: ContactCandidateSource;
  sensorEventId?: string;
  contactIdentifier?: string;
  unifiedContactIdentifier?: string;
  containerIdentifier?: string;
  observedAt?: string;
  contactMethodHashes?: {
    phoneNumberHashes: string[];
    emailHashes: string[];
  };
  contactMethodHints?: {
    phoneNumberHints: Array<{ last4?: string; label?: string }>;
    emailHints: Array<{ domain?: string; label?: string }>;
  };
};

/** Reviewable contact candidate waiting for the user to confirm, ignore, or annotate. */
export type ContactCandidate = ContactCandidateDetected & {
  id: string;
  status: ContactCandidateStatus;
  expiresAt?: string;
  promptInteractionId?: string;
  promptSpaceId?: string;
  promptedAt?: string;
  statusReason?: string;
};

/** Calendar window used to infer where a contact was probably met. */
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

/** Candidate-to-event inference result stored separately so the agent can explain why it guessed an event. */
export type EventContextMatch = {
  id: string;
  candidateId: string;
  calendarEventId: string;
  eventTitle: string;
  confidence: number;
  reason: string;
  rank: number;
};

export type CandidatePromptAttemptStatus = "send_started" | "send_succeeded" | "send_failed";

/** Durable prompt delivery audit used to recover candidate prompts after process restarts. */
export type CandidatePromptAttempt = {
  id: string;
  candidateId: string;
  interactionId?: string;
  spectrumSpaceId?: string;
  status: CandidatePromptAttemptStatus;
  errorCode?: string;
  rawJson?: Record<string, unknown>;
  createdAt: string;
};

/** User-approved memory that becomes searchable by vague relationship context. */
export type RelationshipMemory = {
  id: string;
  userId: string;
  candidateId?: string;
  displayName: string;
  primaryContactLabel: string;
  eventId?: string;
  eventTitle?: string;
  dateContext?: RelationshipDateContext;
  contextNote: string;
  relationshipContext?: string;
  tags: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
};

/** Audit trail for agent turns and tool use; useful for debugging ranking and consent behavior. */
export type AgentInteraction = {
  id: string;
  userId: string;
  platform: AgentPlatform;
  spaceId?: string;
  inboundText: string;
  interpretedIntentJson?: unknown;
  outboundText: string;
  toolCalls: string[];
  modelUsed?: string;
  confidence?: number;
  latencyMs?: number;
  error?: string;
  createdAt: string;
};

/** Transport-normalized inbound message consumed by the relationship agent core. */
export type InboundAgentMessage = {
  userId: string;
  platform: AgentPlatform;
  spaceId?: string;
  text: string;
  receivedAt: string;
};

/** Transport-neutral response produced by the relationship agent core. */
export type OutboundAgentMessage = {
  userId: string;
  platform: AgentPlatform;
  spaceId?: string;
  text: string;
};

/** Bounded tool names keep the first agent observable instead of hiding work behind one opaque action. */
export type AgentToolCall =
  | "search_memories"
  | "list_pending_candidates"
  | "list_candidate_event_matches"
  | "get_candidate"
  | "confirm_candidate"
  | "ignore_candidate"
  | "create_manual_memory";

/** Result envelope used by transports to send the reply and log which tools were used. */
export type AgentCoreResult = {
  outbound: OutboundAgentMessage;
  toolCalls: AgentToolCall[];
};
