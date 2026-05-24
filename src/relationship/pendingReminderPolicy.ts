import type { MessageInterpretation } from "./interpretation";

export type PendingReminderResponseKind =
  | "search_result"
  | "list_people"
  | "explain"
  | "repair"
  | "duplicate_audit"
  | "delete_confirm"
  | "capture_context"
  | "clarify"
  | "other";

export type SameOrDifferentResolution = {
  candidateId: string;
  resolvedAt: string;
  resolution: "same_person" | "different_person";
};

export type PendingReminderState = {
  lastReminderAt?: string;
  lastRemindedCandidateId?: string;
  lastUserComplaintAt?: string;
  sameOrDifferentResolutions?: SameOrDifferentResolution[];
};

export type PendingReminderContext = {
  userText: string;
  userIntent: MessageInterpretation["intent"];
  searchMode?: NonNullable<MessageInterpretation["search"]>["mode"];
  responseKind: PendingReminderResponseKind;
  now: string;
  activeWorkflow?: {
    kind: "pending_contact_confirmation";
    frameId: string;
    candidateId: string;
    displayName: string;
    lastFriendyPrompt: string;
  };
  pendingCandidates: Array<{ candidateId: string; displayName: string; status: string }>;
  savedMemoriesForActiveName: Array<{ memoryId: string; displayName: string }>;
  duplicateRisk: boolean;
  sameNameDisambiguationPending: boolean;
  listedEntityIds?: string[];
  reminderState: PendingReminderState;
};

export type PendingReminderDecision =
  | { action: "suppress"; reason: string }
  | { action: "defer"; reason: string }
  | { action: "append"; reason: string; candidates: Array<{ candidateId: string; displayName: string }> };

export const REMINDER_TTL_MS = 15 * 60 * 1000;
export const COMPLAINT_COOLDOWN_MS = 10 * 60 * 1000;

const NEVER_REMIND_INTENTS = new Set<MessageInterpretation["intent"]>([
  "list_people",
  "duplicate_audit",
  "delete_memory_request",
  "delete_memory",
  "update_memory",
  "explain_agent_state",
  "explain_pending_workflow",
  "conversation_repair",
  "clarify",
  "reject",
  "unknown",
  "ignore_candidate"
]);

const NEVER_REMIND_RESPONSE_KINDS = new Set<PendingReminderResponseKind>([
  "explain",
  "repair",
  "duplicate_audit",
  "delete_confirm",
  "clarify",
  "list_people"
]);

/**
 * Pure policy: decides whether to suppress, defer, or append a pending-contact reminder footer.
 */
export function decidePendingReminder(context: PendingReminderContext): PendingReminderDecision {
  if (!context.activeWorkflow) {
    return { action: "suppress", reason: "no_active_workflow" };
  }

  if (NEVER_REMIND_INTENTS.has(context.userIntent)) {
    return { action: "suppress", reason: "intent_suppressed" };
  }

  if (context.userIntent === "search_memory" && context.searchMode === "list_people") {
    return { action: "suppress", reason: "list_people_search_mode" };
  }

  if (NEVER_REMIND_RESPONSE_KINDS.has(context.responseKind)) {
    return { action: "suppress", reason: "response_kind_suppressed" };
  }

  if (context.sameNameDisambiguationPending) {
    return { action: "suppress", reason: "same_name_disambiguation_pending" };
  }

  if (withinMs(context.reminderState.lastUserComplaintAt, context.now, COMPLAINT_COOLDOWN_MS)) {
    return { action: "suppress", reason: "complaint_cooldown" };
  }

  if (
    context.reminderState.lastRemindedCandidateId === context.activeWorkflow.candidateId &&
    withinMs(context.reminderState.lastReminderAt, context.now, REMINDER_TTL_MS)
  ) {
    return { action: "defer", reason: "reminder_ttl" };
  }

  if (context.userIntent !== "search_memory") {
    return { action: "suppress", reason: "not_search_interrupt" };
  }

  const candidates = context.pendingCandidates
    .filter((candidate) => !context.listedEntityIds?.includes(candidate.candidateId))
    .slice(0, 3)
    .map((candidate) => ({ candidateId: candidate.candidateId, displayName: candidate.displayName }));

  if (candidates.length === 0) {
    return { action: "suppress", reason: "no_footer_candidates" };
  }

  return { action: "append", reason: "eligible_search_interrupt", candidates };
}

function withinMs(value: string | undefined, now: string, windowMs: number): boolean {
  if (!value) {
    return false;
  }

  const valueMs = Date.parse(value);
  const nowMs = Date.parse(now);
  if (Number.isNaN(valueMs) || Number.isNaN(nowMs)) {
    return false;
  }

  return nowMs - valueMs >= 0 && nowMs - valueMs < windowMs;
}
