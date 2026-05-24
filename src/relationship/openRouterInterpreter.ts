/**
 * OpenRouter structured-output interpreter with strict failure by default.
 *
 * Callers: interpretedAgent.ts and tests that stub the HTTP client.
 *
 * Fallback is available only when strict mode is explicitly disabled for tests or local fixtures.
 * Live Friendy should fail loudly when structured model routing is unavailable.
 */
import {
  messageInterpretationJsonSchema,
  type MessageInterpretation,
  validateMessageInterpretation
} from "./interpretation";
import { buildInterpreterSystemPrompt, buildStructuredOutputInstructions } from "./behaviorContract";
import { isEventRecallQuestion, isListPeopleRecall } from "./listPeopleRecall";
import { FriendyStrictModeError, type FriendyStrictModeErrorCode } from "./strictMode";
import { createFriendyTrace } from "./trace";
import type { MessageInterpreterInput } from "./routerInputEnvelope";

/** Default free-tier model when `OPENROUTER_MODEL` is unset. */
export const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
/** Retry budget before surfacing model failure. */
const MAX_MODEL_ATTEMPTS = 2;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Resolved OpenRouter credentials and model id from environment. */
export type OpenRouterConfig = {
  apiKey: string;
  model: string;
};

/** Interpreter output including model attribution and optional upstream error text. */
export type MessageInterpreterResult = {
  interpretation: MessageInterpretation;
  modelUsed: string;
  error: string;
  routeSource: "llm" | "fallback";
  fallbackUsed: boolean;
  fallbackReason?: "missing_openrouter_api_key" | "model_interpreter_failed" | "invalid_model_output" | "explicit_fallback";
};

/** Contract for turning inbound agent text into validated {@link MessageInterpretation} JSON. */
export type MessageInterpreter = {
  interpret(input: MessageInterpreterInput): Promise<MessageInterpreterResult>;
};

type OpenRouterInterpreterOptions = {
  apiKey: string;
  model: string;
  strictMode?: boolean;
  /** Injectable HTTP client for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Rule-based interpreter used only when strictMode is explicitly disabled. */
  fallback?: MessageInterpreter;
};

/**
 * Reads OpenRouter config with a stable free default model.
 *
 * The API key may be empty in config, but strict live routing will throw before fallback.
 */
export function readOpenRouterConfig(
  env: Partial<Pick<NodeJS.ProcessEnv, "OPENROUTER_API_KEY" | "OPENROUTER_MODEL">> = process.env
): OpenRouterConfig {
  return {
    apiKey: env.OPENROUTER_API_KEY ?? "",
    model: env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL
  };
}

/** Creates a structured-output OpenRouter interpreter. Strict mode is on by default. */
export function createOpenRouterInterpreter({
  apiKey,
  model,
  strictMode = true,
  fetchImpl = fetch,
  fallback = createRuleBasedInterpreter()
}: OpenRouterInterpreterOptions): MessageInterpreter {
  return {
    async interpret(input) {
      if (!apiKey) {
        throwStrictInterpreterError({
          strictMode,
          code: "FALLBACK_USED",
          message: "OpenRouter API key is missing, and fallback is not allowed in strict mode.",
          routeSource: "fallback",
          fallbackUsed: true,
          fallbackReason: "missing_openrouter_api_key"
        });
        const fallbackResult = await fallback.interpret(input);
        return {
          ...fallbackResult,
          routeSource: "fallback",
          fallbackUsed: true,
          fallbackReason: "missing_openrouter_api_key"
        };
      }

      let lastError = "";
      let fallbackReason: MessageInterpreterResult["fallbackReason"] = "model_interpreter_failed";
      for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS; attempt += 1) {
        try {
          const interpretation = await callOpenRouter({ apiKey, model, fetchImpl, input });
          return {
            interpretation,
            modelUsed: model,
            error: "",
            routeSource: "llm",
            fallbackUsed: false
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          fallbackReason = isInvalidModelOutputError(error) ? "invalid_model_output" : "model_interpreter_failed";
          throwStrictInterpreterError({
            strictMode,
            code: fallbackReason === "invalid_model_output" ? "INVALID_ROUTE_SCHEMA" : "MODEL_INTERPRETATION_FAILED",
            message:
              fallbackReason === "invalid_model_output"
                ? "OpenRouter returned output that did not match Friendy's interpretation schema."
                : "OpenRouter interpretation failed, and fallback is not allowed in strict mode.",
            routeSource: "llm",
            fallbackUsed: false,
            fallbackReason
          });
        }
      }

      const fallbackResult = await fallback.interpret(input);
      return {
        interpretation: fallbackResult.interpretation,
        modelUsed: fallbackResult.modelUsed,
        error: lastError || fallbackResult.error,
        routeSource: "fallback",
        fallbackUsed: true,
        fallbackReason
      };
    }
  };
}

/** Deterministic local fallback for tests and fixtures when model calls fail or are not configured. */
export function createRuleBasedInterpreter(): MessageInterpreter {
  return {
    async interpret(input) {
      return {
        interpretation: validateMessageInterpretation(ruleBasedInterpret(input.message.text)),
        modelUsed: "rule-based-fallback",
        error: "",
        routeSource: "fallback",
        fallbackUsed: true,
        fallbackReason: "explicit_fallback"
      };
    }
  };
}

function throwStrictInterpreterError(input: {
  strictMode: boolean;
  code: FriendyStrictModeErrorCode;
  message: string;
  routeSource: "llm" | "fallback";
  fallbackUsed: boolean;
  fallbackReason: NonNullable<MessageInterpreterResult["fallbackReason"]>;
}): void {
  if (!input.strictMode) {
    return;
  }

  throw new FriendyStrictModeError(
    input.code,
    input.message,
    createFriendyTrace({
      strictMode: true,
      routeSource: input.routeSource,
      fallbackUsed: input.fallbackUsed,
      fallbackReason: input.fallbackReason,
      toolCalls: []
    })
  );
}

function isInvalidModelOutputError(error: unknown): boolean {
  if (error instanceof SyntaxError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Invalid message interpretation") || message.includes("JSON");
}

async function callOpenRouter({
  apiKey,
  model,
  fetchImpl,
  input
}: {
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
  input: MessageInterpreterInput;
}): Promise<MessageInterpretation> {
  const response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      // Zero temperature keeps structured JSON classification stable across retries and eval replay.
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
          content: [buildInterpreterSystemPrompt(), buildStructuredOutputInstructions()].join("\n\n")
        },
        { role: "user", content: serializeRouterUserContent(input) }
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

function serializeRouterUserContent(input: MessageInterpreterInput): string {
  if (!input.routerContext) {
    return input.message.text;
  }

  return [
    "Route this Friendy turn using the state envelope.",
    "Return only JSON matching the schema.",
    JSON.stringify(input.routerContext)
  ].join("\n\n");
}

function ruleBasedInterpret(text: string): MessageInterpretation {
  const normalized = text.toLowerCase();

  if (normalized.trim() === "ignore") {
    return baseInterpretation({ intent: "ignore_candidate", confidence: 0.9 });
  }

  if (looksLikeDuplicateAudit(text)) {
    return baseInterpretation({
      intent: "duplicate_audit",
      confidence: 0.92,
      domain: "relationship_memory"
    });
  }

  if (looksLikeConversationRepair(text)) {
    return baseInterpretation({
      intent: "conversation_repair",
      confidence: 0.9,
      domain: "relationship_memory"
    });
  }

  if (looksLikeAgentStateQuestion(text)) {
    return baseInterpretation({
      intent: "explain_agent_state",
      confidence: 0.9,
      domain: "relationship_memory",
      conversationRelation: "asks_about_open_workflow"
    });
  }

  if (looksLikeDeleteMemoryRequest(text)) {
    const query = extractDeleteQuery(text);
    return baseInterpretation({
      intent: "delete_memory_request",
      confidence: 0.9,
      domain: "relationship_memory",
      query,
      target: query ? { displayName: query } : undefined
    });
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
    const tags = inferTags(text);
    return baseInterpretation({
      intent: "search_memory",
      confidence: 0.72,
      domain: "relationship_memory",
      query: text,
      event: inferEvent(text),
      tags,
      search: {
        mode: inferSearchMode(text),
        semanticQuery: text,
        exactTerms: inferExactSearchTerms(text, tags),
        filters: tags.length > 0 ? { tags } : undefined,
        topK: 10
      }
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
        companyOrSchool: extractCompanyOrSchool(text),
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
    dateContext: undefined,
    contextNote: "",
    query: "",
    tags: [],
    needsClarification: false,
    clarificationQuestion: "",
    ...overrides
  };
}

function extractCapturedName(text: string): string {
  const match = /\b(?:and\s+)?(?:i\s+)?(?:also\s+)?met\s+([A-Z][a-zA-Z'-]*(?:\s+[A-Z][a-zA-Z'-]*){0,2})\b/.exec(
    text
  );
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

function extractCompanyOrSchool(text: string): string {
  if (/\bcmu\b/i.test(text)) {
    return "CMU";
  }

  const schoolMatch = /\bgo(?:es)?\s+to\s+([A-Z][A-Z0-9&.-]*)\b/.exec(text);
  return schoolMatch?.[1] ?? "";
}

function extractProject(text: string): string {
  const projectMatch = /\bmaking\s+(.+)$/i.exec(text);
  if (projectMatch?.[1]) {
    return normalizeProjectText(projectMatch[1].trim());
  }

  if (/swift|computer|phone|clicky|wisper|wispr/i.test(text)) {
    return normalizeProjectText(text);
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
  if (/community lead/i.test(text)) {
    return "community lead";
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
    isListPeopleRecall(normalized) ||
    normalized.includes("?") ||
    /^(who|find|show|where|what)\b/.test(normalized) ||
    normalized.includes("who i have met") ||
    normalized.includes("who did i meet")
  );
}

function inferSearchMode(text: string): NonNullable<MessageInterpretation["search"]>["mode"] {
  if (looksLikeRelatedPeopleSearch(text)) {
    return "list_related_people";
  }

  if (isEventRecallQuestion(text)) {
    return "event_recall";
  }

  if (isListPeopleRecall(text)) {
    return "list_people";
  }

  return "semantic_recall";
}

function looksLikeRelatedPeopleSearch(text: string): boolean {
  return (
    /\b(anyone|anybody|people|person|someone|somebody|contacts?)\b.*\b(related|connected|connection|associated|association)\b/i.test(
      text
    ) || /\b(who|which|do i know)\b.*\b(related|connected|connection|associated|association)\b/i.test(text)
  );
}

function inferExactSearchTerms(text: string, tags: string[]): string[] {
  const terms = new Set(tags.map((tag) => tag.toLowerCase()));
  for (const token of text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)) {
    if (!FALLBACK_SEARCH_FILLER_TERMS.has(token)) {
      terms.add(token);
    }
  }
  return [...terms];
}

function isVagueReference(normalized: string): boolean {
  return normalized.trim() === "that person from the thing" || /\b(person|someone)\b.*\b(thing|stuff)\b/.test(normalized);
}

const FALLBACK_SEARCH_FILLER_TERMS = new Set([
  "anyone",
  "anybody",
  "any",
  "people",
  "person",
  "someone",
  "somebody",
  "contact",
  "contacts",
  "related",
  "connected",
  "connection",
  "associated",
  "associate",
  "association",
  "about",
  "relevant",
  "that",
  "my",
  "mine",
  "in",
  "to",
  "with",
  "from",
  "who",
  "which",
  "find",
  "give",
  "show",
  "list",
  "tell",
  "you",
  "did",
  "do",
  "i",
  "me",
  "add",
  "added",
  "save",
  "saved",
  "have",
  "know",
  "all",
  "every",
  "everyone",
  "everybody",
  "just",
  "so",
  "far",
  "while",
  "during",
  "was",
  "is",
  "the"
]);

function looksLikeDuplicateAudit(text: string): boolean {
  return /\bduplicate\b.*\b(people|person|persons?|contact|contacts)\b/i.test(text);
}

function looksLikeConversationRepair(text: string): boolean {
  return /\b(you already know|already have it|that was wrong|why did you say)\b/i.test(text);
}

function looksLikeAgentStateQuestion(text: string): boolean {
  return (
    /\bwhy\b.*\b(ask|asking|still)\b/i.test(text) ||
    /\bwho\b.*\b(you|friendy|u)\b.*\b(ask|asking|mean)\b/i.test(text)
  );
}

function looksLikeDeleteMemoryRequest(text: string): boolean {
  return /\b(delete|remove|forget)\b/i.test(text) && /\b(memory|memories|contact|person)\b/i.test(text);
}

function extractDeleteQuery(text: string): string {
  const helpDeleteMatch = text.match(/\bdelete\s+(.+?)(?:\s+from(?:\s+your)?\s+memory)?[?.!]*$/i);
  return helpDeleteMatch?.[1]?.trim() ?? "";
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function normalizeProjectText(value: string): string {
  return value
    .replace(/\bswift\b/gi, "Swift")
    .replace(/\bwispe?r\s+flow\b/gi, "Wispr Flow");
}
