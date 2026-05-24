# Goal: Strict Mode and Trace Envelope

Implement Task 1: add `FRIENDY_STRICT_MODE=1` and a first-class Friendy trace envelope so routing failures are visible during local development and evals instead of silently falling back.

## Objective

Friendy currently has several routes where failures can be hidden by fallback behavior:

- the OpenAI interpreter can fail and fall back to the rule-based interpreter;
- invalid model output can become fallback behavior;
- unsupported route intents can drift into `unknown`, `clarify`, or search paths;
- deterministic fallback can answer in ways that make a local demo look acceptable while the real router is broken;
- traces exist, but the core agent result does not expose a consistent route envelope for every turn.

Add strict mode so development and CI can force these failures to surface immediately.

## Environment Flag

Add:

```bash
FRIENDY_STRICT_MODE=1
```

Default behavior without the flag should remain tolerant unless explicitly changed by this spec.

Strict mode is enabled when the env value is exactly one of:

```text
1
true
yes
on
```

Case-insensitive values are allowed. Empty or missing values mean `false`.

## Trace Contract

Every interpreted Friendy agent result must include a trace envelope equivalent to:

```ts
type FriendyTrace = {
  strictMode: boolean;
  routeSource: "llm" | "deterministic" | "fallback";
  fallbackUsed: boolean;
  fallbackReason?: string;
  route?: FriendyRoute;
  policyDecision?: "allow" | "clarify" | "reject" | "unsupported";
  activeFrameId?: string;
  activeCandidateId?: string;
  activeMemoryId?: string;
  toolCalls: AgentToolCall[];
};
```

This should be available on:

- the return value from `createInterpretedRelationshipAgent().handleMessage(...)`;
- persisted interaction JSON, either as `interpretedIntentJson.trace` or another stable field;
- redacted runtime trace output, with private text redacted.

The trace may include ids such as candidate ids and memory ids. It must not include raw private message text, relationship notes, phone numbers, emails, or full contact payloads.

## Route Source Rules

Use these meanings:

```ts
routeSource: "llm"
```

The route came from a successful configured model call and passed schema validation.

```ts
routeSource: "deterministic"
```

The route came from a hard deterministic path, such as:

- `start` / `pause` / `resume`;
- explicit delete/update handlers;
- active pending-contact inquiry;
- active pending-contact context capture;
- manual deterministic memory create;
- deterministic unsafe/out-of-scope rejection.

```ts
routeSource: "fallback"
```

The route came from the rule-based fallback interpreter because:

- no model was configured;
- model call failed;
- model output failed schema validation;
- fallback was explicitly used by tests.

## Strict Mode Errors

In strict mode, Friendy must throw a typed error instead of silently continuing when any of these occurs:

1. Model interpreter failure.
2. Invalid model/schema output.
3. Unknown route.
4. Missing tool.
5. Fallback interpreter used.
6. Unsupported intent silently converted to search.
7. Ambiguous route when the expected route is executable.

Use a typed error like:

```ts
class FriendyStrictModeError extends Error {
  code:
    | "MODEL_INTERPRETATION_FAILED"
    | "INVALID_ROUTE_SCHEMA"
    | "UNKNOWN_ROUTE"
    | "TOOL_NOT_AVAILABLE"
    | "FALLBACK_USED"
    | "UNSUPPORTED_INTENT"
    | "UNEXPECTED_AMBIGUITY";

  trace: FriendyTrace;
}
```

Exact class shape can follow repo style, but tests must be able to assert the code and trace.

## Failure Rules

### Model Interpreter Failure

If OpenAI/model execution fails and strict mode is enabled:

- do not call fallback;
- throw `FriendyStrictModeError` with `code = "MODEL_INTERPRETATION_FAILED"`;
- include `routeSource: "llm"`, `fallbackUsed: false`, and `fallbackReason`.

### Invalid Schema

If model output fails `messageInterpretationSchema` validation and strict mode is enabled:

- do not call fallback;
- throw `FriendyStrictModeError` with `code = "INVALID_ROUTE_SCHEMA"`;
- include enough non-private trace shape to identify the failed boundary.

### Fallback Interpreter Used

If the rule-based interpreter is used in strict mode for any reason:

- throw `FriendyStrictModeError` with `code = "FALLBACK_USED"`;
- include `routeSource: "fallback"`;
- include `fallbackUsed: true`;
- include a `fallbackReason`.

This means a missing `OPENAI_API_KEY` should fail fast in strict mode when a model route is required.

### Unknown Route

If the route/interpretation intent is `unknown` in strict mode:

- throw `FriendyStrictModeError` with `code = "UNKNOWN_ROUTE"`;
- do not quietly return a generic clarification or out-of-scope fallback.

### Missing Tool

If a route says a tool should run but the tool is unavailable or not implemented:

- throw `FriendyStrictModeError` with `code = "TOOL_NOT_AVAILABLE"`;
- include the intended tool name in non-private error metadata if useful.

Examples:

- route asks for contact edit but Apple Contacts mutation tool is not available;
- route asks for a future tool that is not present in `createRelationshipTools`.

### Unsupported Intent Silently Converted To Search

Do not convert unsupported intents into `search_memory` in strict mode.

For example:

```ts
intent: "request_contact_edit"
```

must become:

```ts
policyDecision: "unsupported"
```

and strict mode must throw `FriendyStrictModeError` with `code = "UNSUPPORTED_INTENT"` unless an explicit implementation exists.

### Ambiguous Executable Route

If the user gave a route that appears executable but target resolution is ambiguous, strict mode should throw rather than silently picking a target.

Examples:

- two pending contacts have the same display name and the user replies with context that could apply to either;
- a pending prompt is active for Testing 2, but the user message explicitly names Testing 3;
- a delete/update route finds multiple matching memories.

Non-strict mode should ask a concrete clarification.

Strict mode should throw `FriendyStrictModeError` with:

```ts
code = "UNEXPECTED_AMBIGUITY"
policyDecision = "clarify"
```

## Non-Strict Behavior

Without strict mode:

- current fallback behavior may remain;
- Friendy should still avoid generic user-facing fallback copy;
- unsupported contact-management routes should respond with a specific blocker;
- ambiguous executable routes should ask a specific clarification;
- trace envelopes must still be present.

## Implementation Guidance

Add a small strict-mode module, for example:

```text
src/relationship/strictMode.ts
```

Suggested exports:

```ts
export function readFriendyStrictMode(env?: Partial<NodeJS.ProcessEnv>): boolean;
export class FriendyStrictModeError extends Error { ... }
export function assertStrictModeAllowed(input: {
  strictMode: boolean;
  condition: boolean;
  code: FriendyStrictModeErrorCode;
  message: string;
  trace: FriendyTrace;
}): void;
```

Extend agent options so tests can inject strict mode without mutating global env:

```ts
type InterpretedRelationshipAgentOptions = {
  ...
  strictMode?: boolean;
};
```

Live runtime should read `FRIENDY_STRICT_MODE` from env and pass it into the interpreted agent.

## Files To Inspect

- `src/relationship/interpretedAgent.ts`
- `src/relationship/openAIInterpreter.ts`
- `src/relationship/interpretation.ts`
- `src/relationship/runtime/runtimeTrace.ts`
- `src/relationship/transports/spectrumTransport.ts`
- `src/relationship/runtime/friendyRuntimeCli.ts`
- `src/relationship/tools.ts`
- `src/relationship/types.ts`
- `src/relationship/evals/agentEvalRunner.ts`

## Tests To Add

Add tests before implementation.

### Strict Mode Unit Tests

Create or extend tests around strict mode parsing:

- missing env -> strict mode false;
- `FRIENDY_STRICT_MODE=1` -> true;
- `true`, `yes`, `on` -> true;
- `0`, `false`, empty -> false.

### Interpreter Tests

Strict mode should throw when:

- no API key would use fallback;
- model request throws;
- model output is invalid schema;
- fallback interpreter is explicitly used.

Assert:

- error is `FriendyStrictModeError`;
- error code is correct;
- trace includes `strictMode: true`;
- trace indicates fallback state correctly.

### Agent Routing Tests

Add interpreted-agent tests for:

- every successful result includes `trace`;
- deterministic lifecycle route has `routeSource: "deterministic"`;
- pending-contact context route has active frame/candidate ids;
- model/fallback search route has `routeSource` set accurately;
- unsupported intent in non-strict returns specific blocker;
- unsupported intent in strict throws.

### Missing Tool / Unsupported Intent Tests

Simulate a route such as:

```ts
intent: "request_contact_edit"
```

Expected:

- non-strict: no silent search conversion; response says contact editing is not available yet or asks for supported memory edit;
- strict: throws `UNSUPPORTED_INTENT`.

### Ambiguous Executable Route Tests

Add tests for:

- active pending contact is Testing 2, user says `Testing 3 is also...`;
- duplicate pending display names;
- ambiguous delete/update memory target.

Expected:

- non-strict asks a specific clarification;
- strict throws `UNEXPECTED_AMBIGUITY`.

### Runtime Trace Tests

Assert persisted/redacted trace contains:

- `strictMode`;
- `routeSource`;
- `fallbackUsed`;
- `policyDecision`;
- active frame/candidate/memory ids where applicable;
- tool call names.

Assert it does not contain:

- raw message text;
- relationship note text;
- phone numbers;
- emails.

## Acceptance Criteria

- `FRIENDY_STRICT_MODE=1` is supported by runtime config.
- Every interpreted agent result includes `FriendyTrace`.
- Every persisted interaction includes enough trace shape to debug route source, fallback usage, policy, active target, and tools.
- Strict mode throws on model failure, invalid schema, fallback usage, unknown routes, missing tools, unsupported intents, and ambiguous executable routes.
- Non-strict mode remains usable and asks specific clarifications/blockers instead of generic fallback copy.
- No strict-mode trace leaks private text or contact methods.
- Existing lifecycle, candidate confirmation, search, update/delete, and unsafe-request tests still pass.
- `npm test`, `npm run build`, `npm run eval:agent`, and `git diff --check` pass.

## Non-Goals

- Do not implement Apple Contacts create/edit/delete tools in this task.
- Do not add embeddings or reranking.
- Do not replace the existing interpreter architecture.
- Do not remove fallback mode globally; only make it fail fast when strict mode is enabled.
- Do not expose raw private text in runtime traces.

## Suggested Commit Message

```text
feat:add Friendy strict mode trace envelope
```
