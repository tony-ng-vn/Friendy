# Identity Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `PersonIdentity`, `AppleContactLink`, and a deterministic `duplicate_resolution` workflow so same-display-name candidates do not create duplicate memories without same/different/ignore/not_sure resolution.

**Spec:** `docs/superpowers/specs/2026-05-23-identity-resolution-design.md`

**Architecture:** Extend domain types and SQLite schema; add repository methods for person/link CRUD; detect display-name collisions at candidate prompt time; route resolution replies through deterministic tools before `confirm_candidate`. Integrate with PR 5 reminder suppression and PR 10 session `activeWorkflow` when available.

**Tech Stack:** TypeScript, Vitest, SQLite (`node:sqlite`), existing repository/tools/interpreted agent, response composer.

**Depends on:** PR 3 (structured intents), PR 5 (reminder policy — same-name suppression). **Blocks:** none of PR 7–8; improves PR 7 disambiguation when landed.

---

## File Structure

- Create: `src/relationship/personIdentity.ts` — types, fingerprint helpers, normalization
- Create: `src/relationship/duplicateResolution.ts` — reply parsing (`same`/`different`/`ignore`/`not sure`)
- Create: `src/relationship/duplicateResolution.test.ts`
- Create: `src/relationship/personIdentity.test.ts`
- Modify: `src/relationship/types.ts` — `personId` on memory; candidate duplicate fields
- Modify: `src/relationship/repository.ts` — in-memory person/link API
- Modify: `src/relationship/sqliteRepository.ts` — `person_identities`, `apple_contact_links` tables + migration
- Modify: `src/relationship/tools.ts` — `resolve_duplicate_person`; populate `ListedPerson.personId`
- Modify: `src/relationship/responseComposer.ts` — duplicate resolution prompts
- Modify: `src/relationship/interpretedAgent.ts` — active workflow guard before generic confirm
- Modify: `src/relationship/ingestion/ingestionPipeline.ts` or prompt path — trigger duplicate workflow
- Modify: `src/relationship/evals/agentEvalRunner.ts` — un-RED same-name regression if still failing post-impl
- Modify: `implementation-notes.html`, `docs/agent-handoff.md`

---

## Task 1: Domain Types and Fingerprint Helpers

**Files:** `personIdentity.ts`, `types.ts`, `personIdentity.test.ts`

- [ ] **Step 1:** Write failing tests for `computeMethodFingerprint` and normalized display-name collision helper.
- [ ] **Step 2:** Add `PersonIdentity`, `AppleContactLink` types; extend `RelationshipMemory.personId`, `ContactCandidate` duplicate fields.
- [ ] **Step 3:** Run `npm test -- src/relationship/personIdentity.test.ts`

---

## Task 2: In-Memory Repository API

**Files:** `repository.ts`, `repository.test.ts`

- [ ] **Step 1:** Write failing tests for `createPersonIdentity`, `linkAppleContact`, `findPersonByMethodFingerprint`, `findPeopleByDisplayNameNormalized`, `attachCandidateToPerson`.
- [ ] **Step 2:** Implement methods on in-memory repository; ensure confirm flow sets `personId` on new memories.
- [ ] **Step 3:** Run `npm test -- src/relationship/repository.test.ts`

---

## Task 3: SQLite Schema and Backfill

**Files:** `sqliteRepository.ts`, `sqliteRepository.test.ts`

- [ ] **Step 1:** Write failing tests for person/link persistence and memory `person_id` column.
- [ ] **Step 2:** Add tables + migration; backfill existing memories with synthetic person rows (spec migration rules).
- [ ] **Step 3:** Run `npm test -- src/relationship/sqliteRepository.test.ts`

---

## Task 4: Duplicate Resolution Parsing

**Files:** `duplicateResolution.ts`, `duplicateResolution.test.ts`

- [ ] **Step 1:** Write failing tests for `parseDuplicateResolutionReply` covering same/different/ignore/not_sure variants.
- [ ] **Step 2:** Implement parser mirroring `candidateConfirmation.ts` style.
- [ ] **Step 3:** Run `npm test -- src/relationship/duplicateResolution.test.ts`

---

## Task 5: Tools and Composers

**Files:** `tools.ts`, `responseComposer.ts`, `tools.test.ts`, `responseComposer.test.ts`

- [ ] **Step 1:** Write failing tests for `resolve_duplicate_person` tool and `composeDuplicateResolutionPrompt`.
- [ ] **Step 2:** Implement tool + composer copy from spec example (Testing 3).
- [ ] **Step 3:** Wire `list_people` to return real `personId` when present.
- [ ] **Step 4:** Run targeted tests.

---

## Task 6: Agent Workflow Integration

**Files:** `interpretedAgent.ts`, `interpretedAgent.test.ts`

- [ ] **Step 1:** Write failing integration test: saved Testing 3 + pending Testing 3 → duplicate prompt, no `confirm_candidate` before resolution.
- [ ] **Step 2:** On candidate prompt path, detect display-name collision (method fingerprint not already linked) → set `suspectedDuplicatePersonId`, send duplicate prompt.
- [ ] **Step 3:** Handle active duplicate workflow before generic pending confirm; call `resolve_duplicate_person` / `ignore_candidate`.
- [ ] **Step 4:** Set trace `activeWorkflowKind: "duplicate_resolution"`.
- [ ] **Step 5:** Run `npm test -- src/relationship/interpretedAgent.test.ts`

---

## Task 7: Eval and Docs

**Files:** `agentEvalRunner.ts`, handoff docs

- [ ] **Step 1:** Verify `same-name-pending-contact-disambiguation-regression` passes.
- [ ] **Step 2:** Run `npm run eval:agent`
- [ ] **Step 3:** Update `implementation-notes.html` and `docs/agent-handoff.md`

---

## Verification

```bash
npm test -- src/relationship/personIdentity.test.ts src/relationship/duplicateResolution.test.ts
npm test -- src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts
npm test -- src/relationship/interpretedAgent.test.ts
npm run eval:agent
npm run build
```
