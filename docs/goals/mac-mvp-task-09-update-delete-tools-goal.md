# Goal: Mac MVP Task 9 - Update And Delete Tools

## Copy/Paste Goal

```text
/goal Read docs/goals/mac-mvp-task-09-update-delete-tools-goal.md and execute it exactly. Use TDD when changing behavior, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Objective

Execute Task 9 from the final plan until Friendy supports bounded update and delete memory operations through deterministic tools.

## Why This Matters

Users need to correct or forget relationship memories before the product adds richer integrations.

## Non-Negotiables

- Execute Task 9 only; do not start Task 10.
- Use TDD for update and delete routing.
- Only deterministic tools may mutate memory.
- Deletions must be explicit and auditable.

## Required Behavior

- Natural corrections update the right saved memory through bounded tool logic.
- Natural delete/forget requests delete or tombstone the right memory.
- Ambiguous update/delete requests ask for clarification rather than guessing.

## Test Cases

Cover at least:

- "Maya actually works on recruiting agents" updates Maya's note.
- "delete Maya memory" removes or tombstones Maya according to the plan.
- "delete the founder" with multiple matches asks which one.

## Verification Commands

Run the Task 9 commands from the final plan, including tool and interpreted-agent tests, then:

```bash
npm run eval:agent
npm run build
git diff --check
```

## Completion Criteria

- Task 9 checklist is complete.
- All verification commands pass.
- Implementation notes record update/delete boundaries.
- Changes are committed with the Task 9 commit message from the final plan.
- `main` is pushed.
