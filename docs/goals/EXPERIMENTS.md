# Local macOS Contact/Calendar Checker Goal Experiments

## Baseline: Start Current Goal

- Date: 2026-05-20
- Branch: `feature/local-macos-contact-calendar-checker`
- Goal source: Codex active goal context and `docs/goals/local-macos-contact-calendar-checker-goal.md`.
- Baseline command: `npm test`
- Result: Passed with 23 files and 92 tests before local-checker behavior changes.

## RED/GREEN: Local macOS Provider Adapters

- Date: 2026-05-20
- RED command: `npm test -- src/relationship/ingestion/localMacAdapters.test.ts`
- RED result: Failed because `./localMacAdapters` did not exist.
- GREEN command: `npm test -- src/relationship/ingestion/localMacAdapters.test.ts`
- GREEN result: Passed with 1 file and 4 tests after adding parser functions and macOS platform guards.

## RED/GREEN: Local Check Orchestrator

- Date: 2026-05-20
- RED command: `npm test -- src/relationship/ingestion/localCheck.test.ts`
- RED result: Failed because `./localCheck` did not exist.
- GREEN command: `npm test -- src/relationship/ingestion/localCheck.test.ts src/relationship/ingestion/ingestionPipeline.test.ts`
- GREEN result: Passed with 2 files and 9 tests after adding the provider-neutral checker, dry-run prompt output, no-event prompt handling, and mocked live-send guard.
