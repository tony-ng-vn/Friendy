# Friendy Goal Runbook

Use these one at a time. Start the next goal only after the current goal has been implemented, tested, documented, committed, pushed, and marked complete.

## Goal 1: Contextual Memory Capture V2

Status: completed on `main`.

Use this goal to make Friendy understand messy multi-turn relationship memory messages:

- save full names like Sarah Fah and Felix Ng,
- carry event context forward when the user says "also",
- parse natural-language dates with a real parser,
- retrieve all people from a remembered event.

Run with:

```text
/goal Read docs/goals/contextual-memory-capture-v2-goal.md and execute it exactly. Use TDD, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Goal 2: Relationship Agent Response Composer

Status: next recommended goal.

Use this goal to replace robotic database-style replies with grounded, conversational iMessage-style responses:

- no `matched:` text,
- no raw scoring/debug language,
- no `manual contact`,
- friendly save/search/no-match replies,
- optional bounded LLM wording layer that cannot retrieve, write memory, or invent facts.

Run with:

```text
/goal Read docs/goals/relationship-agent-response-composer-goal.md and execute it exactly. Use TDD, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Goal 3: Contact Event Verification Queue MVP

Status: run after the response composer, unless contact detection becomes urgent.

Use this goal to build the core product loop:

```text
new contact detected
-> map to likely calendar event
-> add to verification queue
-> ask user to confirm/add context
-> save searchable relationship memory
-> later search retrieves the person
```

This is the highest product-value goal, but it should come after the response composer if the live iMessage product flow is still awkward.

Run with:

```text
/goal Read docs/goals/contact-event-verification-queue-goal.md and execute it exactly. Use TDD, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```
