import { describe, expect, it } from "vitest";
import { fixtureUser } from "./fixtures";
import {
  DEFAULT_OPENROUTER_MODEL,
  createOpenRouterInterpreter,
  createRuleBasedInterpreter,
  readOpenRouterConfig
} from "./openRouterInterpreter";
import { FriendyStrictModeError } from "./strictMode";
import type { InboundAgentMessage } from "./types";

const inbound: InboundAgentMessage = {
  userId: fixtureUser.id,
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
    expect(result.routeSource).toBe("llm");
    expect(result.fallbackUsed).toBe(false);
    expect(result.fallbackReason).toBeUndefined();
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
    expect(body.messages[0].content).toContain("Calendar guesses are suggestions");
    expect(body.messages[0].content).toContain("Return JSON that matches the provided schema");
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
    expect(result.routeSource).toBe("fallback");
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toBe("invalid_model_output");
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
    expect(result.routeSource).toBe("fallback");
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toBe("missing_openrouter_api_key");
  });

  it("throws instead of using fallback when strict mode has no OpenRouter API key", async () => {
    const interpreter = createOpenRouterInterpreter({
      apiKey: "",
      model: DEFAULT_OPENROUTER_MODEL,
      strictMode: true,
      fallback: createRuleBasedInterpreter()
    });

    await expect(interpreter.interpret(inbound)).rejects.toMatchObject({
      name: "FriendyStrictModeError",
      code: "FALLBACK_USED",
      trace: {
        strictMode: true,
        routeSource: "fallback",
        fallbackUsed: true,
        fallbackReason: "missing_openrouter_api_key"
      }
    });
  });

  it("throws invalid schema errors in strict mode without calling fallback", async () => {
    let fallbackCalls = 0;
    const interpreter = createOpenRouterInterpreter({
      apiKey: "test-key",
      model: "model",
      strictMode: true,
      fetchImpl: async () =>
        jsonResponse({
          choices: [{ message: { content: JSON.stringify({ intent: "capture_memory", confidence: 2 }) } }]
        }),
      fallback: {
        async interpret() {
          fallbackCalls += 1;
          return createRuleBasedInterpreter().interpret(inbound);
        }
      }
    });

    await expect(interpreter.interpret(inbound)).rejects.toBeInstanceOf(FriendyStrictModeError);
    await expect(interpreter.interpret(inbound)).rejects.toMatchObject({
      code: "INVALID_ROUTE_SCHEMA",
      trace: {
        strictMode: true,
        routeSource: "llm",
        fallbackUsed: false,
        fallbackReason: "invalid_model_output"
      }
    });
    expect(fallbackCalls).toBe(0);
  });

  it("throws model execution errors in strict mode without calling fallback", async () => {
    let fallbackCalls = 0;
    const interpreter = createOpenRouterInterpreter({
      apiKey: "test-key",
      model: "model",
      strictMode: true,
      fetchImpl: async () => {
        throw new Error("network unavailable");
      },
      fallback: {
        async interpret() {
          fallbackCalls += 1;
          return createRuleBasedInterpreter().interpret(inbound);
        }
      }
    });

    await expect(interpreter.interpret(inbound)).rejects.toMatchObject({
      name: "FriendyStrictModeError",
      code: "MODEL_INTERPRETATION_FAILED",
      trace: {
        strictMode: true,
        routeSource: "llm",
        fallbackUsed: false,
        fallbackReason: "model_interpreter_failed"
      }
    });
    expect(fallbackCalls).toBe(0);
  });

  it("adds route search fields for broad related-contact recall in fallback mode", async () => {
    const interpreter = createRuleBasedInterpreter();

    for (const text of [
      "Anyone in my contacts related to friendy?",
      "Anyone in my contact that related to Friendy?",
      "Anyone in my contacts connected to Friendy?",
      "Who in my contacts is related to Friendy?",
      "Who do I know connected to Friendy?",
      "Do I know anyone associated with Friendy?",
      "Find contacts related to Friendy.",
      "Show people connected to Friendy testing."
    ]) {
      const result = await interpreter.interpret({
        ...inbound,
        text
      });

      expect(result.interpretation).toMatchObject({
        intent: "search_memory",
        domain: "relationship_memory",
        search: {
          mode: "list_related_people",
          semanticQuery: text
        }
      });
      expect(result.interpretation.search?.exactTerms.join(" ")).toContain("friendy");
    }
  });

  it("routes list-all contact recall wording to list_people in fallback mode", async () => {
    const interpreter = createRuleBasedInterpreter();

    for (const text of ["Just give me all the people in my contact so far", "Do you know anyone in my contact?"]) {
      const result = await interpreter.interpret({
        ...inbound,
        text
      });

      expect(result.interpretation).toMatchObject({
        intent: "list_people",
        domain: "relationship_memory",
        search: {
          mode: "list_people",
          semanticQuery: text
        }
      });
      expect(result.interpretation.search?.exactTerms).toEqual([]);
    }
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
