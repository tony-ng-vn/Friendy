import { describe, expect, it, vi } from "vitest";
import { composeExpressionReply, polishOutboundText } from "./expressionComposer";
import { buildSearchSingleMatchBundle } from "./expressionFacts";

const bundle = buildSearchSingleMatchBundle({
  draft: "I think that was Sarah Fan.",
  match: { displayName: "Sarah Fan", event: "Photon Residency II", noteSnippet: "community lead" }
});

describe("composeExpressionReply", () => {
  it("returns draft when expression is disabled", async () => {
    const result = await composeExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      config: { enabled: false, model: "test/model", maxLength: 280, apiKey: "" }
    });

    expect(result).toEqual({
      text: bundle.deterministicDraft,
      expressionUsed: false,
      validationPassed: false,
      fallbackReason: "disabled"
    });
  });

  it("returns draft on API error", async () => {
    const fetchImpl = vi.fn(async () => new Response("fail", { status: 500 }));

    const result = await composeExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      config: { enabled: true, model: "test/model", maxLength: 280, apiKey: "key" },
      fetchImpl
    });

    expect(result.text).toBe(bundle.deterministicDraft);
    expect(result.expressionUsed).toBe(true);
    expect(result.validationPassed).toBe(false);
    expect(result.fallbackReason).toBe("api_error");
  });

  it("returns draft when validator rejects output", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: "High-confidence match located in your memory database." } }]
      })
    );

    const result = await composeExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      config: { enabled: true, model: "test/model", maxLength: 280, apiKey: "key" },
      fetchImpl
    });

    expect(result.text).toBe(bundle.deterministicDraft);
    expect(result.validationPassed).toBe(false);
    expect(result.fallbackReason).toBe("validation_failed");
  });

  it("returns polished text when API and validator pass", async () => {
    const polished = "Yeah, I think that was Sarah Fan — Photon Residency II, community lead.";
    const fetchImpl = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: polished } }]
      })
    );

    const result = await composeExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      config: { enabled: true, model: "test/model", maxLength: 280, apiKey: "key" },
      fetchImpl
    });

    expect(result.text).toBe(polished);
    expect(result.expressionUsed).toBe(true);
    expect(result.validationPassed).toBe(true);
    expect(result.expressionModel).toBe("test/model");
  });

  it("returns draft when fetch aborts", async () => {
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    const result = await composeExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      config: { enabled: true, model: "test/model", maxLength: 280, apiKey: "key" },
      fetchImpl
    });

    expect(result.text).toBe(bundle.deterministicDraft);
    expect(result.fallbackReason).toBe("api_error");
  });
});

describe("polishOutboundText", () => {
  it("returns draft unchanged when no bundle is provided", async () => {
    const result = await polishOutboundText({ draft: "Hello there." });
    expect(result.text).toBe("Hello there.");
    expect(result.fallbackReason).toBe("unsupported_kind");
  });
});
