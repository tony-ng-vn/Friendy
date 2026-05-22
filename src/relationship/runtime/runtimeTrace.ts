import { createHash } from "node:crypto";
import type { AgentToolCall } from "../types";

export type AgentTrace = {
  traceId: string;
  createdAt: string;
  inboundTextRedacted?: string;
  scopeDecision: string;
  interpretedIntent?: { intent: string; confidence?: number };
  toolCalls: Array<{ name: AgentToolCall; result: "success" | "error" | "blocked" }>;
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
  errors?: string[];
  now?: string;
};

/** Builds a local runtime trace that preserves decision shape while redacting private text. */
export function buildRedactedInteractionTrace(input: TraceInput): AgentTrace {
  return {
    traceId: `trace_${hashValue([input.inboundText, input.outboundText, input.now ?? ""].join("\0"))}`,
    createdAt: input.now ?? new Date().toISOString(),
    inboundTextRedacted: redactTextShape(input.inboundText),
    scopeDecision: scopeDecisionFromInterpretation(input.interpretedIntentJson),
    interpretedIntent: intentFromInterpretation(input.interpretedIntentJson),
    toolCalls: input.toolCalls.map((name) => ({ name, result: "success" })),
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

function intentFromInterpretation(value: unknown): AgentTrace["interpretedIntent"] {
  if (typeof value !== "object" || value === null || !("intent" in value)) {
    return { intent: "unknown" };
  }

  const intent = String((value as { intent: unknown }).intent);
  const confidence = (value as { confidence?: unknown }).confidence;
  return typeof confidence === "number" ? { intent, confidence } : { intent };
}

function scopeDecisionFromInterpretation(value: unknown): string {
  if (typeof value !== "object" || value === null || !("scopeDecision" in value)) {
    return "relationship_memory";
  }

  const scopeDecision = (value as { scopeDecision?: unknown }).scopeDecision;
  if (typeof scopeDecision === "object" && scopeDecision !== null && "scope" in scopeDecision) {
    return String((scopeDecision as { scope: unknown }).scope);
  }

  return "relationship_memory";
}

function redactTextShape(value: string): string {
  return `redacted:sha256:${hashValue(value)}:length:${value.length}`;
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
