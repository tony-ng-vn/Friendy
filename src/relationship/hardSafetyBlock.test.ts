import { describe, expect, it } from "vitest";
import { decideHardSafety } from "./hardSafetyBlock";

describe("hard safety block", () => {
  it("allows relationship-meta questions blocked by the old scope gate", () => {
    for (const text of [
      "Do you see you are having duplicate people in your contacts?",
      "Why u still asking for testing 3 context when u already have it?",
      "Can you help me delete Unamed Contact from your memory?",
      "List me in bullet of all people I met testing friendy"
    ]) {
      expect(decideHardSafety(text)).toMatchObject({ decision: "allow" });
    }
  });
});
