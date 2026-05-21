# Candidate Intake Interface Spec Goal Experiments

## Baseline

- Date: 2026-05-21
- Branch: `main`
- Goal source: active Candidate Intake interface-spec goal.
- Starting state: no `CONTEXT.md`; no `src/relationship/candidateIntake.ts`; existing candidate confirmation behavior lives in `agentCore.ts`, `interpretedAgent.ts`, `candidateConfirmation.ts`, tools, and repository.

## Red Spec

- Date: 2026-05-21
- File added: `src/relationship/candidateIntake.test.ts`.
- First focused run: `npm test -- src/relationship/candidateIntake.test.ts` failed during import-analysis because `./candidateIntake` does not exist.
- Adjustment: changed the test helper to use a dynamic module path so Vitest collects the tests before failing at the missing module seam.
- Second focused run: `npm test -- src/relationship/candidateIntake.test.ts` collected five tests and all five failed with `Cannot find module './candidateIntake'`.

## Interface Spec Docs

- Date: 2026-05-21
- File added: `CONTEXT.md`.
- File added: `docs/superpowers/plans/2026-05-21-candidate-intake.md`.
- Result: Friendy domain terms now include Contact Signal, Candidate Intake, Pending Candidate, Review Prompt, Relationship Memory, and Relationship Runtime. The implementation plan keeps durable/shared state, UI, Spectrum behavior changes, and manual memory capture out of scope.

## Verification

- Date: 2026-05-21
- `git status --short`: changed files were docs plus `src/relationship/candidateIntake.test.ts`; no production source files were changed.
- Focused red run: `npm test -- src/relationship/candidateIntake.test.ts` failed with five collected failing tests because `./candidateIntake` does not exist.
- Full suite run: `npm test` reported 25 existing test files passed, 101 existing tests passed, and only `src/relationship/candidateIntake.test.ts` failed with five intentional red tests.
- `git diff --check`: passed.
- `npm run build`: not run because production source/imports were not touched; this goal intentionally adds docs and red tests only.

## Candidate Intake Green Implementation

- Date: 2026-05-21
- Files added/changed: `src/relationship/candidateIntake.ts`, `src/relationship/agentCore.ts`, `src/relationship/interpretedAgent.ts`, and `src/relationship/responseComposer.ts`.
- First focused run after adding the module: `npm test -- src/relationship/candidateIntake.test.ts` passed four tests and failed one context-note assertion because the selected candidate name leaked into the stored note.
- Adjustment: added selector stripping so replies like `yes Maya, recruiting agents founder` store the new context instead of duplicating the candidate selector.
- Result: `npm test -- src/relationship/candidateIntake.test.ts` passed five tests.

## Agent Refactor

- Date: 2026-05-21
- Change: deterministic and interpreted agents now call Candidate Intake for candidate confirmation and ignore behavior.
- Decision: Candidate Intake returns structured outcomes only; `responseComposer` owns no-pending and ambiguity wording.
- Focused run: `npm test -- src/relationship/agentCore.test.ts src/relationship/interpretedAgent.test.ts src/relationship/candidateIntake.test.ts src/relationship/responseComposer.test.ts` passed four files and 31 tests.

## Ingestion Regression

- Date: 2026-05-21
- Full-suite issue: `src/relationship/ingestion/ingestionPipeline.test.ts` failed on the queued-candidate compatibility case.
- Root cause: the new ambiguity rule treated every pending candidate equally, but the fixture flow has one event-matched candidate and one unmatched candidate.
- Adjustment: Candidate Intake now allows bare confirmation when exactly one pending candidate has event guesses. If multiple event-matched candidates are plausible, it still asks the user to choose.
- Focused regression run: `npm test -- src/relationship/candidateIntake.test.ts src/relationship/ingestion/ingestionPipeline.test.ts src/relationship/agentCore.test.ts src/relationship/interpretedAgent.test.ts` passed four files and 33 tests.

## Green Verification

- Date: 2026-05-21
- `npm test`: 26 files passed, 106 tests passed.
- `npm run build`: TypeScript and Vite production build passed.
- `npm run eval:agent`: 12 of 12 required cases passed, 100% pass rate, 0 unsafe mutations, and 0 hallucinations.
- `npm run check:imessage-e2e`: passed the Abc confirmation/search product flow.
- `npm run ingest:check`: passed the fixture contact/calendar ingestion check.
- `npm run ingest:local:check -- --mock`: passed the local checker mock path and printed the dry-run Friendy prompt.
