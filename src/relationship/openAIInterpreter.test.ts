import { describe, expect, it } from "vitest";
import { buildInterpreterSystemPrompt, buildStructuredOutputInstructions } from "./behaviorContract";
import { fixtureUser } from "./fixtures";
import {
  DEFAULT_OPENAI_MODEL,
  createOpenAIInterpreter,
  createRuleBasedInterpreter,
  readOpenAIConfig
} from "./openAIInterpreter";
import { FriendyStrictModeError } from "./strictMode";
import type { RouterInputEnvelope } from "./routerInputEnvelope";
import type { InboundAgentMessage } from "./types";

const inbound: InboundAgentMessage = {
  userId: fixtureUser.id,
  platform: "terminal",
  text: "Who I have met at the Residency?",
  receivedAt: "2026-05-20T12:00:00.000Z"
};

const routerContext: RouterInputEnvelope = {
  userText: inbound.text,
  conversationState: {
    activeWorkflow: {
      kind: "pending_contact_confirmation",
      frameId: "frame-1",
      candidateId: "candidate-1",
      displayName: "Amaya",
      lastFriendyPrompt: "Should I save Amaya as a contact?",
      promptedAt: "2026-05-20T11:59:00.000Z"
    },
    recentAgentMessages: [],
    recentEntityRefs: [],
    lastListResultIds: [],
    lastToolErrors: []
  },
  domainStateSummary: {
    pendingCandidates: [],
    knownPeopleNamed: [],
    possibleDuplicates: [],
    linkedAppleContacts: []
  },
  availableTools: [],
  availableRouteCapabilities: ["search_memory", "answer_pending_contact_prompt"]
};

describe("openai message interpreter", () => {
  it("instructs the model to use state-aware route intents", () => {
    const prompt = buildInterpreterSystemPrompt();
    const instructions = buildStructuredOutputInstructions();

    expect(prompt).toContain("state envelope");
    expect(prompt).toContain("explain_agent_state");
    expect(prompt).toContain("conversation_repair");
    expect(prompt).toContain("duplicate_audit");
    expect(prompt).toContain("Do not assume every message is an answer to the pending contact prompt");
    expect(instructions).toContain("answer_pending_contact_prompt");
    expect(instructions).toContain("delete_memory_request");
  });

  it("sends OpenAI a strict structured-output request with the configured model", async () => {
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

    const interpreter = createOpenAIInterpreter({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchImpl
    });

    const result = await interpreter.interpret({ message: inbound });
    const body = JSON.parse(String(calls[0].init.body));

    expect(result.interpretation.intent).toBe("search_memory");
    expect(result.routeSource).toBe("llm");
    expect(result.fallbackUsed).toBe(false);
    expect(result.fallbackReason).toBeUndefined();
    expect(result.modelRequested).toBe("gpt-4o-mini");
    expect(result.modelResponseSchemaValid).toBe(true);
    expect(result.modelErrorCode).toBeUndefined();
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json"
    });
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.temperature).toBeUndefined();
    expect(body.provider).toBeUndefined();
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "friendy_message_interpretation",
        strict: true
      }
    });
    expect(body.response_format.json_schema.schema.required).toEqual(Object.keys(body.response_format.json_schema.schema.properties));
    expect(body.response_format.json_schema.schema.properties.target.required).toEqual([
      "frameId",
      "candidateId",
      "memoryId",
      "appleContactIdentifier",
      "displayName"
    ]);
    expect(body.response_format.json_schema.schema.properties.search.required).toEqual([
      "mode",
      "semanticQuery",
      "exactTerms",
      "filters",
      "topK"
    ]);
    expect(body.response_format.json_schema.schema.properties.search.properties.filters.required).toEqual([
      "personName",
      "eventName",
      "topic",
      "companyOrSchool",
      "dateText",
      "tags"
    ]);
    expect(body.messages[0].content).toContain("Calendar guesses are suggestions");
    expect(body.messages[0].content).toContain("Return JSON that matches the provided schema");
  });

  it("accepts the explicit OpenAI provider option", async () => {
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

    const interpreter = createOpenAIInterpreter({
      apiKey: "test-openai-key",
      model: "gpt-4o-mini",
      provider: "openai",
      fetchImpl
    });

    const result = await interpreter.interpret({ message: inbound });
    const body = JSON.parse(String(calls[0].init.body));

    expect(result.interpretation.intent).toBe("search_memory");
    expect(result.routeSource).toBe("llm");
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer test-openai-key",
      "Content-Type": "application/json"
    });
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.provider).toBeUndefined();
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "friendy_message_interpretation",
        strict: true
      }
    });
  });

  it("serializes router context into the OpenAI user message when provided", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "answer_pending_contact_prompt",
                confidence: 0.86,
                people: [],
                event: { name: "", dateText: "", location: "" },
                contextNote: "",
                query: "",
                tags: [],
                needsClarification: false,
                clarificationQuestion: ""
              })
            }
          }
        ]
      });
    };

    const interpreter = createOpenAIInterpreter({
      apiKey: "test-key",
      model: "model",
      fetchImpl
    });

    await interpreter.interpret({ message: inbound, routerContext });
    const body = JSON.parse(String(calls[0].init.body));
    const userContent = body.messages[1].content;

    expect(userContent).toContain("Route this Friendy turn using the state envelope.");
    expect(userContent).toContain("activeWorkflow");
    expect(userContent).toContain("lastFriendyPrompt");
    expect(userContent).not.toBe(inbound.text);
  });

  it("retries invalid model output when strict mode is explicitly disabled", async () => {
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

    const interpreter = createOpenAIInterpreter({
      apiKey: "test-key",
      model: "model",
      strictMode: false,
      fetchImpl,
      logger: { error() {} }
    });
    const result = await interpreter.interpret({ message: inbound });

    expect(calls).toBe(2);
    expect(result.interpretation.intent).toBe("search_memory");
    expect(result.error).toBe("");
  });

  it("falls back when strict mode is explicitly disabled and OpenAI keeps returning invalid output", async () => {
    const interpreter = createOpenAIInterpreter({
      apiKey: "test-key",
      model: "model",
      strictMode: false,
      fetchImpl: async () =>
        jsonResponse({
          choices: [{ message: { content: JSON.stringify({ intent: "capture_memory", confidence: 2 }) } }]
        }),
      fallback: createRuleBasedInterpreter(),
      logger: { error() {} }
    });

    const result = await interpreter.interpret({
      message: {
        ...inbound,
        text: "I met Amaya at Photon Residency II, and me and him sleep on the same bed cuz we ran out of bed :("
      }
    });

    expect(result.interpretation.intent).toBe("capture_memory");
    expect(result.interpretation.people[0].name).toBe("Amaya");
    expect(result.modelUsed).toBe("rule-based-fallback");
    expect(result.error).toContain("Invalid message interpretation");
    expect(result.routeSource).toBe("fallback");
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toBe("invalid_model_output");
    expect(result.modelRequested).toBe("model");
    expect(result.modelResponseSchemaValid).toBe(false);
    expect(result.modelErrorCode).toBe("INVALID_ROUTE_SCHEMA");
  });

  it("uses deterministic fallback only when strict mode is explicitly disabled and no OpenAI API key exists", async () => {
    const interpreter = createOpenAIInterpreter({
      apiKey: "",
      model: DEFAULT_OPENAI_MODEL,
      strictMode: false,
      fallback: createRuleBasedInterpreter()
    });

    const result = await interpreter.interpret({
      message: {
        ...inbound,
        text: "Ok so at the residency, I also met Zhiyuan who also call zed, go to CMU, class 2028 and making swift project that allow you to control your computer through your phone with a clicky UI and similar function like Wisper Flow"
      }
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
    expect(result.fallbackReason).toBe("missing_model_api_key");
    expect(result.modelRequested).toBe(DEFAULT_OPENAI_MODEL);
    expect(result.modelErrorCode).toBe("FALLBACK_USED");
  });

  it("throws instead of using fallback by default when no OpenAI API key exists", async () => {
    const interpreter = createOpenAIInterpreter({
      apiKey: "",
      model: DEFAULT_OPENAI_MODEL,
      fallback: createRuleBasedInterpreter()
    });

    await expect(interpreter.interpret({ message: inbound })).rejects.toMatchObject({
      name: "FriendyStrictModeError",
      code: "FALLBACK_USED",
      trace: {
        strictMode: true,
        routeSource: "fallback",
        fallbackUsed: true,
        fallbackReason: "missing_model_api_key",
        modelRequested: DEFAULT_OPENAI_MODEL,
        modelErrorCode: "FALLBACK_USED"
      }
    });
  });

  it("throws invalid schema errors in strict mode without calling fallback", async () => {
    let fallbackCalls = 0;
    const errorLogs: string[] = [];
    const interpreter = createOpenAIInterpreter({
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
          return createRuleBasedInterpreter().interpret({ message: inbound });
        }
      },
      logger: {
        error(message, details) {
          errorLogs.push(`${String(message)} ${String(details)}`);
        }
      }
    });

    await expect(interpreter.interpret({ message: inbound })).rejects.toBeInstanceOf(FriendyStrictModeError);
    await expect(interpreter.interpret({ message: inbound })).rejects.toMatchObject({
      code: "INVALID_ROUTE_SCHEMA",
      trace: {
        strictMode: true,
        routeSource: "llm",
        fallbackUsed: false,
        fallbackReason: "invalid_model_output",
        modelRequested: "model",
        modelResponseSchemaValid: false,
        modelErrorCode: "INVALID_ROUTE_SCHEMA"
      }
    });
    expect(fallbackCalls).toBe(0);
    expect(errorLogs.join("\n")).toContain("[friendy:openai_interpreter:invalid_output]");
    expect(errorLogs.join("\n")).toContain('\\"intent\\":\\"capture_memory\\"');
    expect(errorLogs.join("\n")).toContain('\\"confidence\\":2');
    expect(errorLogs.join("\n")).toContain("validationError");
  });

  it("recovers invalid schema output into a safe deterministic list_people route", async () => {
    let fallbackCalls = 0;
    const interpreter = createOpenAIInterpreter({
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
          return createRuleBasedInterpreter().interpret({ message: inbound });
        }
      },
      logger: { error() {} }
    });

    const result = await interpreter.interpret({
      message: {
        ...inbound,
        text: "What are all the people I know?"
      }
    });

    expect(result.interpretation.intent).toBe("list_people");
    expect(result.interpretation.search?.mode).toBe("list_people");
    expect(result.routeSource).toBe("deterministic");
    expect(result.fallbackUsed).toBe(false);
    expect(result.fallbackReason).toBe("invalid_model_schema_recovered");
    expect(result.modelRequested).toBe("model");
    expect(result.modelResponseSchemaValid).toBe(false);
    expect(result.modelErrorCode).toBe("INVALID_ROUTE_SCHEMA");
    expect(fallbackCalls).toBe(0);
  });

  it("throws model execution errors in strict mode without calling fallback", async () => {
    let fallbackCalls = 0;
    const interpreter = createOpenAIInterpreter({
      apiKey: "test-key",
      model: "model",
      strictMode: true,
      fetchImpl: async () => {
        throw new Error("network unavailable");
      },
      fallback: {
        async interpret() {
          fallbackCalls += 1;
          return createRuleBasedInterpreter().interpret({ message: inbound });
        }
      }
    });

    await expect(interpreter.interpret({ message: inbound })).rejects.toMatchObject({
      name: "FriendyStrictModeError",
      code: "MODEL_INTERPRETATION_FAILED",
      trace: {
        strictMode: true,
        routeSource: "llm",
        fallbackUsed: false,
        fallbackReason: "model_interpreter_failed",
        modelRequested: "model",
        modelErrorCode: "MODEL_INTERPRETATION_FAILED"
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
        message: {
          ...inbound,
          text
        }
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

  it("routes list-all contact recall wording to search in fallback mode", async () => {
    const interpreter = createRuleBasedInterpreter();

    for (const text of ["Just give me all the people in my contact so far", "Do you know anyone in my contact?"]) {
      const result = await interpreter.interpret({
        message: {
          ...inbound,
          text
        }
      });

      expect(result.interpretation).toMatchObject({
        intent: "search_memory",
        domain: "relationship_memory",
        search: {
          mode: "list_people",
          semanticQuery: text
        }
      });
      expect(result.interpretation.search?.exactTerms).toEqual([]);
    }
  });

  it("reads OpenAI config with a stable default model", () => {
    expect(readOpenAIConfig({})).toEqual({
      apiKey: "",
      model: DEFAULT_OPENAI_MODEL,
      provider: "openai"
    });
    expect(readOpenAIConfig({ OPENAI_API_KEY: "openai-key" })).toEqual({
      apiKey: "openai-key",
      model: DEFAULT_OPENAI_MODEL,
      provider: "openai"
    });
    expect(
      readOpenAIConfig({
        OPENAI_API_KEY: "openai-key",
        OPENAI_MODEL: "gpt-4.1-mini"
      })
    ).toEqual({
      apiKey: "openai-key",
      model: "gpt-4.1-mini",
      provider: "openai"
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
