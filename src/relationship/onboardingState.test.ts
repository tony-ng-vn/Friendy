import { describe, expect, it } from "vitest";
import { reduceOnboardingState } from "./onboardingState";

describe("Friendy onboarding state", () => {
  it("requires user start before active contact memory", () => {
    const ready = reduceOnboardingState("permissions_pending", { type: "permissions_ready" });
    expect(ready).toBe("ready_pending_user_start");

    const active = reduceOnboardingState(ready, { type: "user_started" });
    expect(active).toBe("active");
  });

  it("supports pause and resume", () => {
    expect(reduceOnboardingState("active", { type: "pause" })).toBe("paused");
    expect(reduceOnboardingState("paused", { type: "resume" })).toBe("active");
  });
});
