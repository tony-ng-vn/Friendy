# Strict-Mode Dogfooding Trace Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete dogfooding observability on merged strict-mode infrastructure — delta trace fields, scope-boundary visibility, runtime warnings, doctor hints, and joint May 23 acceptance with PR 4.

**Spec:** `docs/superpowers/specs/2026-05-23-strict-mode-dogfooding-trace-design.md`

**Baseline (already merged — do not redo):** `docs/superpowers/plans/2026-05-23-strict-mode-trace-envelope.md` — strict parser, `FriendyStrictModeError`, base `FriendyTrace`, fallback throws, eval `strict-mode-fallback-rejection`.

**Architecture:** Extend `FriendyTrace` and runtime redaction with delta fields only. Instrument scope-boundary short-circuit separately from OpenAI path. Add startup warning when strict off. Add doctor + docs. Add integration test with PR 4 envelope replaying May 23 transcript.

**Tech Stack:** TypeScript, Vitest, trace/runtime/doctor modules, OpenAI interpreter, interpreted agent.

**Depends on:** Merged strict-mode work; **joint acceptance requires PR 4** envelope landed.

---

## File Structure

- Modify: `src/relationship/trace.ts` — delta fields, `scope_boundary` route source
- Create: `src/relationship/trace.test.ts` (if missing) — new field validation
- Modify: `src/relationship/openAIInterpreter.ts` — `modelRequested`, `modelResponseSchemaValid`, `modelErrorCode` on results
- Modify: `src/relationship/interpretedAgent.ts` — scope-boundary trace, `activeWorkflowKind`, `selectedTool`
- Modify: `src/relationship/scopeBoundary.ts` or call sites — return trace-friendly scope decision
- Modify: `src/relationship/runtime/runtimeTrace.ts` — redact new fields
- Modify: `src/relationship/runtime/friendyRuntimeCli.ts` — startup strict-off warning
- Modify: `src/relationship/runtime/friendyDoctor.ts` — strict + missing API key warning
- Modify: `REFERENCE.md`, `docs/agent-handoff.md`, `implementation-notes.html`
- Modify: `src/relationship/interpretedAgent.test.ts` — scope trace + May 23 joint test (after PR 4)
- Modify: `src/relationship/openAIInterpreter.test.ts` — schema invalid trace fields

---

## Task 1: Trace Type Extensions (Delta Only)

**Files:** `trace.ts`, `trace.test.ts`

- [ ] **Step 1:** Write failing tests for new optional fields and `routeSource: "scope_boundary"`.
- [ ] **Step 2:** Extend `FriendyRouteSource`, `ActiveWorkflowKind`, `FriendyTrace` per spec.
- [ ] **Step 3:** Update `createFriendyTrace` / `extractFriendyTrace` defaults.
- [ ] **Step 4:** Run trace tests.

---

## Task 2: OpenAI Trace Metadata

**Files:** `openAIInterpreter.ts`, `openAIInterpreter.test.ts`

- [ ] **Step 1:** Write failing tests: successful parse sets `modelResponseSchemaValid: true`; invalid schema sets `false` before throw.
- [ ] **Step 2:** Attach `modelRequested` from config on every interpret call.
- [ ] **Step 3:** Map errors to `modelErrorCode` on strict throw paths.
- [ ] **Step 4:** Run interpreter tests.

---

## Task 3: Scope-Boundary and Workflow Trace in Agent

**Files:** `interpretedAgent.ts`, `interpretedAgent.test.ts`

- [ ] **Step 1:** Write failing test: out-of-scope before interpreter → `routeSource: "scope_boundary"`, no model fields.
- [ ] **Step 2:** Populate `activeWorkflowKind` from pending/duplicate/delete frames.
- [ ] **Step 3:** Populate `selectedTool` from primary executed or mandated tool.
- [ ] **Step 4:** Ensure `runtimeTrace.ts` includes new fields redacted appropriately.
- [ ] **Step 5:** Run agent tests.

---

## Task 4: Runtime Warning and Doctor

**Files:** `friendyRuntimeCli.ts`, `friendyDoctor.ts`, tests

- [ ] **Step 1:** Log WARN when strict resolves false and inbound interpreted agent enabled.
- [ ] **Step 2:** Doctor: strict on + missing `OPENAI_API_KEY` → actionable warning; print model id.
- [ ] **Step 3:** Run doctor/runtime CLI tests.

---

## Task 5: Documentation

**Files:** `REFERENCE.md`, `docs/agent-handoff.md`, `implementation-notes.html`

- [ ] **Step 1:** Document `FRIENDY_STRICT_MODE=1 npm run agent:friendy` as manual validation requirement.
- [ ] **Step 2:** Note PR 9 delta vs merged strict-mode plan.

---

## Task 6: Joint May 23 Acceptance (After PR 4)

**Files:** `interpretedAgent.test.ts` or dedicated integration test file

- [ ] **Step 1:** Add transcript fixture with mocked OpenAI returning correct intents per turn.
- [ ] **Step 2:** Assert strict on → no `routeSource: "fallback"` on list/duplicate/repair/delete turns.
- [ ] **Step 3:** Run full verification:

```bash
npm test -- src/relationship/trace.test.ts
npm test -- src/relationship/openAIInterpreter.test.ts
npm test -- src/relationship/interpretedAgent.test.ts
npm run eval:agent
npm run build
```

---

## Verification Checklist (Manual)

1. `FRIENDY_STRICT_MODE=1 npm run agent:friendy` with valid OpenAI → traces show `routeSource: "llm"`.
2. Same with missing API key → turn fails loud with `modelErrorCode`.
3. Strict off → startup warning appears.
