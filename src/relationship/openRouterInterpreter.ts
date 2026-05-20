import {
  messageInterpretationJsonSchema,
  type MessageInterpretation,
  validateMessageInterpretation
} from "./interpretation";
import type { InboundAgentMessage } from "./types";

export const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_MODEL_ATTEMPTS = 2;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type OpenRouterConfig = {
  apiKey: string;
  model: string;
};

export type MessageInterpreterResult = {
  interpretation: MessageInterpretation;
  modelUsed: string;
  error: string;
};

export type MessageInterpreter = {
  interpret(message: InboundAgentMessage): Promise<MessageInterpreterResult>;
};

type OpenRouterInterpreterOptions = {
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  fallback?: MessageInterpreter;
};

/**
 * Reads OpenRouter config with a stable free default model.
 *
 * The API key is optional because local demos should still run through the
 * deterministic fallback when a developer has not configured OpenRouter yet.
 */
export function readOpenRouterConfig(
  env: Partial<Pick<NodeJS.ProcessEnv, "OPENROUTER_API_KEY" | "OPENROUTER_MODEL">> = process.env
): OpenRouterConfig {
  return {
    apiKey: env.OPENROUTER_API_KEY ?? "",
    model: env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL
  };
}

/** Creates a structured-output OpenRouter interpreter with deterministic fallback behavior. */
export function createOpenRouterInterpreter({
  apiKey,
  model,
  fetchImpl = fetch,
  fallback = createRuleBasedInterpreter()
}: OpenRouterInterpreterOptions): MessageInterpreter {
  return {
    async interpret(message) {
      if (!apiKey) {
        return fallback.interpret(message);
      }

      let lastError = "";
      for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS; attempt += 1) {
        try {
          const interpretation = await callOpenRouter({ apiKey, model, fetchImpl, message });
          return { interpretation, modelUsed: model, error: "" };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      const fallbackResult = await fallback.interpret(message);
      return {
        interpretation: fallbackResult.interpretation,
        modelUsed: fallbackResult.modelUsed,
        error: lastError || fallbackResult.error
      };
    }
  };
}

/** Deterministic local fallback for tests and demos when model calls fail or are not configured. */
export function createRuleBasedInterpreter(): MessageInterpreter {
  return {
    async interpret(message) {
      return {
        interpretation: validateMessageInterpretation(ruleBasedInterpret(message.text)),
        modelUsed: "rule-based-fallback",
        error: ""
      };
    }
  };
}

async function callOpenRouter({
  apiKey,
  model,
  fetchImpl,
  message
}: {
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
  message: InboundAgentMessage;
}): Promise<MessageInterpretation> {
  const response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      provider: { require_parameters: true },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "friendy_message_interpretation",
          strict: true,
          schema: messageInterpretationJsonSchema
        }
      },
      messages: [
        {
          role: "system",
          content: [
            "You interpret Friendy relationship-memory text into JSON only.",
            "Friendy is a personal relationship memory agent.",
            "Do not execute actions. Do not invent people or contacts.",
            "Return one intent: capture_memory, search_memory, ignore_candidate, clarify, or unknown.",
            "Use clarify when the message is too vague to search or save safely."
          ].join(" ")
        },
        { role: "user", content: message.text }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = payload.choices?.[0]?.message?.content;
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  return validateMessageInterpretation(parsed);
}

function ruleBasedInterpret(text: string): MessageInterpretation {
  const normalized = text.toLowerCase();

  if (normalized.trim() === "ignore") {
    return baseInterpretation({ intent: "ignore_candidate", confidence: 0.9 });
  }

  if (isVagueReference(normalized)) {
    return baseInterpretation({
      intent: "clarify",
      confidence: 0.45,
      needsClarification: true,
      clarificationQuestion: "What do you remember about them, like a name, event, project, school, or date?"
    });
  }

  const capturedName = extractCapturedName(text);
  if (capturedName) {
    return buildCaptureInterpretation(text, capturedName);
  }

  if (looksLikeSearch(normalized)) {
    return baseInterpretation({
      intent: "search_memory",
      confidence: 0.72,
      query: text,
      event: inferEvent(text),
      tags: inferTags(text)
    });
  }

  return baseInterpretation({
    intent: "unknown",
    confidence: 0.4,
    needsClarification: true,
    clarificationQuestion: "Should I save this as a memory or search for someone?"
  });
}

function buildCaptureInterpretation(text: string, name: string): MessageInterpretation {
  const aliases = extractAliases(text);
  const project = extractProject(text);
  const tags = inferTags([text, name, ...aliases, project].join(" "));

  return baseInterpretation({
    intent: "capture_memory",
    confidence: 0.78,
    people: [
      {
        name,
        aliases,
        companyOrSchool: /cmu/i.test(text) ? "CMU" : "",
        classYear: extractClassYear(text),
        project,
        role: inferRole(text)
      }
    ],
    event: inferEvent(text),
    contextNote: text,
    tags
  });
}

function baseInterpretation(overrides: Partial<MessageInterpretation>): MessageInterpretation {
  return {
    intent: "unknown",
    confidence: 0.5,
    people: [],
    event: { name: "", dateText: "", location: "" },
    contextNote: "",
    query: "",
    tags: [],
    needsClarification: false,
    clarificationQuestion: "",
    ...overrides
  };
}

function extractCapturedName(text: string): string {
  const match = /\b(?:i\s+)?(?:also\s+)?met\s+([A-Z][a-zA-Z'-]*)\b/.exec(text);
  return match?.[1] ?? "";
}

function extractAliases(text: string): string[] {
  const match = /\b(?:also\s+)?call(?:ed|s)?\s+([A-Z]?[a-zA-Z'-]*)\b/i.exec(text);
  if (!match?.[1]) {
    return [];
  }

  return [capitalize(match[1])];
}

function extractClassYear(text: string): string {
  return /\b20\d{2}\b/.exec(text)?.[0] ?? "";
}

function extractProject(text: string): string {
  const projectMatch = /\bmaking\s+(.+)$/i.exec(text);
  if (projectMatch?.[1]) {
    return projectMatch[1].trim();
  }

  if (/swift|computer|phone|clicky|wisper|wispr/i.test(text)) {
    return text;
  }

  return "";
}

function inferRole(text: string): string {
  if (/design|designer/i.test(text)) {
    return "designer";
  }
  if (/founder/i.test(text)) {
    return "founder";
  }
  return "";
}

function inferEvent(text: string): MessageInterpretation["event"] {
  if (/photon residency ii/i.test(text)) {
    return { name: "Photon Residency II", dateText: "", location: "" };
  }
  if (/photon residency/i.test(text)) {
    return { name: "Photon Residency", dateText: "", location: "" };
  }
  if (/residency/i.test(text)) {
    return { name: "Residency", dateText: "", location: "" };
  }
  if (/dinner/i.test(text)) {
    return { name: "Dinner", dateText: "", location: "" };
  }
  return { name: "", dateText: "", location: "" };
}

function inferTags(text: string): string[] {
  const tags = new Set<string>();
  const candidates: Array<[RegExp, string]> = [
    [/photon/i, "Photon"],
    [/residency/i, "Residency"],
    [/recruit/i, "recruiting"],
    [/\bagents?\b/i, "agents"],
    [/swift/i, "Swift"],
    [/computer/i, "computer control"],
    [/phone/i, "phone"],
    [/clicky/i, "clicky UI"],
    [/wispe?r|wispr/i, "Wispr Flow"],
    [/\bcmu\b/i, "CMU"],
    [/sleep|bed/i, "sleeping context"],
    [/dinner/i, "dinner"],
    [/design/i, "design"]
  ];

  for (const [pattern, tag] of candidates) {
    if (pattern.test(text)) {
      tags.add(tag);
    }
  }

  return [...tags];
}

function looksLikeSearch(normalized: string): boolean {
  return (
    normalized.includes("?") ||
    /^(who|find|show|where|what)\b/.test(normalized) ||
    normalized.includes("who i have met") ||
    normalized.includes("who did i meet")
  );
}

function isVagueReference(normalized: string): boolean {
  return normalized.trim() === "that person from the thing" || /\b(person|someone)\b.*\b(thing|stuff)\b/.test(normalized);
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
