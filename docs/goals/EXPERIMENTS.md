# LLM Message Interpreter Goal Experiments

## Baseline: Resume Current WIP

- Date: 2026-05-20
- Branch: `feature/llm-message-interpreter`
- Observation: Existing WIP includes `zod` in `package.json`/`package-lock.json` and partially written `src/relationship/interpretation.ts` plus tests.
- Result: Continue from existing WIP instead of restarting.

## Task 1 Red Check: Interpretation Contract

- Date: 2026-05-20
- Command: `npm test -- src/relationship/interpretation.test.ts`
- Prior result: Failed because `src/relationship/interpretation.ts` was missing.
- Follow-up result: Failed once because search query construction duplicated `Residency`.
- Fix: De-duplicated search query parts while preserving order.
- Final result: Passed, 5 tests.

## Task 2 Red/Green: Repository Interaction Logging

- Date: 2026-05-20
- Red command: `npm test -- src/relationship/repository.test.ts`
- Red result: Failed with `repo.addInteraction is not a function`.
- Fix: Extended `AgentInteraction` with interpretation/model/latency/error fields and added `addInteraction` / `listInteractions` to the in-memory repository.
- Green command: `npm test -- src/relationship/repository.test.ts`
- Green result: Passed, 4 tests.

## Task 3 Red/Green: OpenRouter Interpreter

- Date: 2026-05-20
- Red command: `npm test -- src/relationship/openRouterInterpreter.test.ts`
- Red result: Failed because `src/relationship/openRouterInterpreter.ts` was missing.
- Fix: Added OpenRouter structured-output request builder, one invalid-output retry, deterministic fallback interpreter, and OpenRouter env config defaults.
- Green command: `npm test -- src/relationship/openRouterInterpreter.test.ts src/relationship/env.test.ts`
- Green result: Passed, 2 files and 7 tests.
