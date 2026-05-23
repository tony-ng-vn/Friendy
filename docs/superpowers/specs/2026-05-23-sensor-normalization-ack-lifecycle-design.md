# Sensor Normalization and Ack Lifecycle Design (Concrete Fix Stack — PR 8)

## Summary

PR 8 fixes macOS sensor ingestion failures caused by **over-strict hint validation** and makes the **ack lifecycle** explicit and durable. Live logs show invalid sensor events when Contacts returns phone/email labels as empty strings; Zod rejects them before runtime processing. Separately, ack timing must guarantee: **never ack a history batch until every contact event is validated, normalized, persisted, and candidate/enqueue work is complete.**

## Stack numbering

| PR | Topic | Status |
|----|--------|--------|
| PR 8 | Sensor normalization + ack lifecycle | **This spec** |
| PR 9 | Strict-mode dogfooding trace | Spec in progress |

Independent of PR 6–7 but shares SQLite runtime store from `2026-05-21-durable-runtime-store-design.md`.

## Problem

### Failure 1 — empty contact method labels fail schema validation

Current schema (`src/relationship/runtime/sensorEvents.ts`):

```ts
const contactMethodHintSchema = z.object({
  last4: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  label: z.string().min(1).optional()
});
```

Swift/Contacts may emit `"label": ""` for unlabeled phone rows. Optional + `min(1)` rejects empty string — event never reaches runtime; logs show `Invalid macOS sensor event`.

Downstream effect: candidate never enqueued; history batch never ackable; sensor retries same batch.

### Failure 2 — ack lifecycle implicit / ordering unclear

`friendyRuntime.ts` documents ack-after-processed, but implementation gaps to close:

1. **Normalize before validate** — empty labels should become `"unknown"` (or dropped) pre-Zod.
2. **Persist raw event** — audit trail for invalid/normalized events (redacted) before business logic.
3. **Enqueue candidate/event** — repository + processed-state writes must complete in one logical unit.
4. **Ack history batch** — only when all `contactEventIds` have durable processed records.

Risk today: thrown parse errors skip persistence entirely; batch may never ack; native sensor stalls.

## Goals

- Accept sensor events with empty/whitespace method labels without failing the whole batch.
- Normalize hints consistently in one place shared by tests, fake sensor, and runtime parser.
- Document and enforce ack pipeline ordering (see Target lifecycle below).
- Persist raw normalized sensor event metadata for debugging (redacted; no raw phone/email).
- Improve logging: distinguish validation failure, normalization applied, waiting-for-ack.
- Add regression tests for empty-label fixture lines.
- Align Swift emitter guidance (prefer omit empty label) but TS side must be tolerant.

## Non-Goals

- Do not relax privacy rules — still reject raw phone/email fields.
- Do not change history batch wire format from Swift unless needed for label omission.
- Do not ack on partial batch failure — sensor should retry failed events.
- Do not auto-create candidates from invalid/unparseable events.

## Design approaches considered

### Approach A — Loosen Zod only

Change to `z.string().trim().optional()` without normalization pass.

| Pros | Cons |
|------|------|
| One-line fix | Empty string still fails if not trimmed; no audit trail |

**Verdict:** Insufficient alone.

### Approach B — Normalize pre-parse + relaxed schema (recommended)

Add `normalizeSensorEventPayload()` before `sensorEventSchema.safeParse`; default empty label to `"unknown"`.

| Pros | Cons |
|------|------|
| Fixes live logs | Two-step parse path |
| Centralizes hint cleanup | |

**Verdict:** Recommended.

### Approach C — Ack before persist (faster sensor)

Write ack immediately on batch receive.

| Pros | Cons |
|------|------|
| Sensor unblocks quickly | Data loss if process crashes — **rejected by product** |

**Verdict:** Rejected.

## Normalization rules

New helper: `src/relationship/runtime/normalizeSensorEvent.ts`

```ts
export function normalizeSensorEventPayload(payload: Record<string, unknown>): Record<string, unknown>;
```

For each `contact.phoneNumberHints[]` / `contact.emailHints[]` entry:

| Field | Rule |
|-------|------|
| `label` | `trim()`; if empty → `"unknown"` (or omit key — pick one; default `"unknown"` for stable composer/debug) |
| `last4` | trim; empty → omit |
| `domain` | trim; empty → omit |

Apply recursively only on known contact payload paths; do not mutate unrelated fields.

Update schema:

```ts
label: z.string().trim().min(1).optional().default("unknown")
```

Or preprocess + keep optional without default — **implementation must choose one path; tests cover empty string input.**

Parser entry (`parseSensorEventLine`):

```text
JSON.parse
  -> assertCommonContract
  -> assertNoRawContactMethods
  -> normalizeSensorEventPayload
  -> sensorEventSchema.safeParse
```

## Ack lifecycle (explicit)

Required ordering for `contact_added`:

```text
sensor NDJSON line received
  -> validate + normalize payload   (parseSensorEventLine)
  -> persist raw event audit        (processed_sensor_events and/or sensor_event_log)
  -> enqueue candidate + event matches + prompt plan
  -> recordProcessedEvent(status=candidate_created|duplicate|ignored)
  -> (optional) send prompt
```

For `history_batch_complete`:

```text
history_batch_complete received
  -> for each contactEventId in batch:
       require getProcessedEventBySensorEventId(eventId) !== undefined
  -> if all present: ackWriter.writeAck(ackPath)
  -> else: log "batch not ready" + DO NOT ack
```

Additional rules:

- Parse/validation failure: persist failure record with status `failed` + error code; **do not ack** batch containing unprocessed ids.
- Duplicate idempotencyKey: may retry prompt; still counts as processed for batch ack.
- Onboarding paused: record `ignored` so batch can complete without creating candidate.

### Raw event persistence

Extend `ProcessedSensorEvent` or add `sensor_event_log` table:

```ts
{
  sensorEventId: string;
  eventType: string;
  normalizedPayloadRef?: string;  // redacted JSON hash or truncated shape
  validationStatus: "ok" | "normalized" | "failed";
  errorCode?: string;
  processedAt: string;
}
```

Redaction: same rules as `runtimeTrace.ts` — no raw methods.

## Swift parity (non-blocking note)

Document in sensor runtime spec addendum: Swift emitter should omit empty labels when possible. TS normalization remains authoritative for dogfooding older binaries.

## Testing strategy

Unit:

- `sensorEvents.test.ts` — empty label, whitespace label, missing label.
- `normalizeSensorEvent.test.ts` — hint cleanup tables.

Integration:

- `friendyRuntime.test.ts` — batch ack waits until all contact events processed.
- `friendyRuntimeCheck.test.ts` — replay unacked batch without duplicate prompt.
- `macosSensorFixtureCheck.ts` — fixture with empty label line passes.

Commands:

```bash
npm test -- src/relationship/runtime/sensorEvents.test.ts
npm test -- src/relationship/runtime/friendyRuntime.test.ts
npm run agent:friendy:check
npm run check:mac-mvp-e2e-state
```

## Observability

Log lines (deterministic prefixes):

- `sensor_event_normalized label=unknown eventId=…`
- `sensor_event_validation_failed code=… eventId=…`
- `history_batch_ack_written batchId=…`
- `history_batch_ack_deferred batchId=… missing=[…]`

## Boundaries

- **Always:** normalize before Zod; no ack without durable processed records for all batch members.
- **Ask first:** schema version bump (`MACOS_SENSOR_SCHEMA_VERSION`).
- **Never:** store raw phone/email in SQLite audit rows.

## Success criteria

- [ ] Empty-string hint labels no longer invalidate `contact_added` events.
- [ ] Normalization helper covered by tests; used in `parseSensorEventLine`.
- [ ] Ack deferred until all batch contact events have processed records.
- [ ] Failed validation persists auditable failure without acking incomplete batch.
- [ ] `npm run agent:friendy:check` passes with fixture containing empty labels.

## Dependencies

- `docs/superpowers/specs/2026-05-21-local-macos-sensor-runtime-design.md`
- `docs/superpowers/specs/2026-05-21-durable-runtime-store-design.md`
- `src/relationship/runtime/friendyRuntime.ts`
- `src/relationship/runtime/sensorEvents.ts`
