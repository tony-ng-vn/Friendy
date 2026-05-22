# Goal: Mac MVP Task 12 - Behavior Evals And Demo Check

## Copy/Paste Goal

```text
/goal Read docs/goals/mac-mvp-task-12-behavior-evals-demo-check-goal.md and execute it exactly. Use TDD when changing behavior, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Objective

Execute Task 12 from the final plan until the required Mac MVP behavior evals and deterministic demo check prove the end-to-end local memory loop.

## Why This Matters

The MVP finish line needs repeatable evidence, not a one-off demo transcript.

## Non-Negotiables

- Execute Task 12 only; do not start Task 13.
- Use TDD for new eval cases and demo harness behavior.
- Keep evals deterministic and local by default.
- Do not require live Spectrum, real Contacts, or real Calendar in CI.

## Required Behavior

- Required eval groups cover safe save, natural saved-memory wording, ambiguity, follow-up narrowing, update/delete, setup failure copy, privacy scope, and no unsafe save.
- A deterministic `check:mac-mvp-demo` command exercises the local MVP demo path.
- Failures explain which behavior regressed.

## Test Cases

Cover at least:

- Confirmed candidate saves natural memory wording.
- Ambiguous search asks which person.
- Follow-up clue narrows the previous search.
- Setup failure copy says what is broken, what still works, and what to do next.

## Verification Commands

Run the Task 12 commands from the final plan, including:

```bash
npm run eval:agent
npm run check:mac-mvp-demo
npm run build
git diff --check
```

## Completion Criteria

- Task 12 checklist is complete.
- All verification commands pass.
- Implementation notes record the demo/eval coverage.
- Changes are committed with the Task 12 commit message from the final plan.
- `main` is pushed.
