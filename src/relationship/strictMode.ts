import type { FriendyTrace } from "./trace";

export type FriendyStrictModeErrorCode =
  | "MODEL_INTERPRETATION_FAILED"
  | "INVALID_ROUTE_SCHEMA"
  | "UNKNOWN_ROUTE"
  | "TOOL_NOT_AVAILABLE"
  | "FALLBACK_USED"
  | "UNSUPPORTED_INTENT"
  | "UNEXPECTED_AMBIGUITY";

type EnvLike = Partial<Record<string, string | undefined>>;

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

/** Reads the opt-in strict-mode flag without mutating process state. */
export function readFriendyStrictMode(env: EnvLike = process.env): boolean {
  const raw = env.FRIENDY_STRICT_MODE?.trim().toLowerCase();
  return raw ? TRUE_VALUES.has(raw) : false;
}

export class FriendyStrictModeError extends Error {
  readonly code: FriendyStrictModeErrorCode;
  readonly trace: FriendyTrace;

  constructor(code: FriendyStrictModeErrorCode, message: string, trace: FriendyTrace) {
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
  trace: FriendyTrace;
}): void {
  if (input.strictMode && !input.condition) {
    throw new FriendyStrictModeError(input.code, input.message, input.trace);
  }
}
