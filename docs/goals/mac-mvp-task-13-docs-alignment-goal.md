# Goal: Mac MVP Task 13 - Docs Alignment

## Copy/Paste Goal

```text
/goal Read docs/goals/mac-mvp-task-13-docs-alignment-goal.md and execute it exactly. Use TDD when changing behavior, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Objective

Execute Task 13 from the final plan until README, `REFERENCE.md`, implementation notes, and command guidance reflect the finished Mac-only MVP runtime.

## Why This Matters

After implementation, future users and agents need one clear source of truth for running and verifying Friendy.

## Non-Negotiables

- Execute Task 13 only.
- Do not rewrite product scope beyond the finished spec.
- Keep docs concise and navigational.
- Do not claim verification that was not run during this task.

## Required Behavior

- README shows the canonical Mac MVP runtime path.
- `REFERENCE.md` points to the finished spec, final plan, and current commands.
- `implementation-notes.html` records deviations, tradeoffs, and final verification evidence.
- Old superseded docs are not presented as current.

## Test Cases

Cover at least:

- A new agent can find the finished spec and final plan from `REFERENCE.md`.
- A developer can find `npm run doctor:friendy`, `npm run agent:friendy`, and `npm run check:mac-mvp-demo`.
- Implementation notes include current evidence only.

## Verification Commands

Run the Task 13 commands from the final plan, including:

```bash
npm run build
git diff --check
```

## Completion Criteria

- Task 13 checklist is complete.
- All verification commands pass.
- Docs are aligned and committed.
- Changes are committed with the Task 13 commit message from the final plan.
- `main` is pushed.
