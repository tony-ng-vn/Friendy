# Mac-Only MVP Final Goal Experiments

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
