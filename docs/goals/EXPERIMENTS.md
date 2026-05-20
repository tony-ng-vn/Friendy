# Relationship Agent Eval Harness Goal Experiments

## Baseline: Start Current Goal

- Date: 2026-05-20
- Branch: `feature/relationship-agent-evals`
- Goal source: Codex active goal context and `docs/goals/relationship-agent-evals-goal.md`.
- Baseline command: `npm test`
- Baseline result: Passed, 17 files and 70 tests.
- Result: Use TDD to add a deterministic relationship-agent eval harness, runner tests, required scenario coverage, metrics, and `npm run eval:agent`.

## RED: Eval Harness Contract

- Date: 2026-05-20
- Command: `npm test -- src/relationship/evals/agentEvalRunner.test.ts`
- Expected failure: the eval runner module did not exist, then the stub runner had zero cases and no `eval:agent` npm script.
- Result: Failed for missing module first, then failed on behavior: expected 12 eval cases, 12-case summary, and script exposure.

## GREEN: Deterministic Eval Runner

- Date: 2026-05-20
- Commands:
  - `npm test -- src/relationship/evals/agentEvalRunner.test.ts`
  - `npm run eval:agent`
  - `npm run build`
- Result: Targeted eval tests passed with 5 tests. `npm run eval:agent` passed with 12/12 required cases, 100% pass rate, 100% intent accuracy, 100% memory-write correctness, 100% search recall@3, 0 unsafe mutations, 0 hallucinations, and 100% clarification correctness. Build passed.

## Feature Branch Verification

- Date: 2026-05-20
- Commands:
  - `npm test`
  - `npm run build`
  - `npm run eval:agent`
  - `git diff --check`
- Result: Passed before this verification note was recorded. `npm test` passed with 18 files and 75 tests. `npm run build` completed TypeScript and Vite production build. `npm run eval:agent` passed 12/12 deterministic required cases with all tracked metrics at target. `git diff --check` reported no whitespace errors.
