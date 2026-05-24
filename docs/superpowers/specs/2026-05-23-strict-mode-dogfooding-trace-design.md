# Strict-Mode Dogfooding and Trace Completion (Concrete Fix Stack — PR 9)

## Summary

PR 9 completes **local dogfooding observability** on top of strict-mode infrastructure that already landed (see merged work in `src/relationship/strictMode.ts`, `src/relationship/trace.ts`, and plan `docs/superpowers/plans/2026-05-23-strict-mode-trace-envelope.md`).

This PR is **not** a greenfield strict-mode implementation. It adds:

- documented dogfood commands and runtime warnings;
- trace fields still missing from the baseline envelope;
- scope-boundary visibility when routing never reaches OpenAI;
- joint acceptance criteria with PR 4 so the May 23 log cannot silently fall back.

When `FRIENDY_STRICT_MODE=1`, fallback, schema failure, unknown executable routes, missing tools, and unexpected ambiguity must **fail loudly** — not degrade to rule-based routing that looks like success.

## Stack numbering

| PR | Topic | Status |
|----|--------|--------|
| PR 1–3 | Regression freeze, `list_people`, structured router | Done |
| PR 4 | Pass state into LLM router | Executing |
| PR 5 | Pending reminder policy | Plan ready |
| PR 6–8 | Identity, delete/update, sensor | Spec only |
| PR 9 | Strict-mode dogfooding + trace completion | **This spec** |
| PR 10 | Durable conversation session | Spec only (deferred; see PR 10) |

**Relationship to prior strict-mode work:** baseline strict throws, `FriendyTrace`, runtime CLI wiring, and eval `strict-mode-fallback-rejection` already exist. PR 9 success criteria below list **deltas only** — do not re-implement merged behavior.

## Problem

### Failure — dogfood runs hid routing problems

The May 23 log showed `"strictMode": false` and repeated:

- `modelUsed: "rule-based-fallback"`
- `intent: "search_memory"` on list/delete turns
- `intent: "unknown"` at ~5ms for repair/duplicate questions (scope or pre-model short-circuit)

That is not a model-quality failure. Engineers ran without strict dogfood discipline and could not see **why** Friendy never reached a state-aware LLM plan.

### Already fixed (do not redo in PR 9)

- `readFriendyStrictMode()` and `FriendyStrictModeError` codes
- Strict-mode throw on fallback when strict is on (`openAIInterpreter.ts`, `interpretedAgent.ts`)
- Base `FriendyTrace` with `routeSource`, `fallbackUsed`, `fallbackReason`, `toolCalls`
- `friendyRuntimeCli.ts` reads `FRIENDY_STRICT_MODE` into runtime config
- Eval case `strict-mode-fallback-rejection`

### Still missing (PR 9 scope)

- Dogfood docs/commands that **require** strict mode for manual validation
- Runtime startup warning when strict is explicitly disabled during dogfood
- Trace fields: `modelRequested`, `modelResponseSchemaValid`, `modelErrorCode`, `activeWorkflowKind`, `selectedTool`
- Trace when **`decideMessageScope`** rejects before OpenAI (deterministic out-of-scope at ~5ms)
- Doctor hint when strict on but `OPENAI_API_KEY` missing
- Joint transcript test with PR 4: May 23 turns must not use fallback when strict on + OpenAI configured

## Goals

- Document canonical dogfood commands:

```bash
FRIENDY_STRICT_MODE=1 npm run agent:friendy
FRIENDY_STRICT_MODE=1 npm run agent:spectrum
npm run doctor:friendy
```

- Extend `FriendyTrace` and redacted runtime traces with **delta fields**:

```ts
{
  routeSource: "llm" | "deterministic" | "fallback" | "scope_boundary";
  fallbackUsed: boolean;
  fallbackReason?: string;
  modelRequested?: string;
  modelResponseSchemaValid?: boolean;
  modelErrorCode?: string;
  activeWorkflowKind?: ActiveWorkflowKind;
  selectedTool?: AgentToolCall | string;
  scopeDecision?: "in_scope" | "out_of_scope" | "clarify";
}
```

- Log one-line runtime warning when `FRIENDY_STRICT_MODE=0` (or `false`/`off`) and interpreted inbound agent is enabled — dogfood may hide routing failures.
- Ensure strict failures surface in: stderr/logger, `interpretedIntentJson.trace`, and `runtimeTrace.ts`.
- Add doctor check: strict enabled + missing OpenAI key → warn before first message.
- Add integration coverage with PR 4 envelope: May 23 transcript routes without `routeSource: "fallback"`.

## Non-Goals

- Do not re-implement base strict-mode throws or `FriendyTrace` constructor (already merged).
- Do not enable strict mode for all eval runs by default (keep `FRIENDY_STRICT_MODE=0` in `agentEvalRunner` except dedicated strict cases).
- Do not change production Spectrum defaults without explicit env.
- Do not add new fallback paths or disable strict mode by default in code.
- Do not `process.exit(1)` on first strict error — long-running sensor runtime stays up; fail the **turn** only.
- Do not expose raw model prompts or secrets in traces.

## Design approaches considered

### Approach A — Logging only

Log fallback warnings without failing when strict is on.

**Verdict:** Rejected — already solved by merged strict mode; PR 9 adds visibility, not softer failures.

### Approach B — Trace completion + dogfood docs (recommended)

Add delta trace fields, scope-boundary source, doctor/docs, joint PR 4 acceptance.

**Verdict:** Recommended.

### Approach C — Force strict on in code always

Remove env toggle.

**Verdict:** Rejected — evals and fixtures still need `FRIENDY_STRICT_MODE=0`.

## Trace envelope (delta only)

Extend existing `FriendyTrace` in `trace.ts`:

```ts
export type FriendyRouteSource =
  | "llm"
  | "deterministic"
  | "fallback"
  | "scope_boundary";

export type ActiveWorkflowKind =
  | "pending_contact_confirm"
  | "duplicate_resolution"
  | "pending_delete_confirm"
  | "pending_update_confirm"
  | "none";

export type FriendyTrace = {
  // existing fields...
  routeSource: FriendyRouteSource;
  scopeDecision?: "in_scope" | "out_of_scope" | "clarify";
  activeWorkflowKind?: ActiveWorkflowKind;
  selectedTool?: AgentToolCall | string;
  modelRequested?: string;
  modelResponseSchemaValid?: boolean;
  modelErrorCode?: string;
};
```

Population rules (new or clarified):

| Field | Source |
|-------|--------|
| `routeSource: "scope_boundary"` | `decideMessageScope` returned out-of-scope/clarify before interpreter |
| `modelRequested` | OpenAI config model id for the turn |
| `modelResponseSchemaValid` | `true` after successful route JSON parse; `false` before strict throw on invalid schema |
| `modelErrorCode` | `FriendyStrictModeError.code` or mapped OpenAI failure |
| `activeWorkflowKind` | Active session/frame: pending contact (now), duplicate (PR 6), delete/update confirm (PR 7) |
| `selectedTool` | Primary tool executed or policy-mandated next tool (`lookup_memory_target`, etc.) |

Redaction unchanged: no raw contact methods; model id allowed.

## Strict mode behavior matrix (reference — baseline merged)

| Condition | strictMode=true | strictMode=false |
|-----------|-----------------|------------------|
| Missing OpenAI key | throw `FALLBACK_USED` | rule-based fallback |
| Invalid model JSON schema | throw `INVALID_ROUTE_SCHEMA` | fallback interpreter |
| Model HTTP failure | throw `MODEL_INTERPRETATION_FAILED` | fallback |
| Unknown executable intent | throw `UNKNOWN_ROUTE` | clarify reply |
| Required tool missing | throw `TOOL_NOT_AVAILABLE` | clarify / reject |
| Unexpected ambiguity on mutation | throw `UNEXPECTED_AMBIGUITY` | clarify |

PR 9 adds tracing for scope-boundary and pre-interpreter deterministic paths without changing this matrix.

## Scope-boundary tracing

When `scopeBoundary.ts` returns out-of-scope before OpenAI:

- set `routeSource: "scope_boundary"`
- set `scopeDecision: "out_of_scope"` (or `"clarify"`)
- set `modelResponseSchemaValid: undefined` (interpreter not invoked)
- include `activeWorkflowKind` from pending frame if present

This explains May 23 turns like duplicate audit and conversation repair that showed `unknown` at ~5ms without looking like model failure.

## Dogfooding workflow

### Required manual validation

```bash
# 1. Verify env
npm run doctor:friendy

# 2. Foreground runtime (strict)
FRIENDY_STRICT_MODE=1 npm run agent:friendy

# 3. Spectrum inbound (strict)
FRIENDY_STRICT_MODE=1 npm run agent:spectrum
```

### Runtime warning (new)

On startup when inbound interpreted agent is enabled and `FRIENDY_STRICT_MODE` resolves to `false`:

```text
WARN: FRIENDY_STRICT_MODE is off — rule-based fallback and silent routing degradation are allowed. Use FRIENDY_STRICT_MODE=1 for dogfood.
```

### Doctor additions

When strict mode is enabled:

- warn if `OPENAI_API_KEY` is missing;
- print effective `OPENAI_MODEL`;
- print resolved `strictMode: true`.

## Joint acceptance with PR 4

After PR 4 lands, add one integration test (or eval fixture) replaying May 23 user turns with:

- `FRIENDY_STRICT_MODE=1`
- mocked OpenAI returning correct structured intents
- assertions per turn:

| User message | Must NOT see | Must see |
|--------------|--------------|----------|
| List … testing friendy (bullets) | `fallback`, `search_memories` only | `list_people`, no stale pending append |
| Duplicate people in contacts? | `unknown`, `scope_boundary` out-of-scope | `duplicate_audit`, `find_duplicate_people` |
| Why still asking Testing 3 context? | `unknown` | `explain_agent_state` or `conversation_repair` |
| Delete Unamed Contact | `search_memory` fallback | `delete_memory_request`, fuzzy confirm |
| I met during testing Friendy | premature `confirm_candidate` when same-name unresolved | same/different or correct active candidate |

Without PR 4 envelope, strict mode alone will still fail loudly — that is correct. PR 9 ensures failures are **visible**; PR 4 ensures the model gets state to route correctly.

## Testing strategy

Unit:

- `strictMode.test.ts` — unchanged baseline; add tests for new trace fields only
- New or extended `trace.test.ts` — `scope_boundary` route source, workflow kind

Integration:

- `openAIInterpreter.test.ts` — `modelResponseSchemaValid: false` on schema reject
- `interpretedAgent.test.ts` — scope-boundary trace shape
- `spectrumTransport.test.ts` — strict flag + delta fields in compact log
- Keep eval `strict-mode-fallback-rejection` green

Commands:

```bash
npm test -- src/relationship/strictMode.test.ts
npm test -- src/relationship/trace.test.ts
npm test -- src/relationship/interpretedAgent.test.ts
npm test -- src/relationship/openAIInterpreter.test.ts
npm run eval:agent
```

## Documentation updates

- `REFERENCE.md` — dogfood command block + strict mode note
- `docs/agent-handoff.md` — manual validation requires strict on
- `implementation-notes.html` — PR 9 delta vs merged strict-mode PR

## Boundaries

- **Always:** fail loud on fallback when strict on (existing); redact secrets
- **Ask first:** changing CI eval default strict mode
- **Never:** re-implement merged strict-mode core; silently swallow `FriendyStrictModeError`

## Success criteria (delta only)

- [ ] `FriendyTrace` includes `modelRequested`, `modelResponseSchemaValid`, `modelErrorCode`, `activeWorkflowKind`, `selectedTool`, and `scopeDecision` where applicable.
- [ ] `routeSource: "scope_boundary"` recorded when `decideMessageScope` blocks before OpenAI.
- [ ] Runtime logs warning when strict is explicitly off and inbound interpreted agent runs.
- [ ] Doctor warns when strict on + missing `OPENAI_API_KEY`.
- [ ] `REFERENCE.md` and handoff doc list `FRIENDY_STRICT_MODE=1` dogfood commands.
- [ ] Joint May 23 transcript test passes with PR 4 + strict on (no fallback on listed turns).
- [ ] Existing eval `strict-mode-fallback-rejection` still passes (no regression).

## Dependencies

- Merged: `src/relationship/strictMode.ts`, `src/relationship/trace.ts`, `openAIInterpreter.ts`, `interpretedAgent.ts`, `runtimeTrace.ts`, `friendyRuntimeCli.ts`
- In flight: `docs/superpowers/specs/2026-05-23-pass-state-into-llm-router-design.md` (PR 4)
- Future trace consumers: PR 5 (`pendingReminderDecision`), PR 6/7 (`activeWorkflowKind` values)

## Implementation note

Create plan `docs/superpowers/plans/2026-05-23-strict-mode-dogfooding-trace.md` as a **delta plan** referencing the merged strict-mode plan — task list should skip already-completed parser/error/trace baseline work.
