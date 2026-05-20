# Friendy LLM Message Interpreter Design

## Summary

Friendy should stop treating free-form human text as something a regex parser can predict. The next architecture adds an LLM interpretation layer that converts every transport message into a typed internal command before deterministic tools read, write, search, or log memory.

The product boundary stays the same: Spectrum/iMessage is a communication transport, Friendy is the relationship memory agent. The LLM does not directly mutate memory. It only returns a structured interpretation that the backend validates and executes.

## Goals

- Accept natural human messages like:
  - `I met Amaya at Photon Residency II, and me and him sleep on the same bed...`
  - `Ok so at the residency, I also met Zhiyuan who also call zed...`
  - `Who I have met at the Residency?`
- Route messages into a small set of internal intents.
- Use OpenRouter structured outputs when `OPENROUTER_API_KEY` is configured.
- Default to `nvidia/nemotron-3-super-120b-a12b:free` for the first interpreter model.
- Validate interpreter output before executing tools.
- Keep a deterministic fallback interpreter for local tests and missing API keys.
- Log inbound text, interpretation JSON, tool calls, outbound text, model, confidence, latency, and errors for every interpreted turn.

## Non-Goals

- Do not let the LLM directly write database rows.
- Do not build embeddings or vector search in this iteration.
- Do not add Notion, Mem0, Membase, or a production database.
- Do not build multi-agent orchestration.
- Do not make the UI a priority.
- Do not remove the existing deterministic terminal product flow; keep it as a fallback and smoke test.

## Architecture

```text
Spectrum / iMessage / terminal
  -> InboundAgentMessage
  -> MessageInterpreter
  -> MessageInterpretation
  -> schema validation
  -> deterministic RelationshipTools
  -> RelationshipRepository
  -> AgentInteraction log
  -> OutboundAgentMessage
```

The interpreter is an adapter. The rest of the system should not know whether the interpretation came from OpenRouter, a local fallback parser, or a future specialized model.

## Message Interpretation Contract

The interpreter returns one JSON object:

```ts
type MessageInterpretation = {
  intent: "capture_memory" | "search_memory" | "ignore_candidate" | "clarify" | "unknown";
  confidence: number;
  people: Array<{
    name: string;
    aliases: string[];
    companyOrSchool?: string;
    classYear?: string;
    project?: string;
    role?: string;
  }>;
  event?: {
    name?: string;
    dateText?: string;
    location?: string;
  };
  contextNote?: string;
  query?: string;
  tags: string[];
  needsClarification: boolean;
  clarificationQuestion?: string;
};
```

Rules:

- `capture_memory` requires at least one person name.
- `search_memory` requires `query`.
- `confidence` must be between `0` and `1`.
- `tags` and `aliases` are arrays even when empty.
- `needsClarification` means the backend should ask instead of writing or searching.

## OpenRouter Interpreter

Use OpenRouter chat completions with:

- `POST https://openrouter.ai/api/v1/chat/completions`
- `Authorization: Bearer <OPENROUTER_API_KEY>`
- `response_format.type = "json_schema"`
- `response_format.json_schema.strict = true`
- `provider.require_parameters = true`
- `temperature = 0`

The JSON schema should be kept in source control and tested. The system prompt should instruct the model to classify the user's message, extract people/event/context, preserve uncertainty, and never invent contacts.

If the OpenRouter response is invalid, empty, or fails validation, retry once. If it still fails, fall back to the deterministic interpreter and log the error.

## Deterministic Execution

After validation:

- `capture_memory`: call `create_manual_memory` once per extracted person.
- `search_memory`: call `search_memories` using the interpreted query, event name, and tags.
- `ignore_candidate`: keep the existing pending-candidate ignore behavior.
- `clarify` or `unknown`: return the clarification question or a short prompt for more context.

Search responses should support multiple results. If the user asks who they met at an event, Friendy should list likely people instead of pretending one match is the only answer.

## Logging

Every interpreted turn should create an `AgentInteraction` record with:

- `id`
- `userId`
- `platform`
- `spaceId`
- `inboundText`
- `interpretedIntentJson`
- `outboundText`
- `toolCalls`
- `modelUsed`
- `confidence`
- `latencyMs`
- `error`
- `createdAt`

The Spectrum transport should also print a compact JSON log line to the backend console so the running process shows what the agent received, interpreted, executed, and replied.

## Model Choice

Default:

```text
nvidia/nemotron-3-super-120b-a12b:free
```

Reason:

- It is free in the current OpenRouter models API.
- It advertises `response_format` and `structured_outputs`.
- It is a text model with enough capacity for messy human memory messages.

Keep the model configurable through `OPENROUTER_MODEL` because free model availability changes.

## Failure Modes

- Missing `OPENROUTER_API_KEY`: use deterministic fallback.
- OpenRouter request fails: fallback and log the error.
- Invalid model JSON: retry once, then fallback and log.
- Low confidence or missing required fields: ask a clarifying question.
- User asks a search before saving anything: say no confident match and ask for more detail.

## Testing

Required test cases:

- Interpret the Amaya sentence as `capture_memory`.
- Interpret the Zhiyuan/Zed sentence as `capture_memory`.
- Interpret `Who I have met at the Residency?` as `search_memory`.
- Validate that malformed interpretation JSON is rejected.
- Verify OpenRouter request body includes structured output schema.
- Verify interpreted agent logs inbound text, interpretation JSON, tool calls, and outbound text.
- Verify Spectrum uses interpreted agent behavior, not raw regex behavior.
