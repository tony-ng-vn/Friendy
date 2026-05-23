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

const FALSE_VALUES = new Set(["0", "false", "off", "no"]);

/** Reads strict mode without mutating process state. Strict is on by default for live routing. */
export function readFriendyStrictMode(env: EnvLike = process.env): boolean {
  const raw = env.FRIENDY_STRICT_MODE?.trim().toLowerCase();
  if (!raw) {
    return true;
  }
  return !FALSE_VALUES.has(raw);
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
