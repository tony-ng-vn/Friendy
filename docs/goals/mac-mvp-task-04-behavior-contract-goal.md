# Goal: Mac MVP Task 4 - Behavior Contract

## Copy/Paste Goal

```text
/goal Read docs/goals/mac-mvp-task-04-behavior-contract-goal.md and execute it exactly. Use TDD when changing behavior, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Objective

Execute Task 4 from the final plan until Friendy has a centralized Agent Behavior Contract artifact used by prompts, response wording, deterministic logic, and evals without weakening JSON output constraints.

## Why This Matters

Friendy should behave consistently as a relationship memory agent; some rules are guidance for the model, and some must be enforced in code.

## Non-Negotiables

- Execute Task 4 only; do not start Task 5.
- Preserve existing structured-output and schema instructions.
- Do not trust the model for unsafe writes.
- Keep the contract readable for future agents and developers.

## Required Behavior

- The behavior contract records tone, scope, privacy, save/search ambiguity, source-of-truth, and setup-error rules.
- Interpreter prompts include the contract while preserving JSON reliability.
- Response composer and prompt planner wording align with the contract.

## Test Cases

Cover at least:

- Interpreter system prompt contains behavior rules and structured-output instructions.
- Unrelated messages redirect to relationship-memory scope.
- Saved-memory replies use natural wording rather than command-like fields.

## Verification Commands

Run the Task 4 commands from the final plan, including:

```bash
npm test -- src/relationship/openRouterInterpreter.test.ts src/relationship/responseComposer.test.ts src/relationship/evals/agentEvalRunner.test.ts
npm run eval:agent
npm run build
git diff --check
```

## Completion Criteria

- Task 4 checklist is complete.
- All verification commands pass.
- Contract docs and implementation notes are updated.
- Changes are committed with the Task 4 commit message from the final plan.
- `main` is pushed.
