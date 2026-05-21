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
- Do not make every relationship memory require a contact candidate. Explicit user-authored iMessage saves remain allowed as manual memories; the strict confirmation boundary applies to sensor-detected contacts.

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

Emitted when a new contact is detected. `calendarMatches` contains up to five raw overlapping EventKit events. The `stableId` must be preserved by Node and used as the primary seed for candidate identity so people with the same display name remain distinct.

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

Sensor failures are non-fatal, but the user should not receive repeated setup warnings on every restart. Add a minimal runtime state key-value capability backed by SQLite, for example:

```text
runtime_state
  key primary key
  value_json
  updated_at
```

Use it for warning flags such as:

```text
sensor_warning.contacts_permission_denied.sent
sensor_warning.calendar_permission_denied.sent
sensor_warning.binary_missing.sent
sensor_warning.fatal_error.sent
```

Also use runtime state, or a dedicated table with the same semantics, for processed sensor events:

```text
processed_sensor_event.<idempotencyKey>
```

If a duplicate `contact_added` event arrives with an already processed idempotency key, Node should log it and create no candidate or prompt.

If a permission or fatal sensor error occurs, Node checks the relevant warning key. If it has not been sent, Node texts the owner:

```text
Friendy is running, but I need Contacts/Calendar permission before I can notice new contacts.
```

Then it sets the warning key. Spectrum stays alive so manual memory capture and search continue to work.

### SQLite Concurrency

`agent:friendy` is one Node process, but current development can still run the local checker and Spectrum runtime as separate processes against the same SQLite file. The SQLite repository must therefore be configured for safe local multi-process access.

When opening SQLite, apply these settings before schema use:

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
```

Keep transactions short. Do not silently fall back to in-memory state in live runtime commands. Treat lock contention as retryable at the repository boundary where possible, and keep the iMessage message path free of long-running database operations.

## Candidate Pipeline

The automated sensor flow must preserve same-name contacts as separate candidates.

1. Swift emits `contact_added` with a `stableId`.
2. Node passes raw calendar matches through the deterministic calendar scorer.
3. Node creates one pending candidate using `stableId` as the primary candidate identity seed. The TypeScript domain should preserve this as a first-class field such as `sourceContactId` or `macosContactStableId`, not only inside `raw_json`.
4. Node persists the candidate and zero or more `candidate_event_matches`.
5. Node sends exactly one iMessage prompt:
   - no event prompt;
   - single event confirmation prompt;
   - numbered disambiguation prompt.
6. User replies in iMessage.
7. Existing candidate-intake logic confirms, ignores, or asks for clarification.
8. A confirmed sensor candidate becomes a relationship memory linked to that candidate.

If two contacts named "Maya" are added, Apple provides different contact identifiers, Swift emits two events, Node creates two candidates, and later search can return both memories. Manual update and entity deduplication are deferred.

For sensor-detected candidates, confirmation must be a state transition, not a blind insert. `confirm_candidate` should only create a relationship memory when the candidate belongs to the user and is still `pending`. Ignored, expired, already-confirmed, or missing candidates must not create another memory. This can be enforced in the repository transaction even though manual user-authored memories continue to use the explicit manual memory path.

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

- orchestrator defaults SQLite env for `agent:friendy`;
- orchestrator spawns mock sensor or real binary path correctly;
- malformed sensor lines do not crash the runtime;
- permission/fatal warnings are texted once using runtime state;
- history reset is logged and does not create candidates or send prompts;
- contact added creates a pending candidate seeded by `stableId`;
- duplicate `contact_added` events with the same idempotency key do not create another candidate or prompt;
- confirmation of ignored, already-confirmed, expired, missing, or wrong-user sensor candidates does not create a memory;
- single strong event sends the single-event prompt;
- multiple plausible events send numbered disambiguation;
- no surviving events sends no-event prompt;
- same display-name contacts create separate candidates when `stableId` differs.

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

## Open Decisions

No product decision remains open for this spec.

Implementation should start with the TypeScript sensor event contract, fake sensor, orchestrator tests, and calendar scorer. The Swift binary and build script should be included in the same implementation phase, with automated tests relying on fake sensor events.
