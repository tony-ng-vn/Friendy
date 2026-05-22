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
- Wired OpenRouter system prompt to combine behavior rules with structured-output instructions while keeping the JSON schema unchanged.
- Updated save confirmation copy to the natural `Got it, saved... I'll remember...` pattern.
- `npm test -- src/relationship/__tests__/behaviorContract.test.ts src/relationship/openRouterInterpreter.test.ts src/relationship/responseComposer.test.ts`: passed with 3 files and 10 tests.
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
