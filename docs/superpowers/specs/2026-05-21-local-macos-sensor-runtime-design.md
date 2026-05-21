# Friendy macOS Sensor And Runtime Design

## Summary

Friendy needs a one-command local runtime that feels like the relationship agent is simply running: the user starts Friendy, adds a new contact, Friendy notices the contact, maps it to likely calendar context, texts the user for consent, and saves the relationship memory only after the user confirms.

The implementation should keep the product brain in TypeScript and use a small standalone Swift binary only as a macOS sensor. The Swift sensor owns Contacts and Calendar permissions, listens for native contact change events, and emits newline-delimited JSON. The Node runtime owns persistence, calendar scoring, candidate creation, Spectrum/iMessage prompting, warning state, and agent behavior.

## Goals

- Add a foreground one-command runtime: `npm run agent:friendy`.
- Use a compiled standalone Swift binary for macOS Contacts and Calendar access.
- Use event-driven Contacts change detection through Apple's Contacts framework instead of polling.
- Keep existing Spectrum/iMessage agent behavior available while the sensor runs.
- Use SQLite by default for this runtime so sensor-created candidates and iMessage replies share state.
- Detect newly added contacts without reading or importing existing contacts on first launch.
- Query Calendar only after a contact-add event, then deterministically filter noisy calendar results.
- Send single-event, numbered disambiguation, or no-event prompts through Spectrum.
- Keep sensor failures non-fatal so manual iMessage memory capture and search still work.

## Non-Goals

- Do not build a menu bar app.
- Do not install a LaunchAgent or auto-start on login.
- Do not implement full identity deduplication or manual memory update semantics.
- Do not add LinkedIn, X, Instagram, or other social sensors.
- Do not put scoring, prompting, persistence, LLM calls, or Spectrum sending in Swift.
- Do not create memories directly from sensor events without user confirmation.
- Do not treat old Contacts as candidates on first launch or token reset.
- Do not bypass the candidate lifecycle when saving memories. Explicit user-authored iMessage saves remain allowed, but they should create a synthetic `manual_imessage` candidate and then confirm it in the same repository transaction.

## Current Product Gap

Friendy can currently run the Spectrum/iMessage agent and the local Contacts/Calendar checker as separate commands. The durable SQLite store lets those commands share state when configured, but the user still has to manually run the checker.

The next MVP step is not a production background daemon. It is a foreground local runtime:

```bash
npm run agent:friendy
```

While that command is running, Friendy should listen for new macOS contact events, map them to calendar context, and ask the user over iMessage before saving anything.

## Sensor Event Contract

The Swift binary communicates strictly through stdout using newline-delimited JSON. Node parses each line as one isolated sensor event. stdout must contain only JSON event lines. Human-readable diagnostic text should go to stderr.

### Common Fields

Every sensor event must include these fields:

```json
{
  "schemaVersion": 1,
  "eventId": "sensor_evt_01HX...",
  "type": "ready",
  "sensorName": "macos_contacts_calendar",
  "sensorVersion": "0.1.0",
  "runId": "sensor_run_01HX...",
  "deviceId": "mac_01HX...",
  "emittedAt": "2026-05-21T18:36:51Z"
}
```

`contact_added` events must also include an `idempotencyKey` so Node can safely ignore duplicate sensor output after process restarts or repeated Contacts notifications.

### `ready`

Emitted once when the sensor starts successfully and has verified permissions.

```json
{
  "schemaVersion": 1,
  "eventId": "sensor_evt_ready_01HX...",
  "type": "ready",
  "sensorName": "macos_contacts_calendar",
  "sensorVersion": "0.1.0",
  "runId": "sensor_run_01HX...",
  "deviceId": "mac_01HX...",
  "emittedAt": "2026-05-21T18:36:51Z",
  "baselineCreated": true
}
```

`baselineCreated` is `true` when no previous contact history token existed and the sensor saved a new baseline without emitting contact candidates.

### `contact_added`

Emitted when a new contact is detected. `calendarMatches` contains up to five raw overlapping EventKit events. The `stableId` must be preserved by Node as `contact_identifier` so people with the same display name remain distinct. Node still creates its own Friendy candidate id for the observation.

```json
{
  "schemaVersion": 1,
  "eventId": "sensor_evt_contact_01HX...",
  "type": "contact_added",
  "sensorName": "macos_contacts_calendar",
  "sensorVersion": "0.1.0",
  "runId": "sensor_run_01HX...",
  "deviceId": "mac_01HX...",
  "emittedAt": "2026-05-21T18:36:51Z",
  "observedAt": "2026-05-21T18:36:50Z",
  "idempotencyKey": "contacts:mac_01HX:ABCD-1234-EFGH-5678:add",
  "detectedAt": "2026-05-21T11:36:51-07:00",
  "contact": {
    "stableId": "ABCD-1234-EFGH-5678",
    "unifiedStableId": "ABCD-1234-EFGH-5678",
    "containerId": "icloud_container",
    "displayName": "Maya",
    "phoneNumbers": ["+15551234567"],
    "emails": []
  },
  "calendarMatches": [
    {
      "eventIdentifier": "event_123",
      "calendarIdentifier": "calendar_456",
      "title": "Photon Residency Dinner",
      "startsAt": "2026-05-21T18:00:00-07:00",
      "endsAt": "2026-05-21T21:00:00-07:00",
      "location": "San Francisco",
      "calendarSource": "apple_calendar",
      "calendarTitle": "Work",
      "isAllDay": false,
      "attendeeCount": 12,
      "availability": "busy",
      "status": "confirmed",
      "isRecurring": false
    }
  ]
}
```

### `history_reset`

Emitted if the saved contact history token expires or becomes invalid.

```json
{
  "schemaVersion": 1,
  "eventId": "sensor_evt_reset_01HX...",
  "type": "history_reset",
  "sensorName": "macos_contacts_calendar",
  "sensorVersion": "0.1.0",
  "runId": "sensor_run_01HX...",
  "deviceId": "mac_01HX...",
  "emittedAt": "2026-05-21T18:36:51Z",
  "reason": "expired_token",
  "detectedAt": "2026-05-21T11:36:51-07:00"
}
```

Node must log this event, create no candidate, and send no iMessage. Quietly losing a rare detection window is preferable to asking about an entire address book.

### `permission_error`

Emitted during startup if the OS denies Contacts or Calendar access. The binary exits immediately after sending this.

```json
{
  "schemaVersion": 1,
  "eventId": "sensor_evt_permission_01HX...",
  "type": "permission_error",
  "sensorName": "macos_contacts_calendar",
  "sensorVersion": "0.1.0",
  "runId": "sensor_run_01HX...",
  "deviceId": "mac_01HX...",
  "emittedAt": "2026-05-21T18:36:51Z",
  "code": "contacts_permission_denied",
  "message": "Contacts permission denied by user.",
  "retryable": true
}
```

### `fatal_error`

Emitted for unexpected sensor failures. The binary exits immediately after sending this.

```json
{
  "schemaVersion": 1,
  "eventId": "sensor_evt_fatal_01HX...",
  "type": "fatal_error",
  "sensorName": "macos_contacts_calendar",
  "sensorVersion": "0.1.0",
  "runId": "sensor_run_01HX...",
  "deviceId": "mac_01HX...",
  "emittedAt": "2026-05-21T18:36:51Z",
  "code": "internal_crash",
  "message": "Failed to read token from disk.",
  "retryable": false
}
```

## Node Orchestrator

Add a TypeScript entry point for `npm run agent:friendy`.

### Boot Sequence

1. Load `.env.local` and environment variables.
2. Default `FRIENDY_RUNTIME_STORE` to `sqlite` if it is unset.
3. Default `FRIENDY_SQLITE_PATH` to `.friendy/friendy.sqlite` if it is unset.
4. Resolve the owner identity from `FRIENDY_LOCAL_USER_ID` or `FRIENDY_OWNER_PHONE`.
5. Initialize the SQLite runtime repository and schema, including runtime warning and processed-sensor-event state.
6. Start the Spectrum/iMessage runtime.
7. If `FRIENDY_SENSOR_MOCK=1`, spawn the fake NDJSON sensor.
8. Otherwise verify `./bin/friendy-macos-sensor` exists.
9. Spawn the sensor binary with an explicit state argument:

```bash
./bin/friendy-macos-sensor --state-dir .friendy/macos-sensor-state
```

The state directory should be configurable from Node through `FRIENDY_MACOS_SENSOR_STATE_DIR`, defaulting to `.friendy/macos-sensor-state`.

### Event Loop

Node reads sensor stdout, splits by newline, and parses each line as JSON.

- On `ready`: log startup success.
- On `history_reset`: log reset, create no candidates, send no iMessage.
- On `contact_added`: validate schema, check `idempotencyKey`, score calendar matches, create a pending candidate, persist candidate event matches, record the processed sensor event, and send a Spectrum/iMessage prompt.
- On `permission_error` or `fatal_error`: log the error, warn the owner once if appropriate, keep Spectrum running.
- On malformed JSON: log and ignore the line. Do not crash the runtime.
- On sensor process exit: log exit. Keep Spectrum running.

### Warning State

Sensor failures are non-fatal, but the user should not receive repeated setup warnings on every restart. Use the `runtime_warnings` table keyed by `user_id`, `sensor_name`, and `warning_code`; do not use ephemeral process memory for warning suppression.

If a duplicate `contact_added` event arrives with an already processed `idempotencyKey`, Node should log it and create no candidate or prompt.

If a permission or fatal sensor error occurs, Node upserts the relevant warning row. If it is a new actionable warning, or if the warning cooldown has elapsed, Node texts the owner:

```text
Friendy is running, but I need Contacts/Calendar permission before I can notice new contacts.
```

Then it records `last_notified_at` and increments `notification_count`. Spectrum stays alive so manual memory capture and search continue to work.

### SQLite Concurrency

`agent:friendy` is one Node process, but current development can still run the local checker and Spectrum runtime as separate processes against the same SQLite file. The SQLite repository must therefore be configured for safe local multi-process access.

WAL, busy timeout, foreign keys, and short transactions are mandatory acceptance criteria for the SQLite runtime store, not optional tuning. When opening SQLite, use both the Node connection timeout and explicit pragmas:

```ts
import { DatabaseSync } from 'node:sqlite';

export function openRuntimeDatabase(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath, {
    timeout: 5000,
    enableForeignKeyConstraints: true
  });

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
  `);

  applySchema(db);
  return db;
}
```

The schema initializer must verify these settings in tests. `synchronous = NORMAL` is the MVP durability tradeoff for local app state; switch to `FULL` later only if crash durability proves more important than local latency.

Keep transactions short. Do not silently fall back to in-memory state in live runtime commands. Treat lock contention as retryable at the repository boundary where possible, and keep the iMessage message path free of long-running database operations.

### Live Runtime Store Rules

If `FRIENDY_RUNTIME_STORE=sqlite`, any database open, schema, or migration failure is fatal for that process. Silent fallback would make the checker and iMessage runtime look healthy while writing to different stores.

If `FRIENDY_RUNTIME_STORE` is unset:

- tests and fixtures may use memory;
- `npm run agent:friendy` defaults to SQLite;
- any live Spectrum/iMessage runtime that would use memory must require `FRIENDY_ALLOW_MEMORY_RUNTIME=1`;
- a local checker running in memory mode must warn that its results will not be visible to the live runtime.

## Durable Store Schema

The durable store exists to enforce product invariants, not just to retain objects. The database should reject impossible state even if a TypeScript call path has a bug.

### Migrations

Add a minimal migration ledger before adding tables:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

The first migration should be `1_initial_runtime_store`. `CREATE TABLE IF NOT EXISTS` is acceptable inside the first migration, but future schema changes must be explicit migrations instead of silent table drift.

### Users

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  phone_number TEXT,
  timezone TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Agent Interactions

```sql
CREATE TABLE IF NOT EXISTS agent_interactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  space_id TEXT,
  inbound_text TEXT,
  interpretation_json TEXT,
  tool_calls_json TEXT,
  outbound_text TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interactions_user_created
ON agent_interactions(user_id, created_at);
```

### Sensor State

```sql
CREATE TABLE IF NOT EXISTS sensor_state (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sensor_name TEXT NOT NULL,
  device_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  history_token_blob BLOB,
  baseline_completed_at TEXT,
  last_success_at TEXT,
  last_error_code TEXT,
  last_permission_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, sensor_name, device_id)
);
```

The Swift binary owns the on-disk Contacts token while the current MVP runs as a standalone sensor, but the SQLite store still needs this table so Node can record sensor health, permission state, baseline status, and future packaging transitions without inventing a second state path.

### Runtime Warnings

```sql
CREATE TABLE IF NOT EXISTS runtime_warnings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sensor_name TEXT NOT NULL,
  warning_code TEXT NOT NULL,
  permission_status TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_notified_at TEXT,
  suppressed_until TEXT,
  acknowledged_at TEXT,
  notification_count INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  PRIMARY KEY (user_id, sensor_name, warning_code)
);
```

Permission and sensor failures update durable warning state. They may notify the owner on a new actionable state or after a cooldown, but repeated checker restarts must not send repeated setup texts.

### Processed Sensor Events

```sql
CREATE TABLE IF NOT EXISTS processed_sensor_events (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  sensor_event_id TEXT,
  sensor_name TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);
```

Node records a sensor event in this table in the same transaction that creates the candidate. Replayed `contact_added` events must not create another candidate or another prompt.

### Contact Candidates

```sql
CREATE TABLE IF NOT EXISTS contact_candidates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sensor_event_id TEXT,
  contact_identifier TEXT,
  unified_contact_identifier TEXT,
  container_identifier TEXT,
  contact_fingerprint TEXT,
  display_name_snapshot TEXT NOT NULL,
  contact_methods_json TEXT,
  detected_at TEXT NOT NULL,
  observed_at TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'prompted', 'confirmed', 'ignored', 'expired', 'error')
  ),
  status_reason TEXT,
  prompt_interaction_id TEXT REFERENCES agent_interactions(id),
  confirmed_interaction_id TEXT REFERENCES agent_interactions(id),
  ignored_interaction_id TEXT REFERENCES agent_interactions(id),
  prompted_at TEXT,
  confirmed_at TEXT,
  ignored_at TEXT,
  expires_at TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, sensor_event_id),
  UNIQUE(user_id, contact_identifier, detected_at)
);

CREATE INDEX IF NOT EXISTS idx_candidates_pending
ON contact_candidates(user_id, status, detected_at);
```

`display_name_snapshot` is presentation only. Candidate identity must come from `sensor_event_id`, contact identifiers, contact fingerprint, and source metadata. For manual iMessage saves, create a candidate with `source = 'manual_imessage'`, no sensor event id, and a contact fingerprint derived from the parsed name/context when available.

### Candidate Event Matches

```sql
CREATE TABLE IF NOT EXISTS candidate_event_matches (
  candidate_id TEXT NOT NULL REFERENCES contact_candidates(id) ON DELETE CASCADE,
  event_id TEXT,
  rank INTEGER NOT NULL,
  confidence INTEGER NOT NULL,
  reason TEXT NOT NULL,
  event_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, rank)
);
```

Store event snapshots, not only EventKit identifiers. Calendar identifiers can change or become stale; the memory should preserve the event context that was actually shown to the user.

### Relationship Memories

```sql
CREATE TABLE IF NOT EXISTS relationship_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL UNIQUE REFERENCES contact_candidates(id),
  contact_identifier TEXT,
  unified_contact_identifier TEXT,
  display_name_snapshot TEXT NOT NULL,
  event_id TEXT,
  event_title TEXT,
  event_snapshot_json TEXT,
  context_note TEXT,
  relationship_context TEXT,
  contact_method_json TEXT,
  tags_json TEXT,
  detected_at TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  confirmed_by_interaction_id TEXT NOT NULL REFERENCES agent_interactions(id),
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_user_confirmed
ON relationship_memories(user_id, confirmed_at);

CREATE INDEX IF NOT EXISTS idx_memories_display_name
ON relationship_memories(user_id, display_name_snapshot);
```

No repository method should insert a relationship memory without a candidate row. This applies to both sensor-detected contacts and explicit manual iMessage saves.

## Candidate Pipeline

The automated sensor flow must preserve same-name contacts as separate candidates.

1. Swift emits `contact_added` with a `stableId`.
2. Node passes raw calendar matches through the deterministic calendar scorer.
3. Node creates one pending candidate with a Friendy candidate id and preserves `stableId` as `contact_identifier`. A contact identifier and a candidate identifier are not the same thing: one contact may generate multiple observations over time, and one observation may or may not become a memory.
4. Node persists the candidate and zero or more `candidate_event_matches`.
5. Node sends exactly one iMessage prompt:
   - no event prompt;
   - single event confirmation prompt;
   - numbered disambiguation prompt.
6. User replies in iMessage.
7. Existing candidate-intake logic confirms, ignores, or asks for clarification.
8. A confirmed sensor candidate becomes a relationship memory linked to that candidate.

If two contacts named "Maya" are added, Apple provides different contact identifiers, Swift emits two events, Node creates two candidates, and later search can return both memories. Manual update and entity deduplication are deferred.

Confirmation must be a state transition, not a blind insert. `confirmCandidate` should only create a relationship memory when the candidate belongs to the user and is still `pending` or `prompted`. Ignored, expired, already-confirmed, or missing candidates must not create another memory.

Manual user-authored saves use the same invariant: create a `manual_imessage` candidate, then confirm it in the same transaction. They do not bypass the candidate table.

## Repository Invariants

The repository interface is the mutation boundary for relationship memory state. Required methods and invariants:

```text
createCandidate(input)
  - idempotent by user_id + sensor_event_id when present
  - creates candidate_event_matches in the same transaction when provided
  - records processed_sensor_events in the same transaction when idempotencyKey is present
  - never creates a memory

listPendingCandidates(userId)
  - returns only pending and prompted candidates
  - ordered by detected_at

markCandidatePrompted(candidateId, interactionId)
  - only pending -> prompted
  - records prompt_interaction_id and prompted_at

ignoreCandidate(candidateId, interactionId)
  - only pending/prompted -> ignored
  - records ignored_interaction_id and ignored_at
  - never deletes the row

confirmCandidate(candidateId, confirmation)
  - only pending/prompted -> confirmed
  - creates exactly one relationship memory in the same transaction
  - fails without creating a memory if candidate is ignored, expired, confirmed, missing, or scoped to another user

createAndConfirmManualMemory(input)
  - creates a manual_imessage candidate
  - confirms it through the same transaction path as confirmCandidate
  - creates exactly one relationship memory

searchMemories(userId, query)
  - searches relationship_memories only
  - never returns pending, ignored, expired, or error candidates
```

`confirmCandidate` should use a single transaction. The transaction first updates `contact_candidates` from `pending` or `prompted` to `confirmed` with the confirmation interaction id; only if exactly one row is returned should it insert into `relationship_memories`. If any insert fails, the candidate status update must roll back.

## Prompt Behavior

### No Event

```text
I noticed you added Maya. Where did you meet them?
```

### Single Strong Event

```text
I noticed you added Maya during Photon Residency Dinner. Did you meet them there?
```

### Multiple Plausible Events

Use vertical numbered options with at most three event choices:

```text
I noticed you added Maya. Was this from:
1. Photon Residency Dinner
2. Founders Meetup

Or somewhere else?
```

The parser should support replies such as `1`, `first`, `the dinner one`, event-name fragments, and free-text "somewhere else" answers. If the reply does not clearly map to an option or manual context, ask one clarification.

## Calendar Context Scorer

The Swift sensor returns raw EventKit matches. TypeScript owns all product judgment through a deterministic scorer.

### Input

- `detectedAt`
- up to five raw `calendarMatches`

### Output

- ranked event options, capped at three for prompting
- prompt route: `none`, `single`, or `disambiguate`

### Hard Discards

Drop an event if any apply:

- title is missing;
- event is cancelled or declined when EventKit exposes that state;
- event title is private or unavailable and there is no location or attendee signal;
- title contains only generic availability: `busy`, `hold`, `blocked`, `ooo`;
- calendar source or title includes noise categories: `holidays`, `birthday`, `birthdays`, `weather`, `sports`;
- event is all-day or duration is greater than 24 hours, unless the title contains strong event terms.

### Positive Weights

Start at 0.

- `+40`: event time overlaps `detectedAt`.
- `+25`: title contains strong event terms: `dinner`, `lunch`, `coffee`, `meetup`, `hackathon`, `residency`, `conference`, `summit`, `presentation day`, `party`, `social`, `founders`, `workshop`, `offsite`.
- `+15`: location exists.
- `+10`: `attendeeCount > 1`.
- `+10`: duration is between 30 minutes and 6 hours.
- `+8`: event ended within the last 2 hours.
- `+5`: event starts within the next 1 hour.

### Negative Weights

- `-35`: title contains logistics terms: `commute`, `flight`, `travel`, `uber`, `lyft`, `train`, `bus`, `gym`, `doctor`, `dentist`, `laundry`, `errand`.
- `-25`: title contains work-block terms: `focus`, `deep work`, `heads down`, `work block`.
- `-15`: location is empty and `attendeeCount` is 0.
- `-20`: duration is greater than 8 hours.
- `-30`: event is all-day.

### Routing

- Drop scores under 35.
- Sort descending.
- Collapse obvious duplicate calendar results before prompt routing.
- Keep at most three prompt options.
- If top event is at least 60 and the gap to the second event is greater than 15, send single-event prompt.
- If two or three events score at least 45, send numbered disambiguation.
- If no events remain, send no-event prompt.

## Swift Sensor Implementation

The Swift binary is a local macOS sensor only. It must not call Spectrum, LLMs, SQLite, or Friendy memory tools.

### Responsibilities

Swift owns:

- Contacts permission check;
- Calendar permission check;
- Contacts history token state;
- `CNContactStoreDidChange` subscription;
- `CNChangeHistoryFetchRequest` delta fetching;
- EventKit query after contact-add events;
- NDJSON stdout emission.

Swift does not own:

- calendar scoring;
- prompt wording;
- candidate persistence;
- iMessage sending;
- memory saving;
- deduplication or entity resolution.

### CLI

```bash
./bin/friendy-macos-sensor --state-dir .friendy/macos-sensor-state
```

Requirements:

- `--state-dir` is required.
- Create the state directory if missing.
- Store the Contacts history token inside it.
- Keep stdout machine-readable with one JSON event per line.
- Send human diagnostic text to stderr only.

### Startup

1. Parse `--state-dir`.
2. Check Contacts authorization and request access if the status is undetermined.
3. Check Calendar authorization and request read access if the status is undetermined.
4. If either permission is denied, restricted, or still unavailable after the request, emit `permission_error` and exit non-zero.
5. Initialize `CNContactStore` and `EKEventStore`.
6. If no history token exists:
   - save `CNContactStore.currentHistoryToken`;
   - emit `ready` with `baselineCreated: true`;
   - emit no contact adds.
7. If token exists:
   - load it;
   - emit `ready` with `baselineCreated: false`.
8. Subscribe to `CNContactStoreDidChange`.
9. Keep process alive with a run loop.

### On Contact Change

1. Create `CNChangeHistoryFetchRequest` from the saved token.
2. Fetch change events.
3. For each `CNChangeHistoryAddContactEvent`, extract:
   - stable contact identifier;
   - unified contact identifier when available;
   - container identifier when available;
   - display name;
   - normalized phone numbers;
   - emails;
   - detectedAt timestamp.
4. Query EventKit from `detectedAt - 4h` to `detectedAt + 1h`.
5. Sort EventKit results deterministically, then map up to five raw calendar events into the sensor event schema.
6. Default `attendeeCount` to 0 if EventKit returns nil or hidden attendees.
7. Map `calendarTitle` from `EKCalendar.title`.
8. Map `calendarSource` from `EKCalendar.source.title`.
9. Emit `contact_added` NDJSON.
10. Save the latest Contacts history token.

### Token Failure

If change history fails because the token is expired or invalid:

- overwrite saved token with `currentHistoryToken`;
- emit `history_reset`;
- create no `contact_added` events;
- keep running if possible.

If Contacts reports a drop-everything or reset-style history response, treat it the same way: overwrite the saved token, emit `history_reset`, create no contact events, and keep the user quiet.

### Contact Fetching Notes

The sensor should treat change-history events as identifier-first. If the change-history event does not include all contact fields needed for the event contract, Swift should refetch only the needed keys for the changed contact, including display name, phone numbers, email addresses, identifier, unified identifier if available, and container identifier if available. It must not perform a full address-book import.

The Swift package should include an Info.plist or documented packaging requirements for Contacts and Calendar usage descriptions. Local CLI behavior can be tested first, but the spec must not assume `swift run` or an unsigned ad hoc execution shape will represent final macOS TCC behavior.

## Build And Scripts

Add Swift package source under:

```text
swift/FriendyMacOSSensor/
```

Expected package shape:

```text
swift/FriendyMacOSSensor/Package.swift
swift/FriendyMacOSSensor/Sources/FriendyMacOSSensor/main.swift
```

Add a build script:

```text
npm run build:macos-sensor
```

The script should:

1. run `swift build -c release` in the Swift package directory;
2. create `./bin` if needed;
3. copy the compiled binary to `./bin/friendy-macos-sensor`.

Do not use `swift run` for runtime execution. macOS TCC permissions need a stable standalone binary identity.

Add the foreground runtime script:

```text
npm run agent:friendy
```

## Testing Strategy

Automated tests should not depend on macOS Contacts, Calendar, or TCC permissions.

### TypeScript Tests

Use `FRIENDY_SENSOR_MOCK=1` or an injected fake sensor process to simulate:

- `ready`;
- `contact_added`;
- `history_reset`;
- `permission_error`;
- `fatal_error`;
- malformed JSON;
- sensor process exit.

Required coverage:

- SQLite initializes with WAL enabled;
- SQLite initializes with `busy_timeout > 0`;
- SQLite initializes with foreign keys enabled;
- repository A creates a candidate and repository B lists it from the same SQLite file;
- repository A ignores a candidate and repository B no longer lists it as pending;
- repository A confirms a candidate and repository B can search the resulting memory;
- double confirm creates one memory;
- confirm ignored candidate fails without creating a memory;
- confirm expired candidate fails without creating a memory;
- confirm candidate for the wrong user fails without creating a memory;
- candidate replay with the same sensor event or idempotency key is idempotent;
- relationship memories cannot be inserted without candidates through the public repository API;
- `relationship_memories.candidate_id` is unique;
- orchestrator defaults SQLite env for `agent:friendy`;
- orchestrator spawns mock sensor or real binary path correctly;
- malformed sensor lines do not crash the runtime;
- permission/fatal warnings are texted once using `runtime_warnings`;
- history reset is logged and does not create candidates or send prompts;
- contact added creates a pending candidate while preserving `stableId` as `contact_identifier`;
- duplicate `contact_added` events with the same idempotency key do not create another candidate or prompt;
- confirmation of ignored, already-confirmed, expired, missing, or wrong-user sensor candidates does not create a memory;
- single strong event sends the single-event prompt;
- multiple plausible events send numbered disambiguation;
- no surviving events sends no-event prompt;
- same display-name contacts create separate candidates when `stableId` differs.

At least one cross-connection lock test should open two SQLite connections to the same file, hold a transaction on one connection, and verify the second connection waits within the configured busy timeout or returns a controlled retryable repository error instead of crashing the agent wrapper.

### Swift Build

`npm run build:macos-sensor` should be the local compile check. CI may skip it on non-macOS platforms unless the environment supports Swift and the macOS frameworks.

### Local Manual Test

Manual macOS verification:

1. Build the sensor binary.
2. Start `npm run agent:friendy`.
3. Grant Contacts and Calendar permissions when prompted.
4. On first launch, confirm baseline creation with no candidate prompts.
5. Add a new `Friendy-<number>` contact.
6. Confirm the sensor emits `contact_added`.
7. Confirm Friendy sends the appropriate iMessage prompt.
8. Reply in iMessage.
9. Confirm a relationship memory is saved and searchable.

Local-only edge checks should include permission denied/granted/revoked, same-name contacts, iPhone-to-Mac iCloud sync delay, noisy calendars, token reset, and process restart between prompt and reply.

## Privacy And Safety

- First launch is baseline-only and creates no candidates from existing Contacts.
- Token reset is baseline-only and creates no candidates.
- The Swift sensor reads only the Contacts delta returned by Apple's change-history API after baseline.
- Calendar is queried only after a new-contact event.
- Sensor errors are non-fatal.
- Detected contacts remain pending until the user confirms.
- Multiple calendar matches trigger disambiguation instead of overconfident guessing.
- SQLite and sensor state live under `.friendy/` by default and remain ignored by git.
- `raw_json` stores Friendy domain snapshots, not unfiltered Contacts framework dumps.
- Do not store contact notes, birthdays, postal addresses, organization fields, image data, or other address-book fields unless they become explicit product requirements.
- Phone and email values should be normalized. If a value is only needed for dedupe or disambiguation, store a hash instead of the raw value.

## Open Decisions

Open implementation decisions before merging implementation code:

- exact warning cooldown duration for repeated sensor permission failures;
- exact SQLite migration helper shape after `1_initial_runtime_store`;
- exact contact fingerprint format for manual iMessage candidates;
- whether `synchronous = NORMAL` remains enough after real local crash testing.

Implementation should start with the TypeScript sensor event contract, fake sensor, orchestrator tests, and calendar scorer. The Swift binary and build script should be included in the same implementation phase, with automated tests relying on fake sensor events.
