/**
 * OpenAI structured-output interpreter with strict failure by default.
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
import { routeDeterministicRelationshipRequest } from "./deterministicRouter";
import { isEventRecallQuestion, isListPeopleRecall } from "./listPeopleRecall";
import { FriendyStrictModeError, type FriendyStrictModeErrorCode } from "./strictMode";
import { createFriendyTrace } from "./trace";
import type { MessageInterpreterInput } from "./routerInputEnvelope";

/** Default OpenAI model when `OPENAI_MODEL` is unset. */
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
/** Retry budget before surfacing model failure. */
const MAX_MODEL_ATTEMPTS = 2;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type ModelProvider = "openai";

/** Resolved model credentials and model id from environment. */
export type OpenAIConfig = {
  apiKey: string;
  model: string;
  provider: ModelProvider;
};

/** Interpreter output including model attribution and optional upstream error text. */
export type MessageInterpreterResult = {
  interpretation: MessageInterpretation;
  modelUsed: string;
  error: string;
  routeSource: "llm" | "fallback" | "deterministic";
  fallbackUsed: boolean;
  fallbackReason?:
    | "missing_model_api_key"
    | "model_interpreter_failed"
    | "invalid_model_output"
    | "invalid_model_schema_recovered"
    | "explicit_fallback";
  modelRequested?: string;
  modelResponseSchemaValid?: boolean;
  modelErrorCode?: FriendyStrictModeErrorCode;
};

/** Contract for turning inbound agent text into validated {@link MessageInterpretation} JSON. */
export type MessageInterpreter = {
  interpret(input: MessageInterpreterInput): Promise<MessageInterpreterResult>;
};

type OpenAIInterpreterOptions = {
  apiKey: string;
  model: string;
  provider?: ModelProvider;
  strictMode?: boolean;
  /** Injectable HTTP client for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Rule-based interpreter used only when strictMode is explicitly disabled. */
  fallback?: MessageInterpreter;
  /** Diagnostic sink for invalid model output; defaults to console. */
  logger?: Pick<Console, "error">;
};

/**
 * Reads OpenAI config with a stable default model.
 *
 * The API key may be empty in config, but strict live routing will throw before fallback.
 */
export function readOpenAIConfig(
  env: Partial<Pick<NodeJS.ProcessEnv, "OPENAI_API_KEY" | "OPENAI_MODEL">> = process.env
): OpenAIConfig {
  return {
    apiKey: env.OPENAI_API_KEY ?? "",
    model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    provider: "openai"
  };
}

/** Creates a structured-output OpenAI interpreter. Strict mode is on by default. */
export function createOpenAIInterpreter({
  apiKey,
  model,
  provider = "openai",
  strictMode = true,
  fetchImpl = fetch,
  fallback = createRuleBasedInterpreter(),
  logger = console
}: OpenAIInterpreterOptions): MessageInterpreter {
  return {
    async interpret(input) {
      if (!apiKey) {
        throwStrictInterpreterError({
          strictMode,
          code: "FALLBACK_USED",
          message: "OpenAI API key is missing, and fallback is not allowed in strict mode.",
          routeSource: "fallback",
          fallbackUsed: true,
          fallbackReason: "missing_model_api_key",
          modelRequested: model
        });
        const fallbackResult = await fallback.interpret(input);
        return {
          ...fallbackResult,
          routeSource: "fallback",
          fallbackUsed: true,
          fallbackReason: "missing_model_api_key",
          modelRequested: model,
          modelErrorCode: "FALLBACK_USED"
        };
      }

      let lastError = "";
      let fallbackReason: MessageInterpreterResult["fallbackReason"] = "model_interpreter_failed";
      for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS; attempt += 1) {
        try {
          const interpretation = await callOpenAI({ apiKey, model, fetchImpl, input });
          return {
            interpretation,
            modelUsed: model,
            error: "",
            routeSource: "llm",
            fallbackUsed: false,
            modelRequested: model,
            modelResponseSchemaValid: true
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          fallbackReason = isInvalidModelOutputError(error) ? "invalid_model_output" : "model_interpreter_failed";
          if (fallbackReason === "invalid_model_output") {
            logInvalidModelOutput({ logger, model, error });
            const recovered = recoverSafeDeterministicInterpretation(input.message.text);
            if (recovered) {
              return {
                interpretation: recovered,
                modelUsed: model,
                error: lastError,
                routeSource: "deterministic",
                fallbackUsed: false,
                fallbackReason: "invalid_model_schema_recovered",
                modelRequested: model,
                modelResponseSchemaValid: false,
                modelErrorCode: "INVALID_ROUTE_SCHEMA"
              };
            }
          }
          const code = fallbackReason === "invalid_model_output" ? "INVALID_ROUTE_SCHEMA" : "MODEL_INTERPRETATION_FAILED";
          throwStrictInterpreterError({
            strictMode,
            code,
            message:
              fallbackReason === "invalid_model_output"
                ? "OpenAI returned output that did not match Friendy's interpretation schema."
                : "OpenAI interpretation failed, and fallback is not allowed in strict mode.",
            routeSource: "llm",
            fallbackUsed: false,
            fallbackReason,
            modelRequested: model,
            modelResponseSchemaValid: fallbackReason === "invalid_model_output" ? false : undefined
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
        fallbackReason,
        modelRequested: model,
        modelResponseSchemaValid: fallbackReason === "invalid_model_output" ? false : undefined,
        modelErrorCode: fallbackReason === "invalid_model_output" ? "INVALID_ROUTE_SCHEMA" : "MODEL_INTERPRETATION_FAILED"
      };
    }
  };
}

function recoverSafeDeterministicInterpretation(text: string): MessageInterpretation | undefined {
  const route = routeDeterministicRelationshipRequest({ text });
  if (route?.kind !== "list_people") {
    return undefined;
  }

  return validateMessageInterpretation({
    intent: "list_people",
    confidence: 1,
    domain: "relationship_memory",
    conversationRelation: "starts_new_relationship_task",
    search: {
      mode: "list_people",
      semanticQuery: text,
      exactTerms: [],
      topK: 20
    },
    people: [],
    event: { name: "", dateText: "", location: "" },
    dateContext: undefined,
    contextNote: "",
    query: text,
    tags: [],
    needsClarification: false,
    clarificationQuestion: ""
  });
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
  modelRequested: string;
  modelResponseSchemaValid?: boolean;
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
      modelRequested: input.modelRequested,
      modelResponseSchemaValid: input.modelResponseSchemaValid,
      modelErrorCode: input.code,
      toolCalls: []
    })
  );
}

function isInvalidModelOutputError(error: unknown): boolean {
  if (error instanceof InvalidOpenAIModelOutputError) {
    return true;
  }

  if (error instanceof SyntaxError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Invalid message interpretation") || message.includes("JSON");
}

class InvalidOpenAIModelOutputError extends Error {
  readonly rawOutput: string;
  readonly validationError: string;

  constructor(rawOutput: string, validationError: unknown) {
    const message = validationError instanceof Error ? validationError.message : String(validationError);
    super(`Invalid message interpretation from OpenAI: ${message}`);
    this.name = "InvalidOpenAIModelOutputError";
    this.rawOutput = rawOutput;
    this.validationError = message;
  }
}

function logInvalidModelOutput({
  logger,
  model,
  error
}: {
  logger: Pick<Console, "error">;
  model: string;
  error: unknown;
}): void {
  if (!(error instanceof InvalidOpenAIModelOutputError)) {
    return;
  }

  logger.error(
    "[friendy:openai_interpreter:invalid_output]",
    JSON.stringify({
      model,
      rawOutput: error.rawOutput,
      validationError: error.validationError
    })
  );
}

async function callOpenAI({
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
  const response = await fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildChatCompletionsBody({ model, input }))
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = payload.choices?.[0]?.message?.content;
  let parsed: unknown;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch (error) {
    throw new InvalidOpenAIModelOutputError(serializeModelOutputForLog(content), error);
  }

  try {
    return validateMessageInterpretation(parsed);
  } catch (error) {
    throw new InvalidOpenAIModelOutputError(serializeModelOutputForLog(parsed), error);
  }
}

function serializeModelOutputForLog(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildChatCompletionsBody({
  model,
  input
}: {
  model: string;
  input: MessageInterpreterInput;
}) {
  return {
    model,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "friendy_message_interpretation",
        strict: true,
        schema: toOpenAIStrictJsonSchema(messageInterpretationJsonSchema)
      }
    },
    messages: [
      {
        role: "system",
        content: [buildInterpreterSystemPrompt(), buildStructuredOutputInstructions()].join("\n\n")
      },
      { role: "user", content: serializeRouterUserContent(input) }
    ]
  };
}

function toOpenAIStrictJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => toOpenAIStrictJsonSchema(item));
  }

  if (typeof schema !== "object" || schema === null) {
    return schema;
  }

  const input = schema as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = toOpenAIStrictJsonSchema(value);
  }

  if (isObjectJsonSchema(input) && isRecord(input.properties)) {
    output.properties = toOpenAIStrictJsonSchema(input.properties);
    output.required = Object.keys(input.properties);
  }

  return output;
}

function isObjectJsonSchema(schema: Record<string, unknown>): boolean {
  return schema.type === "object" || (Array.isArray(schema.type) && schema.type.includes("object"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
