# Strict-Mode Dogfooding Trace Design (Concrete Fix Stack — PR 9)

## Summary

PR 9 makes **strict mode the default local dogfooding experience** for the foreground Friendy runtime and expands compact traces so engineers can see *why* a turn routed the way it did. When `FRIENDY_STRICT_MODE=1`, any fallback, unknown route, schema failure, missing tool, or unexpected ambiguity must **fail loudly** — not silently degrade to rule-based behavior.

Strict mode infrastructure already exists (`strictMode.ts`, `openRouterInterpreter.ts`, partial `FriendyTrace`), but dogfooding lacks:

- Documented default command: `FRIENDY_STRICT_MODE=1 npm run agent:friendy`
- Complete trace envelope matching introspection requirements
- Runtime/process exit or surfaced error on fallback during dogfood runs
- Consistent trace fields across interpreted agent, OpenRouter interpreter, and runtime logs

## Stack numbering

| PR | Topic | Status |
|----|--------|--------|
| PR 9 | Strict-mode dogfooding + trace envelope | **This spec** |

Builds on PR 3 router, PR 7 confirmation traces, PR 8 sensor reliability. Can land independently.

## Problem

### Failure — silent fallback masks production issues

Current behavior:

- `readFriendyStrictMode()` defaults **true** when env unset.
- Evals and E2E often set `FRIENDY_STRICT_MODE=0` for deterministic runs.
- Local dogfooding docs do not emphasize strict mode; engineers may run without OpenRouter and not notice fallback.
- `FriendyTrace` omits several introspection fields the team expects when debugging router regressions.

Introspection / regression guidance (implementation-notes + eval `strict-mode-fallback-rejection`):

> In test mode and dogfooding, fallback, unknown routes, schema failures, missing tools, and ambiguous unexpected state should fail.

Today traces include `routeSource`, `fallbackUsed`, `fallbackReason`, but not model metadata or active workflow kind uniformly.

## Goals

- Document and standardize dogfooding command:

```bash
FRIENDY_STRICT_MODE=1 npm run agent:friendy
```

- Extend `FriendyTrace` (and redacted runtime trace) with:

```ts
{
  routeSource: "llm" | "deterministic" | "fallback";
  fallbackUsed: boolean;
  fallbackReason?: string;
  modelRequested?: string;
  modelResponseSchemaValid?: boolean;
  modelErrorCode?: string;
  activeWorkflowKind?: string;
  selectedTool?: string;
}
```

- On fallback in strict mode: throw `FriendyStrictModeError` with code `FALLBACK_USED` (existing) and attach full trace — **already partially implemented**; extend to all entry points (`agent:friendy`, `agent:spectrum`, runtime inbound agent).
- Strict mode failures must be visible in:
  - CLI stderr / logged error
  - compact interaction trace (`interpretedIntentJson.trace`)
  - runtime trace file (`runtimeTrace.ts`) when sensor/runtime handles inbound messages
- Map OpenRouter failures to `modelErrorCode` (`INVALID_ROUTE_SCHEMA`, `MODEL_INTERPRETATION_FAILED`, `MISSING_OPENROUTER_API_KEY`, etc.).
- Set `modelResponseSchemaValid: false` on schema reject paths before throw.
- Populate `activeWorkflowKind` from active frames (PR 6 duplicate, PR 7 pending delete/update, default pending contact).
- Populate `selectedTool` with last executed or policy-selected tool for the turn.
- Add doctor check hint when strict mode on but OpenRouter key missing.

## Non-Goals

- Do not enable strict mode for all eval runs by default (keep `FRIENDY_STRICT_MODE=0` in `agentEvalRunner` except dedicated strict cases).
- Do not change production Spectrum deployment defaults without explicit env.
- Do not add new fallback paths.
- Do not expose raw model prompts in traces (redaction rules unchanged).

## Design approaches considered

### Approach A — Logging only

Log fallback warnings without failing.

| Pros | Cons |
|------|------|
| Never blocks demo | Violates introspection dogfooding rule |

**Verdict:** Rejected for strict mode on.

### Approach B — Fail loud + enriched trace (recommended)

Keep throws; enrich trace; document env for local runs.

| Pros | Cons |
|------|------|
| Matches eval contract | Engineers must configure OpenRouter for happy path |

**Verdict:** Recommended.

### Approach C — Strict mode exits process on first error

`process.exit(1)` from runtime CLI.

| Pros | Cons |
|------|------|
| Very visible | Too aggressive for long-running sensor runtime |

**Verdict:** Reject global exit; throw on inbound turn, keep runtime alive with logged fatal for that message only.

## Trace envelope

### Type changes (`trace.ts`)

```ts
export type FriendyTrace = {
  strictMode: boolean;
  routeSource: FriendyRouteSource;
  fallbackUsed: boolean;
  fallbackReason?: string;
  route?: FriendyRouteTrace;
  policyDecision?: FriendyPolicyDecision;
  suppressedPendingReminder?: boolean;
  pendingReminderDecision?: string;  // PR 5 optional cross-ref
  activeFrameId?: string;
  activeCandidateId?: string;
  activeMemoryId?: string;
  activeWorkflowKind?: "pending_contact_confirm" | "duplicate_resolution" | "pending_delete_confirm" | "pending_update_confirm" | "none";
  selectedTool?: AgentToolCall | string;
  modelRequested?: string;
  modelResponseSchemaValid?: boolean;
  modelErrorCode?: string;
  toolCalls: AgentToolCall[];
};
```

Population rules:

| Field | Source |
|-------|--------|
| `modelRequested` | OpenRouter config model id for turn |
| `modelResponseSchemaValid` | `true` on successful Zod parse of model JSON; `false` before strict throw |
| `modelErrorCode` | `FriendyStrictModeError.code` or OpenRouter error mapping |
| `activeWorkflowKind` | Active conversation frame kind or `"none"` |
| `selectedTool` | Primary tool for turn (last mutation tool, else lookup, else route default) |
| `routeSource` | `"llm"` when OpenRouter succeeded; `"deterministic"` for frame/policy fast paths; `"fallback"` only when strict off |

Redaction (`runtimeTrace.ts`): keep `targetDisplayName` hashed/redacted; model id allowed.

## Strict mode behavior matrix

| Condition | strictMode=true | strictMode=false |
|-----------|-----------------|------------------|
| Missing OpenRouter key | throw `FALLBACK_USED` | rule-based fallback |
| Invalid model JSON schema | throw `INVALID_ROUTE_SCHEMA` | fallback interpreter |
| Model HTTP failure | throw `MODEL_INTERPRETATION_FAILED` | fallback |
| Unknown executable intent | throw `UNKNOWN_ROUTE` | clarify reply |
| Required tool missing | throw `TOOL_NOT_AVAILABLE` | clarify / reject |
| Unexpected ambiguity on mutation | throw `UNEXPECTED_AMBIGUITY` | clarify |

Ensure `interpretedAgent.ts` checks run **before** attaching success trace.

## Dogfooding workflow

### Commands

```bash
# Recommended local dogfood
FRIENDY_STRICT_MODE=1 npm run agent:friendy

# Spectrum inbound with strict routing
FRIENDY_STRICT_MODE=1 npm run agent:spectrum

# Verify config before long run
npm run doctor:friendy
```

### Doctor additions (`friendyDoctor.ts`)

When `FRIENDY_STRICT_MODE` enabled:

- Warn if `OPENROUTER_API_KEY` missing (strict runs will fail on first interpreted message).
- Print effective model id.

### Runtime inbound agent

`friendyRuntimeCli.ts` already reads strict flag into config — ensure inbound Spectrum agent inherits same flag and trace builder.

## Testing strategy

Unit:

- `strictMode.test.ts` — env parsing (existing + new trace attachment).
- `trace.test.ts` — schema validation for new fields.

Integration:

- `interpretedAgent.test.ts` — strict fallback throw includes enriched trace.
- `openRouterInterpreter.test.ts` — schema invalid sets `modelResponseSchemaValid: false`.
- `spectrumTransport.test.ts` — passes strict flag (existing test extended for new fields).
- Eval: keep `strict-mode-fallback-rejection` green; add assertion on trace fields.

Commands:

```bash
npm test -- src/relationship/strictMode.test.ts
npm test -- src/relationship/trace.ts
npm test -- src/relationship/interpretedAgent.test.ts
npm test -- src/relationship/openRouterInterpreter.test.ts
npm run eval:agent
```

Manual dogfood checklist:

1. Run with strict on + valid OpenRouter key → trace shows `routeSource: "llm"`, `modelResponseSchemaValid: true`.
2. Run with strict on + invalid key → turn fails loud; trace includes `fallbackUsed: true`, `modelErrorCode`.
3. Trigger deterministic pending-contact frame → `routeSource: "deterministic"`, `activeWorkflowKind: "pending_contact_confirm"`.

## Documentation updates

- `REFERENCE.md` — dogfooding command block.
- `docs/agent-handoff.md` — strict mode as default for manual validation.
- `implementation-notes.html` — trace envelope decision.

## Boundaries

- **Always:** fail loud on fallback when strict on; redact secrets in traces.
- **Ask first:** changing default strict mode for CI eval jobs.
- **Never:** silently swallow `FriendyStrictModeError` in dogfood paths.

## Success criteria

- [ ] Trace includes all fields in envelope above for interpreted turns.
- [ ] `FRIENDY_STRICT_MODE=1 npm run agent:friendy` documented and works with OpenRouter configured.
- [ ] Fallback paths throw in strict mode with populated `modelErrorCode` / `fallbackReason`.
- [ ] `activeWorkflowKind` and `selectedTool` populated for pending contact, duplicate (PR 6), delete confirm (PR 7).
- [ ] `strict-mode-fallback-rejection` eval passes with trace assertions.
- [ ] Doctor warns when strict mode + missing API key.

## Dependencies

- `src/relationship/strictMode.ts`
- `src/relationship/trace.ts`
- `src/relationship/openRouterInterpreter.ts`
- `src/relationship/interpretedAgent.ts`
- `src/relationship/runtime/runtimeTrace.ts`
- `docs/superpowers/specs/2026-05-23-structured-intent-router-design.md`
- Eval case `strict-mode-fallback-rejection` in `agentEvalRunner.ts`
