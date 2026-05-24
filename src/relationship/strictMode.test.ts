import { describe, expect, it } from "vitest";
import { FriendyStrictModeError, readFriendyStrictMode } from "./strictMode";
import type { FriendyTrace } from "./trace";

describe("readFriendyStrictMode", () => {
  it("treats missing and empty values as enabled", () => {
    expect(readFriendyStrictMode({})).toBe(true);
    expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "" })).toBe(true);
  });

  it("treats explicit false-like values as disabled", () => {
    expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "0" })).toBe(false);
    expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "false" })).toBe(false);
    expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "off" })).toBe(false);
    expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "no" })).toBe(false);
  });

  it("treats supported truthy values as enabled case-insensitively", () => {
    expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "1" })).toBe(true);
    expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "true" })).toBe(true);
    expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "TRUE" })).toBe(true);
    expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "yes" })).toBe(true);
    expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "on" })).toBe(true);
    expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "unexpected" })).toBe(true);
  });
});

describe("FriendyStrictModeError", () => {
  it("exposes a stable strict-mode code and trace envelope", () => {
    const trace: FriendyTrace = {
      strictMode: true,
      routeSource: "fallback",
      fallbackUsed: true,
      fallbackReason: "missing_model_api_key",
      policyDecision: "reject",
      toolCalls: []
    } as const;

    const error = new FriendyStrictModeError("FALLBACK_USED", "Fallback is not allowed in strict mode.", trace);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("FriendyStrictModeError");
    expect(error.code).toBe("FALLBACK_USED");
    expect(error.message).toBe("Fallback is not allowed in strict mode.");
    expect(error.trace).toEqual(trace);
  });
});
