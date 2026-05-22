# Goal: Mac MVP Task 8 - Append-Only Memory Revisions

## Copy/Paste Goal

```text
/goal Read docs/goals/mac-mvp-task-08-memory-revisions-goal.md and execute it exactly. Use TDD when changing behavior, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Objective

Execute Task 8 from the final plan until saved relationship memories preserve append-only revisions while keeping a current projection for search.

## Why This Matters

Trust requires explainability. Friendy should be able to show how a memory changed instead of silently overwriting it.

## Non-Negotiables

- Execute Task 8 only; do not start Task 9.
- Use TDD for repository and SQLite revision behavior.
- Keep current search behavior working against the current projection.
- Do not expose raw private details in traces or logs.

## Required Behavior

- Initial saves create an initial memory revision.
- User corrections append a new revision.
- Current memory projection reflects the latest accepted revision.
- Revision metadata records why the change happened.

## Test Cases

Cover at least:

- Confirmed candidate save creates memory plus revision.
- Updating context appends a revision and updates current projection.
- Searching returns the latest current memory.

## Verification Commands

Run the Task 8 commands from the final plan, including repository and SQLite tests, then:

```bash
npm test
npm run build
git diff --check
```

## Completion Criteria

- Task 8 checklist is complete.
- All verification commands pass.
- Implementation notes record the revision model.
- Changes are committed with the Task 8 commit message from the final plan.
- `main` is pushed.
