# Goal: Mac MVP Task 11 - Redacted Runtime Traces

## Copy/Paste Goal

```text
/goal Read docs/goals/mac-mvp-task-11-redacted-runtime-traces-goal.md and execute it exactly. Use TDD when changing behavior, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Objective

Execute Task 11 from the final plan until Friendy records local, redacted runtime traces for major agent and runtime decisions.

## Why This Matters

Operators need observability, but Friendy must not leak names, phone numbers, emails, event titles, notes, raw interpreted JSON, or raw errors by default.

## Non-Negotiables

- Execute Task 11 only; do not start Task 12.
- Use TDD for trace redaction.
- Do not add LangChain, LangSmith, or Langfuse in this task.
- Store only redacted shapes by default.

## Required Behavior

- Trace records include event kind, counts, booleans, decision kind, tool name, and result shape.
- Private text fields are omitted, hashed, or replaced with safe markers according to the plan.
- Raw model/provider errors do not leak private prompt/input content.

## Test Cases

Cover at least:

- Names and phone numbers do not appear in trace output.
- Event titles and notes do not appear in trace output.
- Raw interpreted JSON does not appear in trace output.
- Error messages are represented as `present` or equivalent safe shape.

## Verification Commands

Run the Task 11 commands from the final plan, including trace tests, then:

```bash
npm run agent:friendy:check
npm run build
git diff --check
```

## Completion Criteria

- Task 11 checklist is complete.
- All verification commands pass.
- Implementation notes record the redaction contract.
- Changes are committed with the Task 11 commit message from the final plan.
- `main` is pushed.
