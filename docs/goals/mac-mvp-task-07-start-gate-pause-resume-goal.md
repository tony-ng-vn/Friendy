# Goal: Mac MVP Task 7 - Start Gate And Pause/Resume

## Copy/Paste Goal

```text
/goal Read docs/goals/mac-mvp-task-07-start-gate-pause-resume-goal.md and execute it exactly. Use TDD when changing behavior, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Objective

Execute Task 7 from the final plan until Friendy has an explicit active-start gate plus pause and resume controls.

## Why This Matters

The demo should start only after user consent, and users need a simple way to pause automation without losing state.

## Non-Negotiables

- Execute Task 7 only; do not start Task 8.
- Use TDD for active, paused, and resumed states.
- Do not process or prompt new candidates while paused.
- Do not delete pending state when paused.

## Required Behavior

- Friendy starts watching only after active state is set.
- `pause` stops new automation calmly.
- `resume` restarts processing without duplicating candidates.
- Setup/runtime copy says what is paused and what still works.

## Test Cases

Cover at least:

- Before start, contact events do not create user-facing prompts.
- While paused, new contact detections are held or skipped according to the plan.
- After resume, safe processing continues without duplicate saves.

## Verification Commands

Run the Task 7 commands from the final plan, including runtime and agent tests, then:

```bash
npm run agent:friendy:check
npm run eval:agent
npm run build
git diff --check
```

## Completion Criteria

- Task 7 checklist is complete.
- All verification commands pass.
- Implementation notes record start/pause/resume semantics.
- Changes are committed with the Task 7 commit message from the final plan.
- `main` is pushed.
