# Bi-Directional Apple Contacts Integration

## Baseline

- Date: 2026-05-24
- Goal source: `docs/goals/apple-contacts-bidirectional-integration-goal.md`.
- Branch: `main`.
- Starting state: worktree already had unrelated onboarding/API and docs edits before this goal slice (`.env.example`, `REFERENCE.md`, `docs/agent-handoff.md`, `implementation-notes.html`, `package.json`, `src/relationship/sqliteRepository.ts`, plus untracked onboarding API files). Apple Contacts work must avoid reverting them and stage only goal-relevant files.
- Initial code state: Swift sensor has `SensorCLI.swift`, `NativeMacosSensor.swift`, `PermissionPrompt.swift`, and source-contract tests, but no JSON stdin Contacts actuator. TypeScript relationship tools expose Friendy memory and candidate tools only; Apple contact management intents are still unsupported route-policy blockers.
- Process: subagent-driven development started with two read-only explorer agents, one for Swift actuator placement and one for TypeScript routing/workflow surfaces. Behavior changes will use RED/GREEN TDD slices.

## Swift Actuator RED

- Date: 2026-05-24
- Added a source-contract test requiring `MacContactsActuator.swift`, a `--contacts-actuator-stdin` CLI path, native `Contacts` APIs, `CNSaveRequest`, all four actions, permission prompting, and no AppleScript/`osascript`.
- RED run: `npm test -- src/relationship/runtime/macosSensorSource.test.ts` failed because `swift/FriendyMacOSSensor/Sources/FriendyMacOSSensor/MacContactsActuator.swift` does not exist.

## Swift Actuator GREEN

- Date: 2026-05-24
- Added `MacContactsActuator.swift` with a `--contacts-actuator-stdin` CLI mode that reads one JSON command from stdin, requests Contacts permission, performs `READ`, `CREATE`, `UPDATE`, or `DELETE` with native `CNContactStore` / `CNSaveRequest`, emits one JSON result, and exits.
- Focused green run: `npm test -- src/relationship/runtime/macosSensorSource.test.ts` passed with 9 tests.
- Native build check: `npm run build:macos-sensor` passed and signed both `bin/friendy-macos-sensor` and `bin/Friendy macOS Sensor.app`.

# Friendy List People Tool

## GREEN

- Date: 2026-05-23
- Goal source: `docs/superpowers/specs/2026-05-23-friendy-list-people-tool-design.md`.
- Added a deterministic `list_people` tool and routed `intent: list_people` through it instead of `search_memories`.
- Live model routing is strict by default after this pass; fallback is not used unless a test/local fixture explicitly disables strict mode with `FRIENDY_STRICT_MODE=0`.
- Focused checks:
  - `npm test -- src/relationship/tools.test.ts`
  - `npm test -- src/relationship/responseComposer.test.ts`
  - `npm test -- src/relationship/interpretedAgent.test.ts`
  - `npm test -- src/relationship/strictMode.test.ts src/relationship/openAIInterpreter.test.ts src/relationship/transports/spectrumTransport.test.ts`
  - `npm test -- src/relationship/evals/agentEvalRunner.test.ts` remains RED only at the aggregate zero-failure assertion because four frozen non-list cases still fail.
- Eval status after this PR: `npm run eval:agent` reports 37/41 expected, with four non-list regression-freeze cases still RED.

# Friendy Regression Freeze Tests

## RED

- Date: 2026-05-23
- Goal source: `docs/superpowers/specs/2026-05-23-friendy-regression-freeze-design.md`.
- Added tests-only eval cases for filtered bullet list routing, duplicate audit, conversation repair, fuzzy delete confirmation, and same-name pending contact disambiguation.
- Focused command: `npm test -- src/relationship/evals/agentEvalRunner.test.ts`.
- Eval command: `npm run eval:agent`.
- Observed status: 36/41 eval cases pass. The five new regression-freeze cases fail for the expected behavior gaps.
- Expected status: RED until follow-up implementation adds explicit list/filter routing, duplicate audit tooling, state repair routing, fuzzy delete confirmation, and same-name pending contact disambiguation.

# Strict Mode and Trace Envelope Experiments

## Baseline / RED

- Date: 2026-05-23
- Goal source: `docs/goals/strict-mode-trace-envelope-goal.md`.
- Added RED tests for strict-mode env parsing, result trace presence, redacted trace fields, interpreter metadata, strict interpreter failures, unknown/unsupported routes, missing tools, ambiguous executable delete, runtime env wiring, and eval fallback reporting.
- Initial RED failures showed the expected gaps: no `strictMode.ts`, no `FriendyTrace` on results, no route/fallback metadata from the interpreter, fallback returning normally in strict mode, raw `TypeError` for missing tools, ambiguous delete returning a clarification, runtime env not wired, and eval summaries missing fallback counts.

## Focused GREEN

- Date: 2026-05-23
- Added `src/relationship/strictMode.ts` and `src/relationship/trace.ts`.
- Threaded `FriendyTrace` through interpreted-agent return values, persisted interaction JSON, and redacted runtime trace output.
- Added OpenAI interpreter metadata and strict-mode fail-fast errors for missing API key, model failure, invalid schema, and fallback use.
- Added route policy validation for unknown routes, unsupported contact-management routes, missing tools, and ambiguous executable memory mutation targets.
- Wired `FRIENDY_STRICT_MODE` into foreground runtime config and Spectrum runtime.
- Added eval fallback usage counting plus a strict-mode fallback-rejection eval case.
- Focused green runs:
  - `npm test -- src/relationship/strictMode.test.ts`
  - `npm test -- src/relationship/interpretedAgent.test.ts src/relationship/runtime/runtimeTrace.test.ts src/relationship/strictMode.test.ts`
  - `npm test -- src/relationship/openAIInterpreter.test.ts src/relationship/interpretedAgent.test.ts`
  - `npm test -- src/relationship/runtime/friendyRuntimeCli.test.ts src/relationship/transports/spectrumTransport.test.ts src/relationship/interpretedAgent.test.ts`
  - `npm test -- src/relationship/evals/agentEvalRunner.test.ts`

## Full Verification

- Date: 2026-05-23
- `npm test`: passed with 52 files and 340 tests.
- `npm run build`: passed.
- `npm run eval:agent`: passed 36/36 required cases with 0 unsafe mutations, 0 hallucinations, and `Fallback usage count: 31`.
- `git diff --check`: passed.

# State-Aware Relationship Agent Routing Experiments

## Baseline / RED

- Date: 2026-05-23
- Goal source: `docs/goals/state-aware-relationship-agent-routing-goal.md`.
- Added transcript tests to `src/relationship/interpretedAgent.test.ts`.
- RED run: `npm test -- src/relationship/interpretedAgent.test.ts` failed in six expected places:
  - `She is a community lead...` returned the previous-search fallback with no tools;
  - `Sarah Fan is a community lead...` saved the dirty note `Sarah Fan is a...`;
  - active pending inquiry with a prompted Sarah Fan still returned multi-candidate ambiguity;
  - list-all while a contact was pending did not remind about the open prompt;
  - `Who did I met at the Photon Residency?` listed all people;
  - `add Sarah Chen as the member...` called no tools.

## Focused GREEN

- Date: 2026-05-23
- Added `conversationState.ts` to reconstruct active pending-contact frames from durable candidate prompt fields.
- Moved active pending-contact inquiry/context ahead of previous-search follow-up handling.
- Added note cleanup for pronoun/name copula facts before candidate confirmation.
- Added deterministic manual add-as memory creation, event-recall detection, state-aware route trace fields, and eval cases.
- Focused green runs:
  - `npm test -- src/relationship/interpretedAgent.test.ts`
  - `npm test -- src/relationship/candidateIntake.test.ts src/relationship/responseComposer.test.ts`
  - `npm test -- src/relationship/scopeBoundary.test.ts src/relationship/openAIInterpreter.test.ts src/relationship/tools.test.ts`
  - `npm test -- src/relationship/evals/agentEvalRunner.test.ts src/relationship/runtime/runtimeTrace.test.ts src/relationship/__tests__/behaviorContract.test.ts`
  - `npm run build`

## Full Verification

- Date: 2026-05-23
- `npm test`: passed with 51 files and 322 tests.
- `npm run build`: passed.
- `npm run eval:agent`: passed 35/35 required cases with 0 unsafe mutations and 0 hallucinations.
- `git diff --check`: passed.

# Mac-Only MVP Final Goal Experiments

## Option B E2E Contact Detection Follow-Up Baseline

- Date: 2026-05-22
- Branch: `main`
- Goal source: `docs/goals/mac-mvp-e2e-contact-detection-goal.md`.
- Starting state: local `main` fast-forwarded from `c7d1008` to `39973a1`; worktree clean before edits.
- Audit result: app-bundle launch, `fullAccess` schema, pre-start ignore/ack, startup message, open-prompt scope routing, and Swift add/update queue were present after fast-forward.
- Remaining source-level gap: a real Mac add could be silent while the Swift sensor waits for `isReadyForFriendyPrompt`; the app-bundle event log had no parseable diagnostic event for queued/not-ready contacts.

## Option B E2E Contact Detection Red Tests

- Date: 2026-05-22
- Added `contact_pending` expectations to `src/relationship/runtime/sensorEvents.test.ts`, `src/relationship/runtime/friendyRuntime.test.ts`, and `src/relationship/runtime/macosSensorSource.test.ts`.
- Red run: `npm test -- src/relationship/runtime/sensorEvents.test.ts src/relationship/runtime/friendyRuntime.test.ts src/relationship/runtime/macosSensorSource.test.ts` failed because the TypeScript sensor contract rejected `contact_pending`, runtime logged only the parse error, and Swift had no `contactPendingEvent` builder/emits.
- Existing drift confirmed first: `npm test -- src/relationship/runtime/macosSensorSource.test.ts` failed because the test still expected Calendar access to guard only `authorized`, while the source now correctly accepts `authorized` or `fullAccess`.

## Option B E2E Contact Detection Green Verification

- Date: 2026-05-22
- Added non-PII `contact_pending` events with reasons `history_changes_queued`, `waiting_for_saved_contact`, and `contact_not_found_after_history`.
- Runtime logs `contact_pending` as `macOS sensor contact pending: ...` without creating candidates, prompts, processed events, or acks.
- Swift emits `contact_pending` to the app-bundle event log when history changes queue contact ids and when the debounced re-fetch is still waiting for a saved card. Waiting diagnostics are de-duplicated per internal contact id so a company-only/blank card does not spam every poll.
- Focused green run: `npm test -- src/relationship/runtime/sensorEvents.test.ts src/relationship/runtime/friendyRuntime.test.ts src/relationship/runtime/macosSensorSource.test.ts` passed with 3 files and 29 tests.

## Option B E2E Scope/Runtime Check Regression

- Date: 2026-05-22
- Full `npm test` exposed three regressions already present after the E2E fast-forward: normal recall text was routed as candidate confirmation when a prompt was open, `unsafe-save-guard` wrote memory for `Maya was cool from dinner`, and `agent:friendy:check` reused the same pre-start idempotency key after start.
- Added a focused RED boundary test for `who was the recruiting agents person from Photon dinner?` while a candidate is pending.
- Fix: pending-prompt routing now sends relationship recall questions to search, still sends direct pending inquiries like `Who did I add...` to the candidate inquiry path, and rejects person-comment statements such as `Maya was cool from dinner` instead of confirming them.
- Fix: `agent:friendy:check` now proves pre-start contacts are recorded `ignored`, then uses a net-new post-start mock contact id for candidate creation and replay/ack verification.
- Focused green run: `npm test -- src/relationship/scopeBoundary.test.ts src/relationship/ingestion/ingestionPipeline.test.ts src/relationship/runtime/friendyRuntimeCheck.test.ts src/relationship/evals/agentEvalRunner.test.ts` passed with 4 files and 21 tests.

## Option B E2E Automated Verification

- Date: 2026-05-22
- `npm test`: passed with 48 files and 284 tests.
- `npm run build`: passed.
- `npm run eval:agent`: passed 29/29 required cases with zero unsafe mutations and zero hallucinations.
- `npm run agent:friendy:check`: passed; it proves pre-start contact idempotency is ignored, then a net-new post-start mock contact creates one candidate and acks the replayed batch.
- `npm run check:mac-mvp-demo`: passed.
- `npm run check:macos-sensor-fixture`: skipped successfully on Linux because the checked-in sensor binary is a macOS executable and this host is not macOS.
- `npm run build:macos-sensor`: blocked on this host with `spawnSync swift ENOENT`; rerun on the user's Mac after pulling because Swift changed.
- `git diff --check`: passed.
- Manual real Mac E2E evidence is still required for goal completion: named iMessage prompt 5-15s after Done, confirmation creates a `memories` row, recall returns the person, and the terminal shows a new batch ack.

## Option B Live Mac Partial Evidence

- Date: 2026-05-22
- User log showed the real runtime launching the signed app bundle via `open`: `bin/Friendy macOS Sensor.app`.
- Runtime config reported `sensor.mode=real`, `kind=app_bundle`, and `eventLogPath=.friendy/macos-sensor-state/sensor-events.ndjson`.
- Spectrum startup succeeded: `[friendy:startup_message] sent`.
- Native sensor reached ready state: `macOS sensor ready: baselineCreated=false`.
- A contact event arrived while onboarding was still `ready_pending_user_start`; runtime recorded it as ignored so the history batch could ack, then later processed the user's `start` message as `onboarding_control`.
- Observed ids from the user log: contact event `sensor_evt_contact_33CF7601-71ED-4531-965D-8DF7039CA130`; batch `history_batch_D3857812-1A54-4DB8-B546-9319B6ACC277`; `start` interaction at `2026-05-22T08:54:23.751Z`.
- Result: app-bundle launch, TCC identity, startup iMessage, ready event, and pre-start ignore/ack are live-proven. This does not complete the goal because it does not yet prove a brand-new post-start contact produces a named prompt, confirmation, memory row, and recall.
- Follow-up source adjustment: pre-start contact logs now say the contact was ignored and instruct the operator to text `start`, then add a new contact, instead of incorrectly saying the event was being held.
- Verification after the log adjustment: `npm test -- src/relationship/runtime/friendyRuntime.test.ts` passed with 14 tests; `npm test` passed with 48 files and 284 tests; `npm run build` passed; `npm run eval:agent` passed 29/29 with zero unsafe mutations and zero hallucinations; `npm run agent:friendy:check` passed with the clearer pre-start ignore log; `npm run check:mac-mvp-demo` passed; `git diff --check` passed.

## Option B Silent Post-Start Add Diagnostics

- Date: 2026-05-22
- User log showed startup, app-bundle sensor launch, `macOS sensor ready`, and a processed `start` interaction at `2026-05-22T09:03:04.548Z`, then no log lines after adding a new contact.
- Root-cause boundary: a post-start contact add should now emit at least `contact_pending` before any prompt. Seeing neither `contact_pending` nor `contact_added` means the next evidence needs to distinguish Contacts-history polling returning no changes from app/event-log/runtime delivery failure.
- Added RED tests for a non-PII `sensor_diagnostic` event (`contacts_history_poll_no_changes`) in the TypeScript schema, runtime logging, and Swift source contract. Red run: `npm test -- src/relationship/runtime/sensorEvents.test.ts src/relationship/runtime/friendyRuntime.test.ts src/relationship/runtime/macosSensorSource.test.ts` failed because the schema rejected `sensor_diagnostic`, the runtime logged it as an invalid event, and Swift had no `sensorDiagnosticEvent` builder.
- Green implementation: Swift now emits a throttled `sensor_diagnostic` when a Contacts history poll returns zero touched contacts; runtime logs it as `macOS sensor diagnostic: contacts_history_poll_no_changes pending=0 nextCheckInSeconds=5` without creating candidates, prompts, processed events, or acks.
- Focused green run: `npm test -- src/relationship/runtime/sensorEvents.test.ts src/relationship/runtime/friendyRuntime.test.ts src/relationship/runtime/macosSensorSource.test.ts` passed with 3 files and 31 tests.
- Final verification: `npm test` passed with 48 files and 286 tests, `npm run build` passed, `npm run eval:agent` passed 29/29 with zero unsafe mutations and zero hallucinations, `npm run agent:friendy:check` passed, `npm run check:mac-mvp-demo` passed, and `git diff --check` passed. `npm run build:macos-sensor` still cannot run on this Linux host (`spawnSync swift ENOENT`), so the user must pull and rebuild the app bundle on macOS before the next live run.

## Option B Live Artifact State Checker

- Date: 2026-05-22
- Gap: manual E2E evidence required several pasted commands (`tail`/`rg`/`sqlite3`) and was easy to misread during live debugging.
- Added `npm run check:mac-mvp-e2e-state`, a read-only checker over `.friendy/macos-sensor-state/sensor-events.ndjson`, ack files referenced by `history_batch_complete`, and `.friendy/friendy.sqlite`.
- It passes only when the latest artifacts show a named `contact_added`, a present history-batch ack file, and at least one saved memory. It also prints latest candidates plus `contact_pending` / `sensor_diagnostic` reasons when evidence is incomplete.
- Red run: `npm test -- src/relationship/evals/macMvpE2eStateCheck.test.ts` failed because `macMvpE2eStateCheck` did not exist.
- Green run: `npm test -- src/relationship/evals/macMvpE2eStateCheck.test.ts` passed with 4 tests.
- Final verification: `npm test` passed with 49 files and 290 tests, `npm run build` passed, `npm run eval:agent` passed 29/29 with zero unsafe mutations and zero hallucinations, `npm run agent:friendy:check` passed, `npm run check:mac-mvp-demo` passed, and `git diff --check` passed. Running `npm run check:mac-mvp-e2e-state` on this Linux workspace correctly returned incomplete live evidence because there is no real Mac `contact_added`, ack, or saved memory here.

## Option B Live Artifact State Checker Hardening

- Date: 2026-05-22
- Gap: the first artifact checker required any saved memory, which could have allowed an old memory for a different contact to satisfy the latest post-start contact proof.
- Added a RED regression test where latest `contact_added` is `Testing Eight`, ack is present, but the only saved memory is `Old Memory`. Red run: `npm test -- src/relationship/evals/macMvpE2eStateCheck.test.ts` failed because the checker still returned `ok: true`.
- Green implementation: the checker now requires a saved memory whose display name matches the latest detected contact and prints `Memory for latest contact: present|missing`.
- Focused green run: `npm test -- src/relationship/evals/macMvpE2eStateCheck.test.ts` passed with 5 tests.
- Final verification: `npm test` passed with 49 files and 291 tests, `npm run build` passed, `npm run eval:agent` passed 29/29 with zero unsafe mutations and zero hallucinations, `npm run agent:friendy:check` passed, `npm run check:mac-mvp-demo` passed, and `git diff --check` passed.

## Option B Live Artifact State Checker Linkage Hardening

- Date: 2026-05-22
- Gap: name matching still allowed a false positive if an old saved memory reused the same display name as the latest detected contact.
- Added a RED regression where latest `contact_added` has stable id `stable-testing-eight`, but the only confirmed candidate/memory pair points at `stable-old-contact`. Red run: `npm test -- src/relationship/evals/macMvpE2eStateCheck.test.ts` failed because the checker still returned `ok: true`.
- Green implementation: the checker now requires the latest contact stable id to map to a confirmed candidate, then requires a memory whose `candidateId` matches that candidate. It prints `Confirmed candidate for latest contact: present|missing` and `Memory for latest contact: present|missing`.
- Focused green run: `npm test -- src/relationship/evals/macMvpE2eStateCheck.test.ts` passed with 5 tests.
- Final verification: `npm test` passed with 49 files and 291 tests, `npm run build` passed, `npm run eval:agent` passed 29/29 with zero unsafe mutations and zero hallucinations, `npm run agent:friendy:check` passed, `npm run check:mac-mvp-demo` passed, and `git diff --check` passed.

## Baseline

- Date: 2026-05-22
- Branch: `main`
- Goal source: `docs/goals/mac-mvp-final-goal-runbook.md`.
- Starting state: worktree clean and `main` matched `origin/main`.

## Task 1 Red Test

- Date: 2026-05-22
- File added: `src/relationship/runtime/nodeVersion.test.ts`.
- Red run: `npm test -- src/relationship/runtime/nodeVersion.test.ts` failed because `packageJson.engines?.node` was `undefined` instead of `>=24`.

## Task 1 Green Verification

- Date: 2026-05-22
- Added `engines.node: >=24` to `package.json` and `package-lock.json`.
- Added `.nvmrc` and `.node-version` with `24`.
- Added `.github/workflows/ci.yml` with local MVP checks.
- `npm test -- src/relationship/runtime/nodeVersion.test.ts`: passed with 1 file and 1 test.
- `npm run build`: passed.
- `git diff --check`: passed.

## Task 9 Red Tests

- Date: 2026-05-22
- Added tool tests for bounded memory update and soft delete with revision records.
- Added interpreted-agent tests for natural correction, natural delete, and ambiguous delete clarification.
- Red run: `npm test -- src/relationship/tools.test.ts src/relationship/interpretedAgent.test.ts` failed because `update_memory`, `delete_memory`, and natural update/delete routing do not exist yet.

## Task 9 Green Verification

- Date: 2026-05-22
- Added bounded `update_memory` and `delete_memory` tools that first verify the target memory belongs to the user.
- Added soft-delete support to in-memory and SQLite repositories; deleted memories are hidden from `listMemories` and search but retain append-only revisions.
- Added deterministic interpreted-agent routing for clear correction/delete requests, with ambiguity routed to a clarification instead of mutation.
- `npm test -- src/relationship/tools.test.ts src/relationship/interpretedAgent.test.ts src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts`: passed with 4 files and 73 tests.
- `npm test`: passed with 45 files and 263 tests.
- `npm run build`: passed.
- `npm run eval:agent`: passed 17/17 with zero unsafe mutations.

## Task 2 Red Test

- Date: 2026-05-22
- File added: `src/relationship/runtime/friendyDoctor.test.ts`.
- Red run: `npm test -- src/relationship/runtime/friendyDoctor.test.ts` failed during import analysis because `./friendyDoctor` did not exist.

## Task 2 Green Verification

- Date: 2026-05-22
- Added `src/relationship/runtime/friendyDoctor.ts` with structured checks and human-readable output.
- Added `doctor:friendy` package script and `REFERENCE.md` command entry.
- `npm test -- src/relationship/runtime/friendyDoctor.test.ts`: passed with 1 file and 5 tests.
- `FRIENDY_SENSOR_MOCK=1 FRIENDY_PROMPT_TRANSPORT=console npm run doctor:friendy`: passed and reported mock sensor, writable SQLite path, writable sensor state directory, console prompt transport, and native permission guidance.
- `npm run build`: passed.
- `git diff --check`: passed.

## Task 3 Red Test

- Date: 2026-05-22
- Added lifecycle state expectations to `src/relationship/runtime/friendyRuntimeCli.test.ts`.
- Red run: `npm test -- src/relationship/runtime/friendyRuntimeCli.test.ts` failed because the lifecycle log list was empty and did not contain `[friendy] loading env`.

## Task 3 Green Verification

- Date: 2026-05-22
- Added lifecycle logs for env loading, config resolution, SQLite readiness, prompt transport readiness, sensor launch, and watching state.
- `npm test -- src/relationship/runtime/friendyRuntimeCli.test.ts`: passed with 1 file and 10 tests.
- `npm test -- src/relationship/runtime/friendyRuntimeCheck.test.ts`: passed with 1 file and 2 tests.
- `npm run agent:friendy:check`: passed and still verified replaying an unacked batch without duplicate prompt.
- `npm run build`: passed.
- `git diff --check`: passed.

## Task 4 Red Tests

- Date: 2026-05-22
- Added `src/relationship/__tests__/behaviorContract.test.ts`.
- Added response composer expectation for natural saved-memory wording.
- Red runs: `npm test -- src/relationship/__tests__/behaviorContract.test.ts` failed because `../behaviorContract` did not exist, and `npm test -- src/relationship/responseComposer.test.ts` failed because saved replies still started with `Saved.`.

## Task 4 Green Verification

- Date: 2026-05-22
- Added `docs/agent-behavior-contract.md`, `src/relationship/behaviorContract.ts`, and `src/relationship/evals/behavior-contract-cases.ts`.
- Wired OpenAI system prompt to combine behavior rules with structured-output instructions while keeping the JSON schema unchanged.
- Updated save confirmation copy to the natural `Got it, saved... I'll remember...` pattern.
- `npm test -- src/relationship/__tests__/behaviorContract.test.ts src/relationship/openAIInterpreter.test.ts src/relationship/responseComposer.test.ts`: passed with 3 files and 10 tests.
- `npm run build`: passed.
- `npm run eval:agent`: passed 17/17 with zero unsafe mutations.
- `git diff --check`: passed.

## Task 8 Red Tests

- Date: 2026-05-22
- Added in-memory repository coverage for memory creation revisions, update revisions, and current projection updates.
- Added SQLite repository coverage for persisted revisions across repository instances and search over the latest projection.
- Red run: `npm test -- src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts` failed because `updateMemory` and `listMemoryRevisions` do not exist yet.

## Task 8 Green Verification

- Date: 2026-05-22
- Added `MemoryRevision` and `MemoryRevisionReason` domain types plus `updateMemory` and `listMemoryRevisions` repository methods.
- In-memory and SQLite repositories now append a `created` revision when a memory is first saved.
- Memory updates append a revision with previous/next values, reason, optional user text, and update the current memory projection used by search.
- SQLite now creates `memory_revisions` with an index on `(memory_id, created_at, revision_id)` and writes memory/revision changes in one transaction.
- `npm test -- src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts`: passed with 2 files and 39 tests.
- `npm test`: passed with 45 files and 256 tests.
- `npm run build`: passed.
- `git diff --check`: passed.

## Task 5 Red Tests

- Date: 2026-05-22
- Added weak event prompt routing coverage to `src/relationship/runtime/promptPlanner.test.ts`.
- Added weak event strength coverage to `src/relationship/runtime/calendarScorer.test.ts`.
- Red run: `npm test -- src/relationship/runtime/calendarScorer.test.ts src/relationship/runtime/promptPlanner.test.ts` failed because scored events did not carry `strength` and weak single guesses routed to `none`.

## Task 5 Green Verification

- Date: 2026-05-22
- Added `EventGuessStrength` with `strong`, `weak`, and `none`.
- Calendar scorer now filters out `none` strength and returns strength on surviving scored events.
- Prompt planner now routes weak top guesses as suggestions: `Was this from ..., or somewhere else?`.
- `npm test -- src/relationship/runtime/calendarScorer.test.ts src/relationship/runtime/promptPlanner.test.ts`: passed with 2 files and 11 tests.
- `npm run build`: passed.
- `npm run eval:agent`: passed 17/17 with zero unsafe mutations.
- `git diff --check`: passed.

## Task 6 Red Tests

- Date: 2026-05-22
- Added in-memory and SQLite candidate timing tests for `observedAt`, `contactUpdatedAt`, and `eventMatchAnchorAt`.
- Added runtime assertion that sensor-created candidates preserve observed/update/anchor timestamps.
- Red run: `npm test -- src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts src/relationship/runtime/friendyRuntime.test.ts` failed because event matching ignored `eventMatchAnchorAt` and runtime-created candidates did not set `contactUpdatedAt` or `eventMatchAnchorAt`.

## Task 6 Green Verification

- Date: 2026-05-22
- Added candidate timing fields to `ContactCandidateDetected` and extended candidate status values for future lifecycle states.
- In-memory and SQLite repositories now preserve original `detectedAt` while mapping event guesses through `eventMatchAnchorAt ?? observedAt ?? detectedAt`.
- Runtime-created sensor candidates now set `observedAt`, `contactUpdatedAt`, and `eventMatchAnchorAt`.
- `npm test -- src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts src/relationship/runtime/friendyRuntime.test.ts`: passed with 3 files and 48 tests.
- `npm run build`: passed.
- `npm run eval:agent`: passed 17/17 with zero unsafe mutations.
- `npm run agent:friendy:check`: passed.
- `git diff --check`: passed.

## Task 7 Red Tests

- Date: 2026-05-22
- Added onboarding reducer tests.
- Added response composer control-copy tests.
- Added interpreted-agent routing coverage for start, pause, and resume.
- Added runtime and foreground CLI coverage showing contact events should be held before start/while paused and replayed after activation.
- Red run: focused Task 7 tests failed because onboarding state/control routing did not exist and the sensor runtime still created candidates while gated.

## Task 7 Green Verification

- Date: 2026-05-22
- Added an onboarding state controller shared by chat controls and the foreground sensor runtime.
- `start`, `pause`, and `resume` are handled before interpreter calls and do not create or mutate memories.
- Before user start or while paused, `contact_added` events are held without candidate creation, prompt delivery, processed-event recording, or history-batch ack. Replayed events process normally after activation.
- `agent:friendy:check` now verifies the start gate before exercising restart/replay ack recovery.
- `npm test -- src/relationship/onboardingState.test.ts src/relationship/agentCore.test.ts src/relationship/interpretedAgent.test.ts src/relationship/responseComposer.test.ts src/relationship/runtime/friendyRuntime.test.ts src/relationship/runtime/friendyRuntimeCli.test.ts src/relationship/runtime/friendyRuntimeCheck.test.ts`: passed with 7 files and 67 tests.
- `npm test`: passed with 45 files and 254 tests.
- `npm run build`: passed.
- `npm run agent:friendy:check`: passed and reported the held pre-start event plus replayed unacked batch ack.
- `npm run eval:agent`: passed 17/17 with zero unsafe mutations.
- `git diff --check`: passed.

## Task 10 Red Tests

- Date: 2026-05-22
- Added interpreted-agent coverage for follow-up search narrowing, multiple remaining matches, stale follow-up expiry, active pronoun correction, and ambiguous correction clarification.
- Red run: `npm test -- src/relationship/interpretedAgent.test.ts` failed because the search-context helper boundary was not implemented (`isSearchContextReset` was undefined).

## Task 10 Green Verification

- Date: 2026-05-22
- Added a 15-minute search-context window for ambiguous searches, deterministic follow-up narrowing, stale follow-up clarification, and bounded correction routing through active or unambiguous memory targets.
- Added trajectory eval cases for follow-up narrowing, follow-up expiry, active-memory correction, ambiguous-memory correction, and untargeted correction safety.
- `npm test -- src/relationship/interpretedAgent.test.ts src/relationship/evals/agentEvalRunner.test.ts`: passed with 2 files and 33 tests.
- `npm test`: passed with 45 files and 269 tests.
- `npm run build`: passed.
- `npm run eval:agent`: passed 22/22 with zero unsafe mutations and zero hallucinations.
- `git diff --check`: passed.

## Task 11 Red Tests

- Date: 2026-05-22
- Added runtime trace redaction coverage for names, phone numbers, emails, event titles, notes, raw interpretation fields, and raw provider errors.
- Added integration expectations that interpreted-agent interactions store a redacted trace and Spectrum compact logs expose only a trace summary.
- Red runs: `npm test -- src/relationship/runtime/runtimeTrace.test.ts` failed because `runtimeTrace.ts` did not exist, then the focused integration suite failed because interactions/logs did not carry trace data.

## Task 11 Green Verification

- Date: 2026-05-22
- Added `buildRedactedInteractionTrace`, stored redacted trace JSON on every interpreted interaction, and exposed compact trace counts/booleans through Spectrum logs.
- `npm test -- src/relationship/runtime/runtimeTrace.test.ts src/relationship/interpretedAgent.test.ts src/relationship/transports/spectrumTransport.test.ts`: passed with 3 files and 35 tests.
- `npm test`: passed with 46 files and 270 tests.
- `npm run build`: passed.
- `npm run eval:agent`: passed 22/22 with zero unsafe mutations and zero hallucinations.
- `npm run agent:friendy:check`: passed.
- `git diff --check`: passed.

## Task 12 Red Tests

- Date: 2026-05-22
- Added eval-runner expectations for seven additional Mac MVP behavior evals: natural save wording, calendar-missing prompt copy, weak event guess copy, no unsafe save on candidate detection, multi-candidate bare-yes ambiguity, delete-from-search behavior, and setup failure copy.
- Added `macMvpDemoCheck` tests for the canonical phone-verified, start, contact prompt, save, recall, and update transcript plus the `check:mac-mvp-demo` package script.
- Red run: `npm test -- src/relationship/evals/agentEvalRunner.test.ts src/relationship/evals/macMvpDemoCheck.test.ts` failed because the eval catalog still had 22 cases and `macMvpDemoCheck.ts` did not exist.

## Task 12 Green Verification

- Date: 2026-05-22
- Expanded `npm run eval:agent` to 29 required deterministic cases covering safe save, natural saved-memory wording, ambiguity, follow-up narrowing/expiry, update/delete safety, setup failure copy, privacy scope, and no unsafe save.
- Added `npm run check:mac-mvp-demo`, a deterministic local demo check that runs the fixture phone-verified/start/contact-prompt/save/recall/update loop through the repository, tools, and interpreted agent.
- `npm test -- src/relationship/evals/agentEvalRunner.test.ts src/relationship/evals/macMvpDemoCheck.test.ts`: passed with 2 files and 7 tests.
- `npm run eval:agent`: passed 29/29 with zero unsafe mutations and zero hallucinations.
- `npm run check:mac-mvp-demo`: passed and printed the canonical local transcript.
- `npm test`: passed with 47 files and 272 tests.
- `npm run build`: passed.
- `git diff --check`: passed.

## Task 13 Verification

- Date: 2026-05-22
- Updated `README.md` with the canonical Mac MVP runtime commands, `doctor:friendy`, `check:mac-mvp-demo`, trust copy, and current built/not-built boundaries.
- Updated `REFERENCE.md` with the finished spec/plan pointers, canonical runtime/demo commands, and source map entries for the demo check, runtime doctor, and foreground runtime.
- Updated `implementation-notes.html` with the final Mac-only MVP implementation plan summary.
- `npm run build`: passed.
- `git diff --check`: passed.

## Final Mac MVP Runbook Verification

- Date: 2026-05-22
- `npm test`: passed with 47 files and 272 tests.
- `npm run build`: passed.
- `npm run eval:agent`: passed 29/29 with zero unsafe mutations and zero hallucinations.
- `npm run check:imessage-e2e`: passed.
- `npm run ingest:local:check -- --mock`: passed and printed the Friendy-101 prompt without live send.
- `npm run agent:friendy:check`: passed.
- `FRIENDY_SENSOR_MOCK=1 FRIENDY_PROMPT_TRANSPORT=console npm run doctor:friendy`: passed in mock mode with expected Linux native-permission guidance.
- `npm run check:mac-mvp-demo`: passed.
- `npm run check:macos-sensor-fixture`: skipped successfully on Linux without a compiled macOS binary.
- `git diff --check`: passed.
