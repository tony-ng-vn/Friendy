# Goal: Mac MVP Task 2 - Friendy Doctor

## Copy/Paste Goal

```text
/goal Read docs/goals/mac-mvp-task-02-friendy-doctor-goal.md and execute it exactly. Use TDD when changing behavior, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Objective

Execute Task 2 from the final Mac MVP implementation plan until `npm run doctor:friendy` reports structured, stable setup checks for the local runtime.

## Why This Matters

The MVP needs no silent setup failure. A user or operator should see what is broken, what still works, and what to do next.

## Non-Negotiables

- Execute Task 2 only; do not start Task 3.
- Use TDD for doctor behavior.
- Return structured check objects and derive human-readable lines from them.
- Keep mock mode calm and actionable.
- Do not leak secrets or raw credentials in output.

## Required Behavior

- `doctor:friendy` exists in `package.json`.
- The doctor checks Node version, `.env.local` presence, Spectrum/mock transport readiness, writable SQLite path, writable sensor state directory, and macOS sensor availability or mock mode.
- Directory writability checks probe inside directories rather than beside them.
- Output is stable enough for future UI consumption.

## Test Cases

Cover at least:

- Mock runtime configuration reports ready.
- Missing real credentials reports remediation without leaking values.
- Existing sensor binary setup works when `bin/` is created.
- Sensor state directory writability uses a directory probe.

## Verification Commands

Run the Task 2 commands from the final plan, including:

```bash
npm test -- src/relationship/runtime/friendyDoctor.test.ts
npm run doctor:friendy
npm run build
git diff --check
```

## Completion Criteria

- Task 2 checklist is complete.
- All verification commands pass.
- `REFERENCE.md` and implementation notes mention `doctor:friendy`.
- Changes are committed with the Task 2 commit message from the final plan.
- `main` is pushed.
