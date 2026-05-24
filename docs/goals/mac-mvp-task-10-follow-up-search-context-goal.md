# Goal: Mac MVP Task 10 - Follow-Up Search Context

## Copy/Paste Goal

```text
/goal Read docs/goals/mac-mvp-task-10-follow-up-search-context-goal.md and execute it exactly. Use TDD when changing behavior, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Objective

Execute Task 10 from the final plan until follow-up clues narrow the previous search within a 15-minute context window and corrections route safely.

## Why This Matters

Human recall is conversational. "The one who played piano" should refine the last ambiguous result, not start an unrelated search.

## Non-Negotiables

- Execute Task 10 only; do not start Task 11.
- Use TDD for narrowing, expiry, and correction routing.
- Expire search context after the plan's TTL or a clear context reset.
- If still ambiguous, ask one more clarifying question.

## Required Behavior

- Follow-up clues narrow prior search results.
- Confident narrowed results return the likely person, why matched, and contact route when available.
- Multiple remaining matches return top options and ask which one.
- Stale or unrelated follow-ups do not reuse old search context.

## Test Cases

Cover at least:

- "Who was the recruiting founder from dinner?" then "the one who played piano" returns Maya.
- Multiple matches after a follow-up ask a clarifying question.
- A follow-up after 15 minutes starts fresh or asks for context.

## Verification Commands

Run the Task 10 commands from the final plan, including search/context tests, then:

```bash
npm run eval:agent
npm run build
git diff --check
```

## Completion Criteria

- Task 10 checklist is complete.
- All verification commands pass.
- Implementation notes record follow-up context lifetime.
- Changes are committed with the Task 10 commit message from the final plan.
- `main` is pushed.
