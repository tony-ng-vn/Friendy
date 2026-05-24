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

export const PENDING_REMINDER_REASON_CODES = [
  "no_active_workflow",
  "intent_suppressed",
  "list_people_search_mode",
  "response_kind_suppressed",
  "same_name_disambiguation_pending",
  "complaint_turn",
  "complaint_cooldown",
  "reminder_ttl",
  "not_search_interrupt",
  "no_footer_candidates",
  "eligible_search_interrupt"
] as const;

export type PendingReminderReason = (typeof PENDING_REMINDER_REASON_CODES)[number];

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
  | { action: "suppress"; reason: PendingReminderReason }
  | { action: "defer"; reason: PendingReminderReason }
  | { action: "append"; reason: PendingReminderReason; candidates: Array<{ candidateId: string; displayName: string }> };

export const REMINDER_TTL_MS = 15 * 60 * 1000;
export const COMPLAINT_COOLDOWN_MS = 10 * 60 * 1000;

/** Intents that must never trigger a pending-contact reminder append. Shared with route policy during migration. */
export const NEVER_REMIND_INTENTS = new Set<MessageInterpretation["intent"]>([
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

/** True when this intent should not append a pending-contact reminder (route-policy compatibility). */
export function shouldSuppressPendingReminder(intent: MessageInterpretation["intent"]): boolean {
  return NEVER_REMIND_INTENTS.has(intent);
}

/** Route-policy helper: intent suppression plus list_people search mode. */
export function shouldSuppressPendingReminderForRoute(
  intent: MessageInterpretation["intent"],
  searchMode?: NonNullable<MessageInterpretation["search"]>["mode"]
): boolean {
  return shouldSuppressPendingReminder(intent) || (intent === "search_memory" && searchMode === "list_people");
}

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
    return suppress("no_active_workflow");
  }

  if (NEVER_REMIND_INTENTS.has(context.userIntent)) {
    return suppress("intent_suppressed");
  }

  if (context.userIntent === "search_memory" && context.searchMode === "list_people") {
    return suppress("list_people_search_mode");
  }

  if (NEVER_REMIND_RESPONSE_KINDS.has(context.responseKind)) {
    return suppress("response_kind_suppressed");
  }

  if (context.sameNameDisambiguationPending) {
    return suppress("same_name_disambiguation_pending");
  }

  if (withinMs(context.reminderState.lastUserComplaintAt, context.now, COMPLAINT_COOLDOWN_MS)) {
    return suppress("complaint_cooldown");
  }

  if (
    context.reminderState.lastRemindedCandidateId === context.activeWorkflow.candidateId &&
    withinMs(context.reminderState.lastReminderAt, context.now, REMINDER_TTL_MS)
  ) {
    return { action: "defer", reason: "reminder_ttl" };
  }

  if (context.userIntent !== "search_memory") {
    return suppress("not_search_interrupt");
  }

  const candidates = context.pendingCandidates
    .filter((candidate) => !context.listedEntityIds?.includes(candidate.candidateId))
    .slice(0, 3)
    .map((candidate) => ({ candidateId: candidate.candidateId, displayName: candidate.displayName }));

  if (candidates.length === 0) {
    return suppress("no_footer_candidates");
  }

  return { action: "append", reason: "eligible_search_interrupt", candidates };
}

function suppress(reason: PendingReminderReason): Extract<PendingReminderDecision, { action: "suppress" }> {
  return { action: "suppress", reason };
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
