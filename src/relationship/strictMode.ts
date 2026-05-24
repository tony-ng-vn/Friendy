/**
 * Strict routing mode: fail loudly instead of silent rule-based fallback.
 *
 * Controlled by `FRIENDY_STRICT_MODE` (default on). Errors carry a {@link FriendyTrace}
 * for eval replay and production debugging.
 */
import type { FriendyTrace } from "./trace";

/** Machine-readable failure reason when strict mode rejects a route or tool path. */
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

/** Thrown when strict mode disallows fallback, unknown routes, or missing tools. */
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

/** Throws {@link FriendyStrictModeError} when `strictMode` is on and `condition` is false. */
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
