# Goal: Mac MVP Task 3 - Runtime Lifecycle Logs

## Copy/Paste Goal

```text
/goal Read docs/goals/mac-mvp-task-03-runtime-lifecycle-logs-goal.md and execute it exactly. Use TDD when changing behavior, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Objective

Execute Task 3 from the final plan until `agent:friendy` has inspectable lifecycle logs for local runtime startup and readiness.

## Why This Matters

The Mac demo should feel reliable: the operator should know when env loading, SQLite, Spectrum, sensor startup, baseline, and watch mode are ready.

## Non-Negotiables

- Execute Task 3 only; do not start Task 4.
- Use TDD for lifecycle output.
- Keep logs concise and user-safe.
- Do not introduce a heavy logging dependency for this task unless the plan explicitly requires it.

## Required Behavior

- Runtime startup logs stable lifecycle states.
- Failure states remain clear and actionable.
- Existing `agent:friendy:check` still passes.

## Test Cases

Cover at least:

- Runtime check includes lifecycle state lines.
- Startup failures are reported without raw private data.
- Existing replay/idempotency runtime check behavior remains intact.

## Verification Commands

Run the Task 3 commands from the final plan, including:

```bash
npm test -- src/relationship/runtime/friendyRuntimeCheck.test.ts
npm run agent:friendy:check
npm run build
git diff --check
```

## Completion Criteria

- Task 3 checklist is complete.
- All verification commands pass.
- Implementation notes record the lifecycle log contract.
- Changes are committed with the Task 3 commit message from the final plan.
- `main` is pushed.
