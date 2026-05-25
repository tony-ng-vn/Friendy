/**
 * Structured per-turn trace for evals, strict-mode errors, and interaction logging.
 *
 * Captures route source, policy outcome, pending-reminder decision, and tool call list
 * without embedding full model payloads.
 */
import type { MessageInterpretation } from "./interpretation";
import type { PendingReminderReason } from "./pendingReminderPolicy";
import type { AgentToolCall } from "./types";

export type FriendyRouteSource = "llm" | "deterministic" | "fallback" | "scope_boundary";
export type FriendyPolicyDecision = "allow" | "clarify" | "reject" | "unsupported";
export type FriendyScopeDecision = "in_scope" | "out_of_scope" | "clarify";
export type ActiveWorkflowKind =
  | "pending_contact_confirm"
  | "duplicate_resolution"
  | "pending_delete_disambiguation"
  | "pending_delete_confirm"
  | "pending_update_confirm"
  | "pending_apple_contact_create"
  | "pending_apple_contact_update"
  | "pending_apple_contact_delete"
  | "pending_additional_memory"
  | "none";

export type FriendyRouteTrace = {
  domain?: MessageInterpretation["domain"];
  intent: MessageInterpretation["intent"] | string;
  confidence?: number;
  conversationRelation?: MessageInterpretation["conversationRelation"];
  searchMode?: NonNullable<MessageInterpretation["search"]>["mode"];
  exactTerms?: string[];
  target?: {
    frameId?: string;
    candidateId?: string;
    memoryId?: string;
    hasDisplayName?: boolean;
  };
};

/** Serializable routing and policy metadata attached to each agent turn. */
export type FriendyTrace = {
  strictMode: boolean;
  routeSource: FriendyRouteSource;
  fallbackUsed: boolean;
  fallbackReason?: string;
  route?: FriendyRouteTrace;
  policyDecision?: FriendyPolicyDecision;
  suppressedPendingReminder?: boolean;
  pendingReminderDecision?: "suppressed" | "deferred" | "appended_footer";
  pendingReminderReason?: PendingReminderReason;
  activeFrameId?: string;
  activeCandidateId?: string;
  activeMemoryId?: string;
  toolCalls: AgentToolCall[];
  scopeDecision?: FriendyScopeDecision;
  activeWorkflowKind?: ActiveWorkflowKind;
  selectedTool?: AgentToolCall | string;
  modelRequested?: string;
  modelResponseSchemaValid?: boolean;
  modelErrorCode?: string;
  modelCalled?: boolean;
  targetQueryRaw?: string;
  targetQueryCleaned?: string;
  lookupProjection?: string;
  matchReason?: string;
  requiresConfirmation?: boolean;
  invalidModelSchemaRecovery?: string;
};

/** Builds a normalized trace with safe defaults for missing optional fields. */
export function createFriendyTrace(input: {
  strictMode: boolean;
  routeSource: FriendyRouteSource;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  route?: unknown;
  policyDecision?: FriendyPolicyDecision;
  suppressedPendingReminder?: boolean;
  pendingReminderDecision?: "suppressed" | "deferred" | "appended_footer";
  pendingReminderReason?: PendingReminderReason;
  activeFrameId?: string;
  activeCandidateId?: string;
  activeMemoryId?: string;
  toolCalls?: AgentToolCall[];
  scopeDecision?: FriendyScopeDecision;
  activeWorkflowKind?: ActiveWorkflowKind;
  selectedTool?: AgentToolCall | string;
  modelRequested?: string;
  modelResponseSchemaValid?: boolean;
  modelErrorCode?: string;
  modelCalled?: boolean;
  targetQueryRaw?: string;
  targetQueryCleaned?: string;
  lookupProjection?: string;
  matchReason?: string;
  requiresConfirmation?: boolean;
  invalidModelSchemaRecovery?: string;
}): FriendyTrace {
  return {
    strictMode: input.strictMode,
    routeSource: input.routeSource,
    fallbackUsed: input.fallbackUsed ?? input.routeSource === "fallback",
    fallbackReason: input.fallbackReason,
    route: routeTraceFromUnknown(input.route),
    policyDecision: input.policyDecision,
    suppressedPendingReminder: input.suppressedPendingReminder,
    pendingReminderDecision: input.pendingReminderDecision,
    pendingReminderReason: input.pendingReminderReason,
    activeFrameId: input.activeFrameId,
    activeCandidateId: input.activeCandidateId,
    activeMemoryId: input.activeMemoryId,
    toolCalls: input.toolCalls ?? [],
    scopeDecision: input.scopeDecision,
    activeWorkflowKind: input.activeWorkflowKind,
    selectedTool: input.selectedTool,
    modelRequested: input.modelRequested,
    modelResponseSchemaValid: input.modelResponseSchemaValid,
    modelErrorCode: input.modelErrorCode,
    modelCalled: input.modelCalled,
    targetQueryRaw: input.targetQueryRaw,
    targetQueryCleaned: input.targetQueryCleaned,
    lookupProjection: input.lookupProjection,
    matchReason: input.matchReason,
    requiresConfirmation: input.requiresConfirmation,
    invalidModelSchemaRecovery: input.invalidModelSchemaRecovery
  };
}

/** Normalizes loose interpretation objects into a bounded route trace slice. */
export function routeTraceFromUnknown(value: unknown): FriendyRouteTrace | undefined {
  if (typeof value !== "object" || value === null || !("intent" in value)) {
    return undefined;
  }

  const route = value as {
    domain?: unknown;
    intent?: unknown;
    confidence?: unknown;
    conversationRelation?: unknown;
    search?: { mode?: unknown; exactTerms?: unknown };
    target?: { frameId?: unknown; candidateId?: unknown; memoryId?: unknown; displayName?: unknown };
  };

  return {
    domain: typeof route.domain === "string" ? (route.domain as MessageInterpretation["domain"]) : undefined,
    intent: String(route.intent ?? "unknown"),
    confidence: typeof route.confidence === "number" ? route.confidence : undefined,
    conversationRelation:
      typeof route.conversationRelation === "string"
        ? (route.conversationRelation as MessageInterpretation["conversationRelation"])
        : undefined,
    searchMode:
      typeof route.search?.mode === "string" ? (route.search.mode as NonNullable<MessageInterpretation["search"]>["mode"]) : undefined,
    exactTerms: Array.isArray(route.search?.exactTerms) ? route.search.exactTerms.map(String) : undefined,
    target:
      route.target && typeof route.target === "object"
        ? {
            frameId: typeof route.target.frameId === "string" ? route.target.frameId : undefined,
            candidateId: typeof route.target.candidateId === "string" ? route.target.candidateId : undefined,
            memoryId: typeof route.target.memoryId === "string" ? route.target.memoryId : undefined,
            hasDisplayName: typeof route.target.displayName === "string" ? true : undefined
          }
        : undefined
  };
}

/** Unwraps a nested `{ trace }` payload or returns a minimal deterministic fallback. */
export function extractFriendyTrace(value: unknown): FriendyTrace {
  if (
    typeof value === "object" &&
    value !== null &&
    "trace" in value &&
    isFriendyTrace((value as { trace?: unknown }).trace)
  ) {
    return (value as { trace: FriendyTrace }).trace;
  }

  return createFriendyTrace({
    strictMode: false,
    routeSource: "deterministic",
    fallbackUsed: false,
    toolCalls: []
  });
}

function isFriendyTrace(value: unknown): value is FriendyTrace {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const trace = value as Partial<FriendyTrace>;
  return (
    typeof trace.strictMode === "boolean" &&
    (trace.routeSource === "llm" ||
      trace.routeSource === "deterministic" ||
      trace.routeSource === "fallback" ||
      trace.routeSource === "scope_boundary") &&
    typeof trace.fallbackUsed === "boolean" &&
    Array.isArray(trace.toolCalls)
  );
}
