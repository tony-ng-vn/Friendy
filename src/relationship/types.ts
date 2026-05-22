/**
 * Shared relationship-agent domain types.
 *
 * Plain data objects consumed by ingestion, interpretation, deterministic tools,
 * transports, and tests. The LLM may interpret user text into shapes compatible
 * with these types; only bounded tools mutate persisted candidates and memories.
 * See docs/ai-system-architecture.md and docs/code-commenting-guide.md.
 *
 * Lifecycle: method-centric contact delta → pending candidate → user consent → memory.
 */
/** How the candidate entered the queue. Method-centric ingestion uses `contacts_delta`. */
export type ContactCandidateSource = "contacts_delta" | "manual" | "manual_imessage" | "simulated";

/** Lifecycle for a newly detected contact before it becomes searchable memory. */
export type ContactCandidateStatus =
  | "pending"
  | "prompted"
  | "confirmed"
  | "ignored"
  | "expired"
  | "error"
  | "needs_clarification"
  | "send_failed";

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

/**
 * Raw contact delta detected from setup-approved contact monitoring.
 *
 * Ingestion creates candidates when a new normalized phone/email method appears;
 * name-only edits and duplicate methods must not spawn another candidate.
 */
export type ContactCandidateDetected = {
  userId: string;
  displayName: string;
  phoneNumbers: string[];
  emails: string[];
  detectedAt: string;
  source: ContactCandidateSource;
  sensorEventId?: string;
  manualIdempotencyKey?: string;
  createdFromInteractionId?: string;
  contactIdentifier?: string;
  unifiedContactIdentifier?: string;
  containerIdentifier?: string;
  observedAt?: string;
  contactCreatedAt?: string;
  contactUpdatedAt?: string;
  eventMatchAnchorAt?: string;
  contactMethodHashes?: {
    phoneNumberHashes: string[];
    emailHashes: string[];
  };
  contactMethodHints?: {
    phoneNumberHints: Array<{ last4?: string; label?: string }>;
    emailHints: Array<{ domain?: string; label?: string }>;
  };
};

/**
 * Reviewable contact in the queue after detection, before searchable memory exists.
 *
 * Promoted to `RelationshipMemory` only after user consent via `confirm_candidate`.
 */
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
  deletedAt?: string;
};

export type MemoryRevisionReason = "created" | "user_correction" | "user_note_added" | "deleted";

/** Append-only audit entry for each accepted version of a relationship memory. */
export type MemoryRevision = {
  revisionId: string;
  memoryId: string;
  createdAt: string;
  reason: MemoryRevisionReason;
  previousValue?: Partial<RelationshipMemory>;
  nextValue: Partial<RelationshipMemory>;
  userText?: string;
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

/**
 * Transport-normalized inbound message consumed by scope boundary, then agent core.
 *
 * Callers: Spectrum/terminal transports, eval harness. Raw `text` is preserved for
 * logging and deterministic consent parsing alongside LLM interpretation.
 */
export type InboundAgentMessage = {
  interactionId?: string;
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

/**
 * Bounded tool names the agent may invoke after interpretation.
 *
 * The model chooses intent; these tools perform all state mutations (confirm, ignore,
 * search, manual capture). Keeps behavior testable and auditable.
 */
export type AgentToolCall =
  | "search_memories"
  | "list_pending_candidates"
  | "list_candidate_event_matches"
  | "get_candidate"
  | "confirm_candidate"
  | "ignore_candidate"
  | "create_manual_memory"
  | "update_memory"
  | "delete_memory";

/**
 * Result envelope returned after scope check, interpretation, and tool execution.
 *
 * Transports send `outbound.text` and log `toolCalls` for evals and debugging.
 */
export type AgentCoreResult = {
  outbound: OutboundAgentMessage;
  toolCalls: AgentToolCall[];
};
