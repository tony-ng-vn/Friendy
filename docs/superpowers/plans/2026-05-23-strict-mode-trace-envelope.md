# Strict Mode and Trace Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Do not start by changing router behavior. First make route/fallback state observable on every result, then add strict-mode failures, then update evals to prevent silent fallback from hiding future regressions.

**Goal:** Add `FRIENDY_STRICT_MODE=1` and a consistent `FriendyTrace` envelope so model, schema, fallback, unsupported-route, missing-tool, and ambiguity failures cannot silently pass during strict local runs.

**Spec:** `docs/goals/strict-mode-trace-envelope-goal.md`

**Architecture:** Add a small strict-mode boundary and a trace constructor. Thread the trace through interpreted-agent results, persisted interactions, and redacted runtime traces. Keep non-strict behavior usable. In strict mode, throw typed errors instead of silently falling back or converting unsupported intents.

**Tech Stack:** TypeScript, Vitest, Zod, existing OpenRouter interpreter, existing interpreted relationship agent, existing runtime trace.

---

## File Structure

- Add `src/relationship/strictMode.ts`: env parser, `FriendyStrictModeError`, strict assertion helpers.
- Add `src/relationship/trace.ts`: `FriendyTrace` type and trace construction helpers.
- Modify `src/relationship/types.ts`: expose `FriendyTrace` on interpreted agent results if this is the best central type home.
- Modify `src/relationship/interpretedAgent.ts`: populate trace for deterministic, LLM, and fallback routes; enforce strict mode at route execution boundaries.
- Modify `src/relationship/openRouterInterpreter.ts`: expose whether fallback was used and why; support strict-mode no-fallback behavior.
- Modify `src/relationship/interpretation.ts`: ensure unknown/unsupported route shape is explicit rather than silently converted.
- Modify `src/relationship/runtime/runtimeTrace.ts`: include redacted strict-mode envelope fields.
- Modify `src/relationship/transports/spectrumTransport.ts`: preserve trace shape in compact logs.
- Modify `src/relationship/runtime/friendyRuntimeCli.ts`: read `FRIENDY_STRICT_MODE` and pass it to the interpreted agent/runtime.
- Modify `src/relationship/evals/agentEvalRunner.ts`: assert required evals do not depend on unexpected fallback.
- Add/update tests in `src/relationship/*strict*.test.ts`, `openRouterInterpreter.test.ts`, `interpretedAgent.test.ts`, and `runtimeTrace.test.ts`.
- Update `implementation-notes.html`, `docs/agent-handoff.md`, `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, and `docs/goals/EXPERIMENT_NOTES.md`.

## Task 1: Strict Mode Parser and Typed Error

**Files:**
- Add: `src/relationship/strictMode.ts`
- Add: `src/relationship/strictMode.test.ts`

- [ ] Add RED tests for `readFriendyStrictMode`.

Cases:

```ts
expect(readFriendyStrictMode({})).toBe(false);
expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "1" })).toBe(true);
expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "true" })).toBe(true);
expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "yes" })).toBe(true);
expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "on" })).toBe(true);
expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "0" })).toBe(false);
expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "false" })).toBe(false);
expect(readFriendyStrictMode({ FRIENDY_STRICT_MODE: "" })).toBe(false);
```

- [ ] Add RED tests for `FriendyStrictModeError`.

Assert it exposes:

```ts
code:
  | "MODEL_INTERPRETATION_FAILED"
  | "INVALID_ROUTE_SCHEMA"
  | "UNKNOWN_ROUTE"
  | "TOOL_NOT_AVAILABLE"
  | "FALLBACK_USED"
  | "UNSUPPORTED_INTENT"
  | "UNEXPECTED_AMBIGUITY";
trace: FriendyTrace;
```

- [ ] Implement the parser and error class.

- [ ] Run:

```bash
npm test -- src/relationship/strictMode.test.ts
```

## Task 2: Trace Envelope Without Behavior Change

**Files:**
- Add: `src/relationship/trace.ts`
- Modify: `src/relationship/interpretedAgent.ts`
- Modify: `src/relationship/runtime/runtimeTrace.ts`
- Modify tests.

- [ ] Add RED interpreted-agent tests proving every result includes `trace`.

Cover:

- onboarding control -> `routeSource: "deterministic"`;
- pending-contact context -> active frame/candidate ids;
- normal search through fallback interpreter -> `routeSource: "fallback"`, `fallbackUsed: true`;
- deterministic out-of-scope/blocker -> `routeSource: "deterministic"`;
- tool calls are mirrored in the trace envelope.

- [ ] Add RED runtime-trace tests proving the redacted trace includes:

```ts
strictMode
routeSource
fallbackUsed
fallbackReason
policyDecision
activeFrameId
activeCandidateId
activeMemoryId
toolCalls
```

and does not include raw message text, notes, phone numbers, or emails.

- [ ] Implement `FriendyTrace` construction helpers.

Suggested helper:

```ts
export function createFriendyTrace(input: {
  strictMode: boolean;
  routeSource: "llm" | "deterministic" | "fallback";
  fallbackUsed?: boolean;
  fallbackReason?: string;
  route?: FriendyRoute;
  policyDecision?: "allow" | "clarify" | "reject" | "unsupported";
  activeFrameId?: string;
  activeCandidateId?: string;
  activeMemoryId?: string;
  toolCalls?: AgentToolCall[];
}): FriendyTrace;
```

- [ ] Thread the trace through agent results and persisted interaction JSON.

Do not change routing behavior in this task.

- [ ] Run:

```bash
npm test -- src/relationship/interpretedAgent.test.ts src/relationship/runtime/runtimeTrace.test.ts
```

## Task 3: Interpreter Result Metadata

**Files:**
- Modify: `src/relationship/openRouterInterpreter.ts`
- Modify: `src/relationship/openRouterInterpreter.test.ts`

- [ ] Add RED tests proving interpreter results report:

```ts
routeSource: "llm" | "fallback";
fallbackUsed: boolean;
fallbackReason?: string;
```

Cases:

- model succeeds -> `routeSource: "llm"`, `fallbackUsed: false`;
- no API key -> fallback metadata;
- model request fails -> fallback metadata in non-strict mode;
- invalid model output -> fallback metadata in non-strict mode.

- [ ] Implement interpreter metadata.

- [ ] Keep behavior unchanged in non-strict mode.

- [ ] Run:

```bash
npm test -- src/relationship/openRouterInterpreter.test.ts
```

## Task 4: Strict Mode Interpreter Failures

**Files:**
- Modify: `src/relationship/openRouterInterpreter.ts`
- Modify: `src/relationship/interpretedAgent.ts`
- Modify tests.

- [ ] Add RED tests for strict mode:

- invalid model JSON throws `INVALID_ROUTE_SCHEMA`;
- model request failure throws `MODEL_INTERPRETATION_FAILED`;
- no API key / fallback path throws `FALLBACK_USED`;
- explicit fallback interpreter in strict mode throws `FALLBACK_USED`;
- expected clarification does not count as fallback.

- [ ] Implement strict-mode behavior.

Important: strict mode should fail before fallback is executed when the model boundary is expected to be authoritative.

- [ ] Run:

```bash
npm test -- src/relationship/openRouterInterpreter.test.ts src/relationship/interpretedAgent.test.ts
```

## Task 5: Unknown and Unsupported Routes

**Files:**
- Modify: `src/relationship/interpretedAgent.ts`
- Modify: `src/relationship/interpretation.ts`
- Modify tests.

- [ ] Add RED tests for `unknown` route.

Expected:

- non-strict: concrete clarification;
- strict: throw `UNKNOWN_ROUTE`.

- [ ] Add RED tests for unsupported contact-management route.

Use a fake interpreter route:

```ts
intent: "request_contact_edit"
domain: "contact_management"
```

Expected:

- non-strict: `policyDecision: "unsupported"` and specific blocker;
- strict: throw `UNSUPPORTED_INTENT`, or `UNKNOWN_ROUTE` if route shape itself is invalid.

- [ ] Implement explicit unsupported route policy.

Do not convert unsupported intents into search.

- [ ] Run:

```bash
npm test -- src/relationship/interpretedAgent.test.ts
```

## Task 6: Missing Tool Guard

**Files:**
- Modify: `src/relationship/interpretedAgent.ts`
- Modify tests.

- [ ] Add RED test where a route requires a tool not present in the tools object.

Examples:

- contact edit tool absent;
- future tool name present in route but not in `createRelationshipTools`.

Expected:

- non-strict: specific unsupported blocker;
- strict: `FriendyStrictModeError` with `code = "TOOL_NOT_AVAILABLE"`.

- [ ] Implement tool availability guard.

- [ ] Run:

```bash
npm test -- src/relationship/interpretedAgent.test.ts
```

## Task 7: Ambiguous Executable Route Guard

**Files:**
- Modify: `src/relationship/interpretedAgent.ts`
- Modify: `src/relationship/candidateIntake.ts` if needed.
- Modify tests.

- [ ] Add RED tests for ambiguity.

Cases:

- active pending contact is Testing 2, user explicitly says `Testing 3 is also...`;
- duplicate pending display names;
- ambiguous delete/update memory target.

Expected non-strict:

- ask a concrete clarification;
- do not mutate memory.

Expected strict:

- throw `UNEXPECTED_AMBIGUITY`;
- trace has `policyDecision: "clarify"`;
- trace includes active candidate/frame if present.

- [ ] Implement ambiguity guard at target-resolution boundary.

- [ ] Run:

```bash
npm test -- src/relationship/interpretedAgent.test.ts src/relationship/candidateIntake.test.ts
```

## Task 8: Runtime Env Wiring

**Files:**
- Modify: `src/relationship/runtime/friendyRuntimeCli.ts`
- Modify: `src/relationship/transports/spectrumTransport.ts`
- Modify runtime tests.

- [ ] Add RED tests proving `FRIENDY_STRICT_MODE=1` is read from runtime env and passed to the interpreted agent/runtime.

- [ ] Implement env wiring.

- [ ] Ensure strict-mode errors are logged clearly by the live runtime without exposing private message contents.

- [ ] Run:

```bash
npm test -- src/relationship/runtime/friendyRuntimeCli.test.ts src/relationship/transports/spectrumTransport.test.ts
```

## Task 9: Eval Enforcement

**Files:**
- Modify: `src/relationship/evals/agentEvalRunner.ts`
- Modify: `src/relationship/evals/agentEvalRunner.test.ts`

- [ ] Add eval assertions that required cases do not use unexpected fallback when strict-like conditions are requested.

Recommended first step:

- Keep normal evals non-strict and record fallback use in output.
- Add a separate strict-mode eval sample that intentionally fails if fallback is used.

- [ ] Ensure `formatEvalSummary` reports fallback usage count.

- [ ] Run:

```bash
npm test -- src/relationship/evals/agentEvalRunner.test.ts
npm run eval:agent
```

## Task 10: Docs and Final Verification

**Files:**
- Modify `implementation-notes.html`
- Modify `docs/agent-handoff.md`
- Modify `docs/goals/PLAN.md`
- Modify `docs/goals/EXPERIMENTS.md`
- Modify `docs/goals/EXPERIMENT_NOTES.md`

- [ ] Record decisions:

- trace-first implementation avoids changing behavior before observability;
- strict mode is opt-in and intended for development/evals;
- non-strict runtime remains tolerant but no longer hides trace metadata;
- strict mode must not leak raw private text.

- [ ] Run final verification:

```bash
npm test
npm run build
npm run eval:agent
git diff --check
```

- [ ] Commit:

```bash
git commit -m "feat:add Friendy strict mode trace envelope"
```

## Acceptance Checklist

- [ ] `FRIENDY_STRICT_MODE=1` is parsed and wired into runtime.
- [ ] Every interpreted-agent result includes `FriendyTrace`.
- [ ] Persisted/redacted traces expose route source, fallback usage, policy, active target, and tools.
- [ ] Strict mode throws on invalid model JSON.
- [ ] Strict mode throws on model failure.
- [ ] Strict mode throws on fallback interpreter usage.
- [ ] Strict mode throws on unknown route.
- [ ] Strict mode throws on missing tool.
- [ ] Strict mode throws on ambiguous executable route.
- [ ] Expected clarification does not count as fallback.
- [ ] Unsupported intent is not silently converted to search.
- [ ] Non-strict mode remains usable.
- [ ] Trace does not leak private text, notes, phone numbers, or emails.
- [ ] `npm test`, `npm run build`, `npm run eval:agent`, and `git diff --check` pass.
