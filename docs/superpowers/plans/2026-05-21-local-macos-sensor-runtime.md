# Local macOS Sensor Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foreground `npm run agent:friendy` runtime that keeps Spectrum/iMessage running while a standalone macOS sensor emits contact/calendar NDJSON into the Friendy candidate pipeline.

**Architecture:** TypeScript remains the product brain: it validates sensor events, scores calendar context, plans prompts, persists candidates/warnings/idempotency, and sends iMessage prompts. Swift is a narrow local sensor binary: Contacts/EventKit permissions, Contacts change-history deltas, Calendar snapshots, durable outbox, and NDJSON stdout only.

**Tech Stack:** TypeScript, Vitest, Zod, Node child process streams, Node `node:sqlite`, Spectrum/iMessage transport, Swift Package Manager, Contacts.framework, EventKit.

---

## Current Code Map

- `src/relationship/types.ts`: shared domain data. Needs extra candidate statuses and optional sensor identity fields.
- `src/relationship/repository.ts`: in-memory repository. Needs state-gated confirmation and manual-save candidate lifecycle later.
- `src/relationship/sqliteRepository.ts`: SQLite repository. Needs WAL/busy timeout/FKs, migration ledger, runtime-warning and processed-event persistence, and stronger candidate/memory invariants.
- `src/relationship/runtimeRepository.ts`: runtime repository factory. Needs live default rules for `agent:friendy`.
- `src/relationship/transports/spectrumTransport.ts`: importable Spectrum runtime already exists. `agent:friendy` should reuse it, not spawn `agent:spectrum`.
- `src/relationship/ingestion/localCheck.ts`: old explicit checker path. Useful for prompt/candidate behavior, but the new runtime should process NDJSON sensor events directly.

## New Files

- `src/relationship/runtime/sensorEvents.ts`: Zod schemas, `parseSensorEventLine`, and TypeScript event types for `ready`, `contact_added`, `history_batch_complete`, `history_reset`, `permission_error`, and `fatal_error`.
- `src/relationship/runtime/calendarScorer.ts`: deterministic scorer for raw sensor calendar matches.
- `src/relationship/runtime/promptPlanner.ts`: deterministic no-event/single-event/disambiguation prompt plans.
- `src/relationship/runtime/sensorProcess.ts`: child-process/fake-sensor stream reader and line splitter.
- `src/relationship/runtime/runtimeWarnings.ts`: warning cooldown decision helper.
- `src/relationship/runtime/friendyRuntime.ts`: orchestrator that processes parsed sensor events with an injected repository, prompt sender, and ack writer.
- `src/relationship/runtime/friendyRuntimeCli.ts`: `npm run agent:friendy` entrypoint.
- `src/relationship/runtime/fakeMacosSensor.ts`: mock NDJSON sensor used by tests and `FRIENDY_SENSOR_MOCK=1`.
- `src/relationship/runtime/macosSensorDoctor.ts`: `npm run doctor:macos-sensor` diagnostics.
- `swift/FriendyMacOSSensor/Package.swift`: Swift package.
- `swift/FriendyMacOSSensor/Sources/FriendyMacOSSensor/main.swift`: standalone sensor binary.

---

## Task 1: Sensor Event Contract

**Files:**
- Create: `src/relationship/runtime/sensorEvents.ts`
- Create: `src/relationship/runtime/sensorEvents.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests that verify:

```ts
import { describe, expect, it } from "vitest";
import { parseSensorEventLine } from "./sensorEvents";

describe("macOS sensor event contract", () => {
  it("parses a contact_added event with redacted contact methods and calendar query metadata", () => {
    const event = parseSensorEventLine(JSON.stringify({
      schemaVersion: 1,
      eventId: "sensor_evt_contact_1",
      type: "contact_added",
      sensorName: "macos_contacts_calendar",
      sensorVersion: "0.1.0",
      runId: "sensor_run_1",
      deviceId: "mac_1",
      emittedAt: "2026-05-21T18:36:51Z",
      observedAt: "2026-05-21T18:36:50Z",
      idempotencyKey: "contacts:mac_1:ABCD:add",
      historyBatchId: "history_batch_1",
      historyBatchIndex: 0,
      historyBatchSize: 1,
      historyTokenBeforeRef: "outbox:history_batch_1:before",
      historyTokenAfterRef: "outbox:history_batch_1:after",
      detectedAt: "2026-05-21T11:36:51-07:00",
      contact: {
        stableId: "ABCD",
        unifiedStableId: "ABCD",
        containerId: "icloud",
        displayName: "Maya",
        phoneNumberHashes: ["sha256:phone"],
        phoneNumberHints: [{ last4: "4567", label: "mobile" }],
        emailHashes: ["sha256:email"],
        emailHints: [{ domain: "example.com", label: "work" }]
      },
      calendarQuery: {
        startsAt: "2026-05-21T07:36:51-07:00",
        endsAt: "2026-05-21T12:36:51-07:00",
        resultCountBeforeLimit: 1,
        permissionStatus: "authorized"
      },
      calendarMatches: [{
        eventIdentifier: "event_1",
        calendarIdentifier: "calendar_1",
        title: "Photon Residency Dinner",
        startsAt: "2026-05-21T10:00:00-07:00",
        endsAt: "2026-05-21T12:00:00-07:00",
        location: "San Francisco",
        calendarSource: "iCloud",
        calendarTitle: "Work",
        isAllDay: false,
        attendeeCount: 12,
        availability: "busy",
        status: "confirmed",
        isRecurring: false
      }]
    }));

    expect(event.type).toBe("contact_added");
    if (event.type === "contact_added") {
      expect(event.contact.stableId).toBe("ABCD");
      expect(event.contact.phoneNumberHints[0].last4).toBe("4567");
      expect(JSON.stringify(event)).not.toContain("+1555");
    }
  });

  it("rejects raw phone numbers and malformed JSON", () => {
    expect(() => parseSensorEventLine("{bad json")).toThrow(/Malformed sensor JSON/);
    expect(() => parseSensorEventLine(JSON.stringify({
      schemaVersion: 1,
      eventId: "sensor_evt_contact_1",
      type: "contact_added",
      sensorName: "macos_contacts_calendar",
      sensorVersion: "0.1.0",
      runId: "sensor_run_1",
      deviceId: "mac_1",
      emittedAt: "2026-05-21T18:36:51Z",
      observedAt: "2026-05-21T18:36:50Z",
      idempotencyKey: "contacts:mac_1:ABCD:add",
      historyBatchId: "history_batch_1",
      historyBatchIndex: 0,
      historyBatchSize: 1,
      historyTokenBeforeRef: "before",
      historyTokenAfterRef: "after",
      detectedAt: "2026-05-21T11:36:51-07:00",
      contact: {
        stableId: "ABCD",
        displayName: "Maya",
        phoneNumbers: ["+15551234567"],
        phoneNumberHashes: [],
        phoneNumberHints: [],
        emailHashes: [],
        emailHints: []
      },
      calendarQuery: { startsAt: "2026-05-21T07:36:51-07:00", endsAt: "2026-05-21T12:36:51-07:00", resultCountBeforeLimit: 0, permissionStatus: "authorized" },
      calendarMatches: []
    }))).toThrow(/raw contact method/i);
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/runtime/sensorEvents.test.ts
```

Expected: fail because `sensorEvents.ts` does not exist.

- [ ] **Step 3: Implement parser**

Implement `parseSensorEventLine(line: string): MacosSensorEvent` with Zod discriminated unions. Common requirements:

- `schemaVersion` must be `1`.
- `sensorName` must be `macos_contacts_calendar`.
- `contact_added`, `history_reset`, `permission_error`, and `fatal_error` require `idempotencyKey`.
- `contact_added.contact` must not contain `phoneNumbers`, `emails`, or other raw method arrays.
- `calendarMatches` default to `[]`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- src/relationship/runtime/sensorEvents.test.ts
npm run build
```

Expected: tests and TypeScript build pass.

- [ ] **Step 5: Commit**

```bash
git add src/relationship/runtime/sensorEvents.ts src/relationship/runtime/sensorEvents.test.ts
git commit -m "feat:add macos sensor event contract"
```

---

## Task 2: Calendar Scorer And Prompt Planner

**Files:**
- Create: `src/relationship/runtime/calendarScorer.ts`
- Create: `src/relationship/runtime/calendarScorer.test.ts`
- Create: `src/relationship/runtime/promptPlanner.ts`
- Create: `src/relationship/runtime/promptPlanner.test.ts`

- [ ] **Step 1: Write failing scorer tests**

Cover:

- generic one-hour `Read paper` without location/attendees scores below threshold;
- `Photon Residency Dinner` overlapping detection scores high;
- logistics/work blocks are discarded or penalized;
- duplicate events collapse by normalized title + start + end;
- multiple strong events route to disambiguation.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/runtime/calendarScorer.test.ts src/relationship/runtime/promptPlanner.test.ts
```

Expected: fail because modules do not exist.

- [ ] **Step 3: Implement scorer**

Export:

```ts
export type ScoredCalendarEvent = {
  eventId: string;
  title: string;
  score: number;
  rank: number;
  reason: string;
  snapshot: MacosCalendarMatch;
};

export function scoreCalendarContext(input: {
  detectedAt: string;
  calendarMatches: MacosCalendarMatch[];
}): ScoredCalendarEvent[];
```

Use the weights and tie-breakers from the spec. Cap final returned events at three after discards and duplicate collapse.

- [ ] **Step 4: Implement prompt planner**

Export:

```ts
export type CandidatePromptPlan =
  | { route: "none"; text: string }
  | { route: "single"; eventMatchRank: 1; text: string }
  | { route: "disambiguate"; options: Array<{ rank: number; title: string }>; text: string };

export function planCandidatePrompt(input: {
  displayName: string;
  scoredEvents: ScoredCalendarEvent[];
}): CandidatePromptPlan;
```

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/runtime/calendarScorer.test.ts src/relationship/runtime/promptPlanner.test.ts
git add src/relationship/runtime/calendarScorer.ts src/relationship/runtime/calendarScorer.test.ts src/relationship/runtime/promptPlanner.ts src/relationship/runtime/promptPlanner.test.ts
git commit -m "feat:add macos calendar prompt planning"
```

---

## Task 3: Runtime Orchestrator Contract With Fake Sensor

**Files:**
- Create: `src/relationship/runtime/friendyRuntime.ts`
- Create: `src/relationship/runtime/friendyRuntime.test.ts`
- Create: `src/relationship/runtime/sensorProcess.ts`
- Create: `src/relationship/runtime/sensorProcess.test.ts`
- Create: `src/relationship/runtime/fakeMacosSensor.ts`

- [ ] **Step 1: Write failing orchestrator tests**

Cover:

- malformed JSON is logged/ignored and does not throw;
- `history_reset` creates no candidate and sends no prompt;
- `permission_error` sends one warning through injected sender and records warning state;
- `ready` with denied Calendar records a calendar warning but keeps running;
- `contact_added` creates one pending candidate, preserves `stableId` as contact identity in raw candidate data, scores events, sends one prompt, and records the processed idempotency key;
- duplicate `contact_added` with the same `idempotencyKey` creates no second candidate and no second prompt;
- `history_batch_complete` writes ack only after every contact event in the batch reached a persisted outcome.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/runtime/friendyRuntime.test.ts src/relationship/runtime/sensorProcess.test.ts
```

Expected: fail because runtime modules do not exist.

- [ ] **Step 3: Implement minimal runtime interfaces**

Use injected dependencies so tests do not start Spectrum or Swift:

```ts
export type RuntimePromptSender = {
  sendPrompt(input: { userId: string; candidateId?: string; text: string }): Promise<{ interactionId?: string }>;
};

export type RuntimeAckWriter = {
  writeAck(path: string): Promise<void>;
};

export function createFriendySensorRuntime(input: {
  userId: string;
  repo: RelationshipRepository;
  sender: RuntimePromptSender;
  ackWriter: RuntimeAckWriter;
  now?: () => string;
}): {
  processLine(line: string): Promise<void>;
};
```

Persist processed idempotency and warning state through a small runtime-state abstraction first. If the existing repository cannot support the needed persistence yet, use a focused `RuntimeStateStore` interface with in-memory implementation and add the SQLite-backed implementation in Task 4.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/runtime/friendyRuntime.test.ts src/relationship/runtime/sensorProcess.test.ts
git add src/relationship/runtime/friendyRuntime.ts src/relationship/runtime/friendyRuntime.test.ts src/relationship/runtime/sensorProcess.ts src/relationship/runtime/sensorProcess.test.ts src/relationship/runtime/fakeMacosSensor.ts
git commit -m "feat:add friendy sensor runtime orchestrator"
```

---

## Task 4: SQLite Runtime Hardening And State Persistence

**Files:**
- Modify: `src/relationship/sqliteRepository.ts`
- Modify: `src/relationship/sqliteRepository.test.ts`
- Modify: `src/relationship/runtimeRepository.ts`
- Modify: `src/relationship/runtimeRepository.test.ts`

- [ ] **Step 1: Write failing SQLite tests**

Add tests for:

- WAL mode enabled;
- busy timeout greater than zero;
- foreign keys enabled;
- schema migration ledger exists;
- runtime warning state survives across repository instances;
- processed sensor idempotency survives across repository instances;
- double confirm creates one memory;
- confirm ignored/expired/already-confirmed/wrong-user candidate fails without memory;
- manual iMessage save creates a candidate-linked memory.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/sqliteRepository.test.ts src/relationship/runtimeRepository.test.ts
```

Expected: fail on missing pragmas/state tables/invariants.

- [ ] **Step 3: Implement SQLite opener and migrations**

Add an explicit opener inside `sqliteRepository.ts` or `src/relationship/sqlite/openRuntimeDatabase.ts`:

```ts
const db = new DatabaseSync(path, { timeout: 5000, enableForeignKeyConstraints: true });
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous = NORMAL;
`);
```

Add `schema_migrations`, `runtime_warnings`, `processed_sensor_events`, prompt attempts, and candidate identity columns. Preserve compatibility for existing tests by continuing to store `raw_json`.

- [ ] **Step 4: Implement state-gated candidate/memory methods**

Require:

- `listPendingCandidates` returns pending and prompted only.
- `confirmCandidate` only transitions pending/prompted to confirmed and creates one memory in the same transaction.
- ignored/expired/confirmed candidates cannot create another memory.
- manual saves go through synthetic candidate + confirm transaction.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/sqliteRepository.test.ts src/relationship/runtimeRepository.test.ts src/relationship/agentCore.test.ts src/relationship/interpretedAgent.test.ts
git add src/relationship/sqliteRepository.ts src/relationship/sqliteRepository.test.ts src/relationship/runtimeRepository.ts src/relationship/runtimeRepository.test.ts
git commit -m "feat:harden sqlite runtime state"
```

---

## Task 5: `agent:friendy` CLI And Mock Runtime

**Files:**
- Create: `src/relationship/runtime/friendyRuntimeCli.ts`
- Create: `src/relationship/runtime/friendyRuntimeCli.test.ts`
- Modify: `package.json`
- Modify: `src/relationship/transports/spectrumTransport.ts`

- [ ] **Step 1: Write failing CLI tests**

Assert:

- package script `agent:friendy` exists;
- unset runtime env defaults to `FRIENDY_RUNTIME_STORE=sqlite`;
- unset SQLite path defaults to `.friendy/friendy.sqlite`;
- mock sensor path is used when `FRIENDY_SENSOR_MOCK=1`;
- real binary path `./bin/friendy-macos-sensor` is required otherwise;
- sensor failure does not stop the Spectrum runtime starter.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/runtime/friendyRuntimeCli.test.ts
```

Expected: fail because CLI module/script does not exist.

- [ ] **Step 3: Implement CLI composition**

Load env, create SQLite runtime repository, create Spectrum runtime from importable helper, spawn sensor or fake sensor, and pipe stdout into `createFriendySensorRuntime`.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/runtime/friendyRuntimeCli.test.ts src/relationship/transports/spectrumTransport.test.ts
npm run build
git add package.json src/relationship/runtime/friendyRuntimeCli.ts src/relationship/runtime/friendyRuntimeCli.test.ts src/relationship/transports/spectrumTransport.ts
git commit -m "feat:add friendy foreground runtime cli"
```

---

## Task 6: Swift Sensor Package, Build Script, And Doctor

**Files:**
- Create: `swift/FriendyMacOSSensor/Package.swift`
- Create: `swift/FriendyMacOSSensor/Sources/FriendyMacOSSensor/main.swift`
- Create: `scripts/build-macos-sensor.mjs`
- Create: `src/relationship/runtime/macosSensorDoctor.ts`
- Create: `src/relationship/runtime/macosSensorDoctor.test.ts`
- Modify: `package.json`
- Modify: `.gitignore` if `bin/` or generated sensor artifacts are not already ignored.

- [ ] **Step 1: Write failing Node-side tests**

Assert:

- `build:macos-sensor` script exists;
- `doctor:macos-sensor` script exists;
- doctor reports binary path and missing binary clearly on non-macOS;
- build script does not use `swift run`.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/runtime/macosSensorDoctor.test.ts
```

Expected: fail because scripts/modules do not exist.

- [ ] **Step 3: Implement Swift package skeleton**

Implement `main.swift` with:

- argument parsing for required `--state-dir`;
- NDJSON `fatal_error` for invalid args;
- compile-time imports for `Foundation`, `Contacts`, and `EventKit`;
- stdout JSON helper;
- stderr diagnostics helper;
- permission-check scaffolding;
- first-run baseline/outbox functions.

The first pass may compile and emit a controlled `fatal_error` on non-macOS if macOS frameworks are unavailable. On macOS, it should build with `swift build -c release`.

- [ ] **Step 4: Implement build script and doctor**

Build script:

```text
swift build -c release --package-path swift/FriendyMacOSSensor
mkdir -p bin
copy .build/release/friendy-macos-sensor to bin/friendy-macos-sensor
```

Doctor prints binary path, codesign information when available, and clear missing-binary guidance.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/runtime/macosSensorDoctor.test.ts
npm run build
git add package.json scripts/build-macos-sensor.mjs src/relationship/runtime/macosSensorDoctor.ts src/relationship/runtime/macosSensorDoctor.test.ts swift/FriendyMacOSSensor
git commit -m "feat:add macos sensor binary scaffold"
```

On macOS with Swift available, also run:

```bash
npm run build:macos-sensor
npm run doctor:macos-sensor
```

---

## Task 7: Final Verification And Notes

**Files:**
- Modify: `implementation-notes.html`
- Optionally modify: `README.md` if scripts need operator-facing docs.

- [ ] **Step 1: Update implementation notes**

Record:

- Swift owns Contacts token state with durable outbox/Node ack.
- Calendar denial degrades to no-event prompts.
- Node owns scoring, persistence, warning state, and prompt delivery.
- Any deviations from the spec and why.

- [ ] **Step 2: Run final verification**

Run:

```bash
npm test
npm run build
npm run eval:agent
npm run agent:friendy -- --mock
git diff --check
```

If `agent:friendy -- --mock` is intentionally long-running, add a non-daemon check mode first, such as `npm run agent:friendy:check`, and use that for automated verification.

- [ ] **Step 3: Commit and push**

```bash
git add implementation-notes.html README.md package.json src swift scripts docs/superpowers/plans/2026-05-21-local-macos-sensor-runtime.md
git commit -m "docs:record macos sensor runtime implementation"
git push
```

---

## Self-Review

- **Spec coverage:** This plan covers the TypeScript sensor contract, calendar scorer, prompt planner, orchestrator, SQLite state hardening, `agent:friendy`, fake sensor, Swift package, build script, doctor script, automated tests, and local manual verification hooks from the spec.
- **Known phased work:** The first implementation slice should start with Task 1 and Task 2 so sensor events and calendar routing are deterministic before process orchestration. SQLite hardening is intentionally a separate task because it touches existing repository invariants and must be reviewed carefully.
- **Placeholder scan:** No task uses `TBD`, generic "add tests", or "handle edge cases" without naming concrete cases.
- **Type consistency:** `MacosSensorEvent`, `MacosCalendarMatch`, `ScoredCalendarEvent`, and `CandidatePromptPlan` are introduced before use by the orchestrator.
