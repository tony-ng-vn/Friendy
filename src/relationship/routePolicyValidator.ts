/**
 * Post-interpretation policy gate before deterministic tools run.
 *
 * Validates interpreter intent against durable conversation state, unsupported routes,
 * and required tool availability. Reminder suppression is projected here for traces;
 * append/defer timing lives in `pendingReminderPolicy.ts`.
 */
import type { MessageInterpretation } from "./interpretation";
import type { ConversationState } from "./conversationState";
import type { AgentToolCall } from "./types";
import { shouldSuppressPendingReminder, shouldSuppressPendingReminderForRoute } from "./pendingReminderPolicy";

/** Outcome of route policy: proceed, ask, reject off-domain, or explain unsupported capability. */
export type ValidatedRoutePolicy =
  | { decision: "allow"; reason: string; suppressPendingReminder: boolean }
  | { decision: "clarify"; reason: string; question: string; suppressPendingReminder: boolean }
  | { decision: "reject"; reason: string; redirect: string; suppressPendingReminder: boolean }
  | { decision: "unsupported"; reason: string; outboundText: string; suppressPendingReminder: boolean };

export { shouldSuppressPendingReminder };

/** Validates interpreter output against durable and conversation state before tools run. */
export function validateRoutePolicy(
  interpretation: MessageInterpretation,
  pendingState: ConversationState
): ValidatedRoutePolicy {
  if (interpretation.intent === "clarify") {
    return allow("Interpreter returned an explicit clarify route.");
  }

  if (interpretation.intent === "unknown") {
    return clarify(
      "Interpreter returned unknown instead of an executable Friendy route.",
      interpretation.clarificationQuestion || "Should I save this as a memory or search for someone?"
    );
  }

  if (isUnsupportedIntent(interpretation.intent)) {
    return unsupported(
      `Intent ${interpretation.intent} is not implemented by deterministic Friendy tools.`,
      "I can't edit Apple Contacts yet. I can save or update Friendy relationship memory, but I will not change Apple Contacts silently."
    );
  }

  if (interpretation.intent === "reject") {
    return reject(
      "Route marked reject by interpreter.",
      "That is outside Friendy's relationship-memory scope. Tell me the person, contact, memory, follow-up, or message you want help with."
    );
  }

  if (interpretation.needsClarification) {
    return clarify(
      "Route requires clarification before executing tools.",
      interpretation.clarificationQuestion || "What do you remember about them?"
    );
  }

  if (
    (interpretation.intent === "answer_pending_contact_prompt" ||
      interpretation.intent === "capture_pending_contact_context") &&
    !pendingState.activeFrame
  ) {
    return clarify("No active pending contact frame for context capture.", "Who should I attach that relationship context to?");
  }

  if (interpretation.intent === "ignore_candidate" && pendingState.pendingContactQueue.length === 0) {
    return allow("Allow ignore route to explain missing pending candidates.");
  }

  return {
    decision: "allow",
    reason: `Allowed route ${interpretation.intent}.`,
    // Compatibility projection for traces during PR 5. Append/defer decisions live in pendingReminderPolicy.ts.
    suppressPendingReminder: shouldSuppressPendingReminderForRoute(interpretation.intent, interpretation.search?.mode)
  };
}

/**
 * Ensures the interpreted route has a registered tool implementation.
 *
 * @returns A reject/unsupported policy when the required tool is missing; otherwise `undefined`.
 */
export function validateRequiredToolAvailability(
  interpretation: MessageInterpretation,
  tools: Record<AgentToolCall, unknown>
): ValidatedRoutePolicy | undefined {
  const requiredTool = requiredToolForInterpretation(interpretation);
  if (!requiredTool || typeof tools[requiredTool] === "function") {
    return undefined;
  }

  return unsupported(
    `Required tool ${requiredTool} is not available for intent ${interpretation.intent}.`,
    `I can't complete that because the ${toolLabel(requiredTool)} is not available right now.`,
    shouldSuppressPendingReminder(interpretation.intent)
  );
}

function allow(reason: string): Extract<ValidatedRoutePolicy, { decision: "allow" }> {
  return { decision: "allow", reason, suppressPendingReminder: true };
}

function clarify(reason: string, question: string): Extract<ValidatedRoutePolicy, { decision: "clarify" }> {
  return { decision: "clarify", reason, question, suppressPendingReminder: true };
}

function reject(reason: string, redirect: string): Extract<ValidatedRoutePolicy, { decision: "reject" }> {
  return { decision: "reject", reason, redirect, suppressPendingReminder: true };
}

function unsupported(
  reason: string,
  outboundText: string,
  suppressPendingReminder = true
): Extract<ValidatedRoutePolicy, { decision: "unsupported" }> {
  return { decision: "unsupported", reason, outboundText, suppressPendingReminder };
}

function isUnsupportedIntent(intent: MessageInterpretation["intent"]): boolean {
  return (
    intent === "request_contact_create" ||
    intent === "request_contact_edit" ||
    intent === "request_contact_delete" ||
    intent === "draft_message"
  );
}

function requiredToolForInterpretation(interpretation: MessageInterpretation): AgentToolCall | undefined {
  if (interpretation.intent === "list_people") {
    return "list_people";
  }

  if (interpretation.intent === "list_people_detail") {
    return "list_people_detail";
  }

  if (interpretation.intent === "duplicate_audit") {
    return "find_duplicate_people";
  }

  if (interpretation.intent === "search_memory") {
    if (interpretation.search?.mode === "list_people") {
      return "list_people";
    }

    if (interpretation.search?.mode === "lookup_person") {
      return "list_people_detail";
    }

    return "search_memories";
  }

  if (interpretation.intent === "capture_memory") {
    return "create_manual_memory";
  }

  if (interpretation.intent === "ignore_candidate") {
    return "list_pending_candidates";
  }

  if (interpretation.intent === "update_memory") {
    return "update_memory";
  }

  if (interpretation.intent === "delete_memory") {
    return "delete_memory";
  }

  return undefined;
}

function toolLabel(tool: AgentToolCall): string {
  if (tool === "search_memories") {
    return "memory search tool";
  }

  return `${tool} tool`;
}
