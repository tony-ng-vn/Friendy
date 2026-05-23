import type { AgentToolCall } from "./types";

export type FriendyStrictModeErrorCode =
  | "MODEL_INTERPRETATION_FAILED"
  | "INVALID_ROUTE_SCHEMA"
  | "UNKNOWN_ROUTE"
  | "TOOL_NOT_AVAILABLE"
  | "FALLBACK_USED"
  | "UNSUPPORTED_INTENT"
  | "UNEXPECTED_AMBIGUITY";

export type FriendyTraceRouteSource = "llm" | "deterministic" | "fallback";
export type FriendyTracePolicyDecision = "allow" | "clarify" | "reject" | "unsupported";

export type FriendyStrictTrace = {
  strictMode: boolean;
  routeSource: FriendyTraceRouteSource;
  fallbackUsed: boolean;
  fallbackReason?: string;
  route?: unknown;
  policyDecision?: FriendyTracePolicyDecision;
  activeFrameId?: string;
  activeCandidateId?: string;
  activeMemoryId?: string;
  toolCalls: AgentToolCall[];
};

type EnvLike = Partial<Record<string, string | undefined>>;

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

/** Reads the opt-in strict-mode flag without mutating process state. */
export function readFriendyStrictMode(env: EnvLike = process.env): boolean {
  const raw = env.FRIENDY_STRICT_MODE?.trim().toLowerCase();
  return raw ? TRUE_VALUES.has(raw) : false;
}

export class FriendyStrictModeError extends Error {
  readonly code: FriendyStrictModeErrorCode;
  readonly trace: FriendyStrictTrace;

  constructor(code: FriendyStrictModeErrorCode, message: string, trace: FriendyStrictTrace) {
    super(message);
    this.name = "FriendyStrictModeError";
    this.code = code;
    this.trace = trace;
  }
}

export function assertStrictModeAllowed(input: {
  strictMode: boolean;
  condition: boolean;
  code: FriendyStrictModeErrorCode;
  message: string;
  trace: FriendyStrictTrace;
}): void {
  if (input.strictMode && !input.condition) {
    throw new FriendyStrictModeError(input.code, input.message, input.trace);
  }
}
