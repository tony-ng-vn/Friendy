import type { MessageInterpretation } from "./interpretation";
import type { ConversationState } from "./conversationState";
import type { AgentToolCall } from "./types";

export type ValidatedRoutePolicy =
  | { decision: "allow"; reason: string; suppressPendingReminder: boolean }
  | { decision: "clarify"; reason: string; question: string; suppressPendingReminder: boolean }
  | { decision: "reject"; reason: string; redirect: string; suppressPendingReminder: boolean }
  | { decision: "unsupported"; reason: string; outboundText: string; suppressPendingReminder: boolean };

const SUPPRESS_PENDING_REMINDER_INTENTS = new Set<MessageInterpretation["intent"]>([
  "list_people",
  "duplicate_audit",
  "explain_agent_state",
  "explain_pending_workflow",
  "conversation_repair",
  "delete_memory_request",
  "delete_memory",
  "update_memory",
  "clarify",
  "reject"
]);

/** True when a successful route should not append the open pending-contact reminder. */
export function shouldSuppressPendingReminder(intent: MessageInterpretation["intent"]): boolean {
  if (SUPPRESS_PENDING_REMINDER_INTENTS.has(intent)) {
    return true;
  }

  return false;
}

/** Validates interpreter output against durable and conversation state before tools run. */
export function validateRoutePolicy(
  interpretation: MessageInterpretation,
  pendingState: ConversationState
): ValidatedRoutePolicy {
  const suppressPendingReminder =
    shouldSuppressPendingReminder(interpretation.intent) || interpretation.search?.mode === "list_people";

  if (interpretation.intent === "clarify") {
    return {
      decision: "allow",
      reason: "Interpreter returned an explicit clarify route.",
      suppressPendingReminder: true
    };
  }

  if (interpretation.intent === "unknown") {
    return {
      decision: "clarify",
      reason: "Interpreter returned unknown instead of an executable Friendy route.",
      question: interpretation.clarificationQuestion || "Should I save this as a memory or search for someone?",
      suppressPendingReminder: true
    };
  }

  if (isUnsupportedIntent(interpretation.intent)) {
    return {
      decision: "unsupported",
      reason: `Intent ${interpretation.intent} is not implemented by deterministic Friendy tools.`,
      outboundText:
        "I can't edit Apple Contacts yet. I can save or update Friendy relationship memory, but I will not change Apple Contacts silently.",
      suppressPendingReminder: true
    };
  }

  if (interpretation.intent === "reject") {
    return {
      decision: "reject",
      reason: "Route marked reject by interpreter.",
      redirect:
        "That is outside Friendy's relationship-memory scope. Tell me the person, contact, memory, follow-up, or message you want help with.",
      suppressPendingReminder: true
    };
  }

  if (interpretation.needsClarification) {
    return {
      decision: "clarify",
      reason: "Route requires clarification before executing tools.",
      question: interpretation.clarificationQuestion || "What do you remember about them?",
      suppressPendingReminder: true
    };
  }

  if (
    (interpretation.intent === "answer_pending_contact_prompt" ||
      interpretation.intent === "capture_pending_contact_context") &&
    !pendingState.activeFrame
  ) {
    return {
      decision: "clarify",
      reason: "No active pending contact frame for context capture.",
      question: "Who should I attach that relationship context to?",
      suppressPendingReminder: true
    };
  }

  if (interpretation.intent === "ignore_candidate" && pendingState.pendingContactQueue.length === 0) {
    return {
      decision: "allow",
      reason: "Allow ignore route to explain missing pending candidates.",
      suppressPendingReminder: true
    };
  }

  return {
    decision: "allow",
    reason: `Allowed route ${interpretation.intent}.`,
    suppressPendingReminder
  };
}

export function validateRequiredToolAvailability(
  interpretation: MessageInterpretation,
  tools: Record<AgentToolCall, unknown>
): ValidatedRoutePolicy | undefined {
  const requiredTool = requiredToolForInterpretation(interpretation);
  if (!requiredTool || typeof tools[requiredTool] === "function") {
    return undefined;
  }

  return {
    decision: "unsupported",
    reason: `Required tool ${requiredTool} is not available for intent ${interpretation.intent}.`,
    outboundText: `I can't complete that because the ${toolLabel(requiredTool)} is not available right now.`,
    suppressPendingReminder: shouldSuppressPendingReminder(interpretation.intent)
  };
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

  if (interpretation.intent === "duplicate_audit") {
    return "find_duplicate_people";
  }

  if (interpretation.intent === "search_memory") {
    return interpretation.search?.mode === "list_people" ? "list_people" : "search_memories";
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
