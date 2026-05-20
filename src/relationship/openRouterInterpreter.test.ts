import { describe, expect, it } from "vitest";
import { demoUser } from "./fixtures";
import {
  DEFAULT_OPENROUTER_MODEL,
  createOpenRouterInterpreter,
  createRuleBasedInterpreter,
  readOpenRouterConfig
} from "./openRouterInterpreter";
import type { InboundAgentMessage } from "./types";

const inbound: InboundAgentMessage = {
  userId: demoUser.id,
  platform: "terminal",
  text: "Who I have met at the Residency?",
  receivedAt: "2026-05-20T12:00:00.000Z"
};

describe("openrouter message interpreter", () => {
  it("sends OpenRouter a strict structured-output request with the configured model", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "search_memory",
                confidence: 0.86,
                people: [],
                event: { name: "Residency", dateText: "", location: "" },
                contextNote: "",
                query: "people I met at the Residency",
                tags: ["Residency"],
                needsClarification: false,
                clarificationQuestion: ""
              })
            }
          }
        ]
      });
    };

    const interpreter = createOpenRouterInterpreter({
      apiKey: "test-key",
      model: "nvidia/nemotron-3-super-120b-a12b:free",
      fetchImpl
    });

    const result = await interpreter.interpret(inbound);
    const body = JSON.parse(String(calls[0].init.body));

    expect(result.interpretation.intent).toBe("search_memory");
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json"
    });
    expect(body.model).toBe("nvidia/nemotron-3-super-120b-a12b:free");
    expect(body.temperature).toBe(0);
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "friendy_message_interpretation",
        strict: true
      }
    });
  });

  it("retries invalid model output once before returning the valid interpretation", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          choices: [{ message: { content: JSON.stringify({ intent: "capture_memory", confidence: 2 }) } }]
        });
      }

      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "search_memory",
                confidence: 0.75,
                people: [],
                event: { name: "Residency", dateText: "", location: "" },
                contextNote: "",
                query: "people I met at the Residency",
                tags: ["Residency"],
                needsClarification: false,
                clarificationQuestion: ""
              })
            }
          }
        ]
      });
    };

    const interpreter = createOpenRouterInterpreter({ apiKey: "test-key", model: "model", fetchImpl });
    const result = await interpreter.interpret(inbound);

    expect(calls).toBe(2);
    expect(result.interpretation.intent).toBe("search_memory");
    expect(result.error).toBe("");
  });

  it("falls back when OpenRouter keeps returning invalid output", async () => {
    const interpreter = createOpenRouterInterpreter({
      apiKey: "test-key",
      model: "model",
      fetchImpl: async () =>
        jsonResponse({
          choices: [{ message: { content: JSON.stringify({ intent: "capture_memory", confidence: 2 }) } }]
        }),
      fallback: createRuleBasedInterpreter()
    });

    const result = await interpreter.interpret({
      ...inbound,
      text: "I met Amaya at Photon Residency II, and me and him sleep on the same bed cuz we ran out of bed :("
    });

    expect(result.interpretation.intent).toBe("capture_memory");
    expect(result.interpretation.people[0].name).toBe("Amaya");
    expect(result.modelUsed).toBe("rule-based-fallback");
    expect(result.error).toContain("Invalid message interpretation");
  });

  it("uses deterministic fallback when no OpenRouter API key exists", async () => {
    const interpreter = createOpenRouterInterpreter({
      apiKey: "",
      model: DEFAULT_OPENROUTER_MODEL,
      fallback: createRuleBasedInterpreter()
    });

    const result = await interpreter.interpret({
      ...inbound,
      text: "Ok so at the residency, I also met Zhiyuan who also call zed, go to CMU, class 2028 and making swift project that allow you to control your computer through your phone with a clicky UI and similar function like Wisper Flow"
    });

    expect(result.interpretation.intent).toBe("capture_memory");
    expect(result.interpretation.people[0]).toMatchObject({
      name: "Zhiyuan",
      aliases: ["Zed"],
      companyOrSchool: "CMU",
      classYear: "2028"
    });
  });

  it("reads OpenRouter config with a stable free default model", () => {
    expect(readOpenRouterConfig({ OPENROUTER_API_KEY: "key" })).toEqual({
      apiKey: "key",
      model: DEFAULT_OPENROUTER_MODEL
    });
    expect(readOpenRouterConfig({ OPENROUTER_API_KEY: "key", OPENROUTER_MODEL: "custom-model" })).toEqual({
      apiKey: "key",
      model: "custom-model"
    });
  });
});

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => value
  } as Response;
}
