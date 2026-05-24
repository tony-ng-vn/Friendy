import { describe, expect, it } from "vitest";
import { hashNormalizedContactMethod, redactEmailMethod, redactPhoneMethod } from "./contactMethodRedaction";

describe("contactMethodRedaction", () => {
  it("redacts phone values into stable hashes and last4 hints", () => {
    const left = redactPhoneMethod("+1 (555) 010-0101");
    const right = redactPhoneMethod("+15550100101");

    expect(left.label).toBe("ending in 0101");
    expect(left.hint).toEqual({ last4: "0101", label: "unknown" });
    expect(left.hash).toBe(right.hash);
    expect(left.hash).toBe(hashNormalizedContactMethod("phone", "+15550100101"));
  });

  it("redacts email values into stable hashes and domain hints", () => {
    const redacted = redactEmailMethod("Friendy101@Example.com");

    expect(redacted.label).toBe("email at example.com");
    expect(redacted.hint).toEqual({ domain: "example.com", label: "unknown" });
    expect(redacted.hash).toBe(hashNormalizedContactMethod("email", "friendy101@example.com"));
  });
});
