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
