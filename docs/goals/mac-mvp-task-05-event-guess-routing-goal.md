# Goal: Mac MVP Task 5 - Event Guess Strength And Prompt Routing

## Copy/Paste Goal

```text
/goal Read docs/goals/mac-mvp-task-05-event-guess-routing-goal.md and execute it exactly. Use TDD when changing behavior, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Objective

Execute Task 5 from the final plan until contact prompts distinguish strong calendar guesses, weak guesses, and no-event contacts.

## Why This Matters

Calendar is only a suggestion. Friendy should ask naturally even when no event exists, and user correction must override the guess.

## Non-Negotiables

- Execute Task 5 only; do not start Task 6.
- Use TDD for event guess strength and prompt copy.
- Never save from contact detection alone.
- Treat user-corrected event/place as source of truth.

## Required Behavior

- Strong event guesses ask with the guessed event.
- Weak guesses are phrased as tentative.
- No-event contacts still produce a safe prompt asking where the user met the person.
- Confirmation with corrected context saves the corrected source-of-truth place.

## Test Cases

Cover at least:

- New contact during a known event prompts with the event name.
- New contact without a nearby event still asks where the user met them.
- User correction beats the calendar guess.

## Verification Commands

Run the Task 5 commands from the final plan, including targeted prompt/candidate tests, then:

```bash
npm run eval:agent
npm run build
git diff --check
```

## Completion Criteria

- Task 5 checklist is complete.
- All verification commands pass.
- Implementation notes record the event-guess rule.
- Changes are committed with the Task 5 commit message from the final plan.
- `main` is pushed.
