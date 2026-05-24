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
      config: { enabled: false, provider: "openai", model: "test/model", maxLength: 280, apiKey: "" }
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
      config: { enabled: true, provider: "openai", model: "test/model", maxLength: 280, apiKey: "key" },
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
      config: { enabled: true, provider: "openai", model: "test/model", maxLength: 280, apiKey: "key" },
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
      config: { enabled: true, provider: "openai", model: "test/model", maxLength: 280, apiKey: "key" },
      fetchImpl
    });

    expect(result.text).toBe(polished);
    expect(result.expressionUsed).toBe(true);
    expect(result.validationPassed).toBe(true);
    expect(result.expressionModel).toBe("test/model");
  });

  it("uses the OpenAI chat completions endpoint for OpenAI expression config", async () => {
    const polished = "Yeah, I think that was Sarah Fan — Photon Residency II, community lead.";
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return Response.json({
        choices: [{ message: { content: polished } }]
      });
    });

    await composeExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      config: { enabled: true, provider: "openai", model: "gpt-4o-mini", maxLength: 280, apiKey: "openai-key" },
      fetchImpl
    });

    const body = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer openai-key",
      "Content-Type": "application/json"
    });
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.max_completion_tokens).toBe(120);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  it("returns draft when fetch aborts", async () => {
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    const result = await composeExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      config: { enabled: true, provider: "openai", model: "test/model", maxLength: 280, apiKey: "key" },
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
