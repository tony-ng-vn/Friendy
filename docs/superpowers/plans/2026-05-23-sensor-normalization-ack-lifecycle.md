# Sensor Normalization and Ack Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept macOS sensor events with empty contact method labels and enforce ack-only-after-persist lifecycle for history batches.

**Spec:** `docs/superpowers/specs/2026-05-23-sensor-normalization-ack-lifecycle-design.md`

**Architecture:** Add `normalizeSensorEventPayload()` before Zod parse in `parseSensorEventLine`. Persist validation/normalization outcomes in processed-event records. Keep ack in `friendyRuntime.ts` gated on all batch contact events having durable processed rows. Use SQLite transactions where candidate enqueue + processed record must be atomic.

**Tech Stack:** TypeScript, Vitest, Zod, `friendyRuntime.ts`, `sensorEvents.ts`, SQLite runtime store.

**Depends on:** Durable runtime store (merged). Independent of PR 4–7 agent routing.

---

## File Structure

- Create: `src/relationship/runtime/normalizeSensorEvent.ts`
- Create: `src/relationship/runtime/normalizeSensorEvent.test.ts`
- Modify: `src/relationship/runtime/sensorEvents.ts` — normalization hook + schema tolerance
- Modify: `src/relationship/runtime/sensorEvents.test.ts` — empty label fixtures
- Modify: `src/relationship/runtime/friendyRuntime.ts` — explicit lifecycle ordering, failure persistence, logging
- Modify: `src/relationship/runtime/friendyRuntime.test.ts` — ack deferred until processed
- Modify: `src/relationship/runtime/fakeMacosSensor.ts` — fixture with empty label line
- Modify: `src/relationship/runtime/friendyRuntimeCheck.test.ts` — empty label path
- Modify: `src/relationship/sqliteRepository.ts` — optional validation status on processed events
- Modify: `implementation-notes.html`

---

## Task 1: Normalization Helper

**Files:** `normalizeSensorEvent.ts`, `normalizeSensorEvent.test.ts`

- [ ] **Step 1:** Write failing tests: empty `label`, whitespace label, missing label, untouched valid hints.
- [ ] **Step 2:** Implement trim/default `"unknown"` for phone/email hints per spec table.
- [ ] **Step 3:** Run `npm test -- src/relationship/runtime/normalizeSensorEvent.test.ts`

---

## Task 2: Parser Integration

**Files:** `sensorEvents.ts`, `sensorEvents.test.ts`

- [ ] **Step 1:** Write failing test: JSON line with `"label": ""` parses successfully.
- [ ] **Step 2:** Call normalization after `assertNoRawContactMethods`, before `sensorEventSchema.safeParse`.
- [ ] **Step 3:** Adjust schema or preprocess so empty labels never fail whole event.
- [ ] **Step 4:** Run `npm test -- src/relationship/runtime/sensorEvents.test.ts`

---

## Task 3: Runtime Lifecycle and Failure Persistence

**Files:** `friendyRuntime.ts`, `friendyRuntime.test.ts`, `sqliteRepository.ts`

- [ ] **Step 1:** Write failing test: parse failure records `failed` processed event; batch not acked.
- [ ] **Step 2:** Write failing test: `history_batch_complete` ack only when all `contactEventIds` have processed records.
- [ ] **Step 3:** Wrap contact_added persist + candidate enqueue in transaction where applicable.
- [ ] **Step 4:** Add log prefixes: `sensor_event_normalized`, `sensor_event_validation_failed`, `history_batch_ack_deferred`, `history_batch_ack_written`.
- [ ] **Step 5:** Run `npm test -- src/relationship/runtime/friendyRuntime.test.ts`

---

## Task 4: Fixture and Runtime Check

**Files:** `fakeMacosSensor.ts`, `friendyRuntimeCheck.test.ts`, `macosSensorFixtureCheck.ts`

- [ ] **Step 1:** Add fixture NDJSON line with empty phone label.
- [ ] **Step 2:** Ensure `npm run agent:friendy:check` passes with new fixture.
- [ ] **Step 3:** Update implementation notes.

---

## Verification

```bash
npm test -- src/relationship/runtime/normalizeSensorEvent.test.ts
npm test -- src/relationship/runtime/sensorEvents.test.ts
npm test -- src/relationship/runtime/friendyRuntime.test.ts
npm run agent:friendy:check
npm run build
```
