# Robust Delete/Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize fuzzy memory target lookup and require confirmation before `delete_memory` / `update_memory` execute.

**Spec:** `docs/superpowers/specs/2026-05-23-robust-delete-update-design.md`

**Architecture:** Add pure `memoryTargetLookup.ts` and expose `lookup_memory_target` as a read-only tool. Replace scattered `rankDisplayNameMatches` call sites in delete/update paths with lookup results. Store `pending_delete_confirm` / `pending_update_confirm` on conversation context (PR 10 session when available). Demote regex `detectMemoryMutationRequest` for user-facing destructive ops.

**Tech Stack:** TypeScript, Vitest, `personNameMatch.ts`, interpreted agent, response composer, route policy validator.

**Depends on:** PR 3 (intents), PR 4 (routing — strongly recommended before dogfood), PR 5 (reminder suppression during confirm flows).

---

## File Structure

- Create: `src/relationship/memoryTargetLookup.ts`
- Create: `src/relationship/memoryTargetLookup.test.ts`
- Modify: `src/relationship/personNameMatch.ts` — only if shared scoring tweaks needed
- Modify: `src/relationship/tools.ts` — `lookup_memory_target` wrapper
- Modify: `src/relationship/responseComposer.ts` — single/multi confirm, update confirm
- Modify: `src/relationship/interpretedAgent.ts` — routing order, remove inline delete lookup, pending update frame
- Modify: `src/relationship/routePolicyValidator.ts` — destructive routes require lookup before mutation in strict mode
- Modify: `src/relationship/trace.ts` — `activeWorkflowKind`, lookup result kind in redacted trace
- Modify: `src/relationship/evals/agentEvalRunner.ts` — fuzzy delete regression
- Modify: `implementation-notes.html`

---

## Task 1: Memory Target Lookup Module

**Files:** `memoryTargetLookup.ts`, `memoryTargetLookup.test.ts`

- [ ] **Step 1:** Write failing tests: `Unamed` → `Unnamed Contact`, `Srah` → ambiguous, none, single high-confidence.
- [ ] **Step 2:** Implement `lookupMemoryTarget` with `minScore`, `ambiguityGap` policy from spec.
- [ ] **Step 3:** Run `npm test -- src/relationship/memoryTargetLookup.test.ts`

---

## Task 2: Tool and Composers

**Files:** `tools.ts`, `responseComposer.ts`, tests

- [ ] **Step 1:** Write failing composer tests for single-match delete, multi-match numbered prompt, update confirm.
- [ ] **Step 2:** Add `lookup_memory_target` to tools (read-only).
- [ ] **Step 3:** Implement `composeDeleteMemoryConfirmReply`, `composeDeleteMemoryDisambiguationReply`, update analogs.
- [ ] **Step 4:** Run composer + tools tests.

---

## Task 3: Agent Routing and Pending Frames

**Files:** `interpretedAgent.ts`, `interpretedAgent.test.ts`

- [ ] **Step 1:** Write failing test: delete request → lookup → confirm prompt → no `delete_memory` same turn.
- [ ] **Step 2:** Write failing test: multi-match → numbered pick → confirm → delete.
- [ ] **Step 3:** Implement routing order from spec; extend `ConversationContext` with `pendingUpdate`.
- [ ] **Step 4:** Remove/gate inline delete lookup at `delete_memory_request` handler; use lookup tool path only.
- [ ] **Step 5:** Demote `detectMemoryMutationRequest` regex for interpreted user messages (strict tests may keep direct tool calls).
- [ ] **Step 6:** Run `npm test -- src/relationship/interpretedAgent.test.ts`

---

## Task 4: Policy and Trace

**Files:** `routePolicyValidator.ts`, `trace.ts`, tests

- [ ] **Step 1:** Add validator check: destructive intent trace includes `lookup_memory_target` before mutation tool when strict.
- [ ] **Step 2:** Populate `activeWorkflowKind` and lookup result kind on trace.
- [ ] **Step 3:** Run targeted tests.

---

## Task 5: Eval and Verification

- [ ] **Step 1:** Confirm `fuzzy-delete-memory-confirmation-regression` passes.
- [ ] **Step 2:** Run full verification:

```bash
npm test -- src/relationship/memoryTargetLookup.test.ts
npm test -- src/relationship/interpretedAgent.test.ts
npm test -- src/relationship/responseComposer.test.ts
npm run eval:agent
npm run build
```

- [ ] **Step 3:** Update implementation notes.
