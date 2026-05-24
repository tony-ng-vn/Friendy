import { describe, expect, it } from "vitest";
import { buildExpressionSystemPrompt, buildExpressionUserMessage } from "./expressionPrompt";
import { buildSearchSingleMatchBundle } from "./expressionFacts";

describe("expressionPrompt", () => {
  it("includes buddy voice and hard grounding rules", () => {
    const prompt = buildExpressionSystemPrompt();
    expect(prompt).toContain("relationship-memory buddy");
    expect(prompt).toContain("yeah");
    expect(prompt).toContain("Use ONLY facts present in the fact bundle");
    expect(prompt).toContain("manual contact");
    expect(prompt).toContain("Plain text only");
  });

  it("builds user message with draft and bundle JSON", () => {
    const bundle = buildSearchSingleMatchBundle({
      draft: "I think that was Sarah Fan.",
      match: { displayName: "Sarah Fan", event: "Photon Residency II" }
    });
    const message = buildExpressionUserMessage({ draft: bundle.deterministicDraft, bundle });
    expect(message).toContain("deterministic draft");
    expect(message).toContain("Sarah Fan");
    expect(message).toContain("Photon Residency II");
  });
});
