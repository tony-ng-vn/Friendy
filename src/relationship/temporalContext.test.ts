import { describe, expect, it } from "vitest";
import { parseTemporalContext } from "./temporalContext";

describe("temporal context parsing", () => {
  it("normalizes relative date phrases with a reference instant and timezone", () => {
    const context = parseTemporalContext("I met Maya yesterday at the dinner", {
      receivedAt: "2026-05-20T20:00:00.000-07:00",
      timezone: "America/Los_Angeles"
    });

    expect(context).toMatchObject({
      rawText: "yesterday",
      localDate: "2026-05-19",
      timezone: "America/Los_Angeles"
    });
    expect(context?.startsAt).toBeTruthy();
  });

  it("returns undefined when the message has no date phrase", () => {
    expect(
      parseTemporalContext("I met Felix Ng who goes to UBC", {
        receivedAt: "2026-05-20T20:00:00.000-07:00",
        timezone: "America/Los_Angeles"
      })
    ).toBeUndefined();
  });
});
