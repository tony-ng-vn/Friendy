import { createHash } from "node:crypto";
import { PENDING_REMINDER_REASON_CODES, type PendingReminderReason } from "../pendingReminderPolicy";
import type { FriendyTrace } from "../trace";
import type { AgentToolCall } from "../types";

export type AgentTrace = {
  traceId: string;
  createdAt: string;
  strictMode?: boolean;
  routeSource?: FriendyTrace["routeSource"];
  fallbackUsed?: boolean;
  fallbackReason?: string;
  policyDecision?: FriendyTrace["policyDecision"];
  pendingReminderDecision?: FriendyTrace["pendingReminderDecision"];
  pendingReminderReason?: PendingReminderReason;
  activeFrameId?: string;
  activeCandidateId?: string;
  activeMemoryId?: string;
  activeWorkflowKind?: FriendyTrace["activeWorkflowKind"];
  selectedTool?: FriendyTrace["selectedTool"];
  modelRequested?: string;
  modelResponseSchemaValid?: boolean;
  modelErrorCode?: string;
  friendyToolCalls?: AgentToolCall[];
  inboundTextRedacted?: string;
  scopeDecision?: string;
  interpretedIntent?: { intent: string; confidence?: number };
  toolCalls: Array<{ name: AgentToolCall; result: "success" | "error" | "blocked" }>;
  hardBlock?: { blocked: boolean; reason?: string };
  route?: {
    domain?: string;
    intent: string;
    confidence?: number;
    conversationRelation?: string;
    targetDisplayName?: string;
    targetCandidateId?: string;
    searchMode?: string;
    exactTerms?: string[];
    normalizedQuery?: string;
    hasExtractedContext?: boolean;
  };
  policy?: { decision: "allow" | "reject" | "clarify"; reason?: string };
  tools: Array<{ name: AgentToolCall; status: "called" | "skipped" | "failed" }>;
  candidateIdsTouched: string[];
  memoryIdsTouched: string[];
  search?: {
    queryRedacted?: string;
    topMatches: Array<{ memoryId: string; score: number; reasons: string[] }>;
    outcome: "single" | "ambiguous" | "none";
  };
  outboundTextRedacted?: string;
  model: { used: boolean; provider?: string; modelName?: string; fallbackUsed: boolean };
  errors: string[];
};

type TraceSearchInput = AgentTrace["search"] & {
  query?: string;
};

type TraceInput = {
  inboundText: string;
  interpretedIntentJson: unknown;
  toolCalls: AgentToolCall[];
  outboundText: string;
  candidateIdsTouched?: string[];
  memoryIdsTouched?: string[];
  search?: TraceSearchInput;
  model?: AgentTrace["model"];
  friendyTrace?: FriendyTrace;
  errors?: string[];
  now?: string;
};

/** Builds a local runtime trace that preserves decision shape while redacting private text. */
export function buildRedactedInteractionTrace(input: TraceInput): AgentTrace {
  return {
    traceId: `trace_${hashValue([input.inboundText, input.outboundText, input.now ?? ""].join("\0"))}`,
    createdAt: input.now ?? new Date().toISOString(),
    strictMode: input.friendyTrace?.strictMode,
    routeSource: input.friendyTrace?.routeSource,
    fallbackUsed: input.friendyTrace?.fallbackUsed,
    fallbackReason: input.friendyTrace?.fallbackReason,
    policyDecision: input.friendyTrace?.policyDecision,
    pendingReminderDecision: input.friendyTrace?.pendingReminderDecision,
    pendingReminderReason: safePendingReminderReason(input.friendyTrace?.pendingReminderReason),
    activeFrameId: input.friendyTrace?.activeFrameId,
    activeCandidateId: input.friendyTrace?.activeCandidateId,
    activeMemoryId: input.friendyTrace?.activeMemoryId,
    activeWorkflowKind: input.friendyTrace?.activeWorkflowKind,
    selectedTool: input.friendyTrace?.selectedTool,
    modelRequested: input.friendyTrace?.modelRequested,
    modelResponseSchemaValid: input.friendyTrace?.modelResponseSchemaValid,
    modelErrorCode: input.friendyTrace?.modelErrorCode,
    friendyToolCalls: input.friendyTrace?.toolCalls,
    inboundTextRedacted: redactTextShape(input.inboundText),
    scopeDecision: input.friendyTrace?.scopeDecision ?? scopeDecisionFromInterpretation(input.interpretedIntentJson),
    interpretedIntent: intentFromInterpretation(input.interpretedIntentJson),
    toolCalls: input.toolCalls.map((name) => ({ name, result: "success" })),
    hardBlock: hardBlockFromInterpretation(input.interpretedIntentJson),
    route: routeFromInterpretation(input.interpretedIntentJson),
    policy: policyFromInterpretation(input.interpretedIntentJson),
    tools: input.toolCalls.map((name) => ({ name, status: "called" })),
    candidateIdsTouched: input.candidateIdsTouched ?? [],
    memoryIdsTouched: input.memoryIdsTouched ?? [],
    search: redactSearch(input.search),
    outboundTextRedacted: redactTextShape(input.outboundText),
    model: input.model ?? { used: false, fallbackUsed: true },
    errors: input.errors?.map(() => "present") ?? []
  };
}

function redactSearch(search: TraceSearchInput | undefined): AgentTrace["search"] | undefined {
  if (!search) {
    return undefined;
  }

  return {
    queryRedacted: search.query ? redactTextShape(search.query) : search.queryRedacted,
    topMatches: search.topMatches.map((match) => ({
      memoryId: match.memoryId,
      score: match.score,
      reasons: match.reasons.map(() => "redacted_reason")
    })),
    outcome: search.outcome
  };
}

function safePendingReminderReason(value: unknown): PendingReminderReason | undefined {
  return typeof value === "string" && (PENDING_REMINDER_REASON_CODES as readonly string[]).includes(value)
    ? (value as PendingReminderReason)
    : undefined;
}

function hardBlockFromInterpretation(value: unknown): AgentTrace["hardBlock"] {
  if (typeof value !== "object" || value === null || !("scopeDecision" in value)) {
    return undefined;
  }

  const scopeDecision = (value as { scopeDecision?: unknown }).scopeDecision;
  if (typeof scopeDecision !== "object" || scopeDecision === null || !("scope" in scopeDecision)) {
    return undefined;
  }

  const scope = String((scopeDecision as { scope: unknown }).scope);
  if (scope !== "out_of_scope") {
    return undefined;
  }

  const reason = (scopeDecision as { reason?: unknown }).reason;
  return {
    blocked: true,
    reason: typeof reason === "string" ? reason : undefined
  };
}

function routeFromInterpretation(value: unknown): AgentTrace["route"] {
  if (typeof value !== "object" || value === null || !("intent" in value)) {
    return undefined;
  }

  const route = value as {
    intent?: unknown;
    confidence?: unknown;
    domain?: unknown;
    conversationRelation?: unknown;
    target?: { displayName?: unknown; candidateId?: unknown };
    extractedContext?: unknown;
    search?: { mode?: unknown; exactTerms?: unknown };
    normalizedQuery?: unknown;
  };

  return {
    domain: typeof route.domain === "string" ? route.domain : undefined,
    intent: String(route.intent ?? "unknown"),
    confidence: typeof route.confidence === "number" ? route.confidence : undefined,
    conversationRelation: typeof route.conversationRelation === "string" ? route.conversationRelation : undefined,
    targetDisplayName: typeof route.target?.displayName === "string" ? "present" : undefined,
    targetCandidateId: typeof route.target?.candidateId === "string" ? route.target.candidateId : undefined,
    searchMode: typeof route.search?.mode === "string" ? route.search.mode : undefined,
    exactTerms: Array.isArray(route.search?.exactTerms) ? route.search.exactTerms.map(String) : undefined,
    normalizedQuery: typeof route.normalizedQuery === "string" ? route.normalizedQuery : undefined,
    hasExtractedContext: typeof route.extractedContext === "string" && route.extractedContext.length > 0 ? true : undefined
  };
}

function policyFromInterpretation(value: unknown): AgentTrace["policy"] {
  if (typeof value !== "object" || value === null || !("policyDecision" in value)) {
    return undefined;
  }

  const policyDecision = (value as { policyDecision?: unknown }).policyDecision;
  if (typeof policyDecision !== "object" || policyDecision === null || !("decision" in policyDecision)) {
    return undefined;
  }

  const decision = String((policyDecision as { decision: unknown }).decision);
  if (decision !== "allow" && decision !== "reject" && decision !== "clarify") {
    return undefined;
  }

  const reason = (policyDecision as { reason?: unknown }).reason;
  return {
    decision,
    reason: typeof reason === "string" ? reason : undefined
  };
}

function intentFromInterpretation(value: unknown): AgentTrace["interpretedIntent"] {
  if (typeof value !== "object" || value === null || !("intent" in value)) {
    return { intent: "unknown" };
  }

  const intent = String((value as { intent: unknown }).intent);
  const confidence = (value as { confidence?: unknown }).confidence;
  return typeof confidence === "number" ? { intent, confidence } : { intent };
}

function scopeDecisionFromInterpretation(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("scopeDecision" in value)) {
    return undefined;
  }

  const scopeDecision = (value as { scopeDecision?: unknown }).scopeDecision;
  if (typeof scopeDecision === "object" && scopeDecision !== null && "scope" in scopeDecision) {
    return String((scopeDecision as { scope: unknown }).scope);
  }

  return undefined;
}

function redactTextShape(value: string): string {
  return `redacted:sha256:${hashValue(value)}:length:${value.length}`;
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
