# Contextual Memory Capture V2 Goal Experiments

## Baseline: Start Current Goal

- Date: 2026-05-20
- Branch: `feature/contextual-memory-capture-v2`
- Observation: `main` was clean and in sync with `origin/main` before branching.
- Goal source: `docs/goals/contextual-memory-capture-v2-goal.md`.
- Result: Use TDD against current interpreted-agent architecture.

## Task 1 Red/Green: Multi-Turn Context And Date Parsing

- Date: 2026-05-20
- Red command: `npm test -- src/relationship/interpretedAgent.test.ts src/relationship/temporalContext.test.ts`
- Red result: Failed because Sarah/Felix were saved as first names only and `src/relationship/temporalContext.ts` was missing.
- Fix: Added `chrono-node`, temporal parsing wrapper, relationship date context storage, full-name capture in the deterministic fallback, UBC/community-lead extraction, and interpreted-agent conversation context carryover.
- Green command: `npm test -- src/relationship/interpretedAgent.test.ts src/relationship/temporalContext.test.ts`
- Green result: Passed, 2 files and 11 tests.
- Adjacent command: `npm test -- src/relationship/openRouterInterpreter.test.ts src/relationship/interpretation.test.ts src/relationship/tools.test.ts`
- Adjacent result: Initially failed because the strict JSON schema test did not include the new `dateContext` field; after updating the contract test, passed, 3 files and 12 tests.

## Task 2 Red/Green: Nullable Date Context Contract

- Date: 2026-05-20
- Red command: `npm test -- src/relationship/interpretation.test.ts`
- Red result: Failed because strict structured model output may return `dateContext: null`, while Zod validation accepted only an object or omitted field.
- Fix: Updated the interpretation schema to accept nullable `dateContext` and transform it to `undefined` for internal code.
- Green command: `npm test -- src/relationship/interpretation.test.ts src/relationship/openRouterInterpreter.test.ts`
- Green result: Passed, 2 files and 11 tests.

## Task 3 Verification: Feature Branch

- Date: 2026-05-20
- Command: `npm test`
- Result: Passed, 16 files and 51 tests.
- Command: `npm run build`
- Initial result: Failed because `MessageInterpretation` now requires a `dateContext` output property after Zod transform, while the rule-based fallback base object omitted it.
- Fix: Added `dateContext: undefined` to the fallback base interpretation.
- Build retry result: Passed.
- Re-run command: `npm test`
- Re-run result: Passed, 16 files and 51 tests.
- Smoke command: `node_modules/.bin/tsx --eval "<Amaya/Sarah Fah/Felix Ng harness>"`
- Smoke result: Saved Amaya, Sarah Fah, and Felix Ng; Felix inherited `Photon Residency II`; event search returned all three; room search returned Felix Ng with Amaya context; community-lead search returned Sarah Fah.
- Command: `git diff --check`
- Result: Passed.
