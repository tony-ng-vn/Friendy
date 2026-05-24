# Goal: Mac MVP Task 6 - Candidate Lifecycle Timing

## Copy/Paste Goal

```text
/goal Read docs/goals/mac-mvp-task-06-candidate-lifecycle-timing-goal.md and execute it exactly. Use TDD when changing behavior, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Objective

Execute Task 6 from the final plan until candidates carry separate timestamps for contact update, observation, event-match anchor, prompt, confirmation, and modification.

## Why This Matters

Friendy should not confuse edited or synced contacts with the time the user actually met someone.

## Non-Negotiables

- Execute Task 6 only; do not start Task 7.
- Use TDD for schema/repository behavior.
- Preserve existing memories and candidates through migration-compatible defaults.
- Do not break in-memory repository parity.

## Required Behavior

- Candidate lifecycle fields are explicit and persisted.
- Event matching uses the correct anchor time.
- Edited old contacts and delayed sync cases do not silently map to the wrong event.

## Test Cases

Cover at least:

- New contact added during an event maps to that event.
- Old contact edited later does not reuse the edit time as meeting time incorrectly.
- Bulk or delayed observation stores `observedAt` separately.

## Verification Commands

Run the Task 6 commands from the final plan, including repository and event-mapping tests, then:

```bash
npm test
npm run build
git diff --check
```

## Completion Criteria

- Task 6 checklist is complete.
- All verification commands pass.
- Implementation notes record the timing semantics.
- Changes are committed with the Task 6 commit message from the final plan.
- `main` is pushed.
