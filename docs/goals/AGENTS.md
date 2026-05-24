# Goal Docs Agent Instructions

Goal files should be optimized for long-running agents that need a measurable finish line.

- Read `docs/goals/goal-writing-guide.md` before creating or editing any goal file.
- Put long `/goal` prompts in markdown files here and use the slash command only to point at the file.
- Keep completion criteria explicit and checkable.
- Keep active goal tracking in:
  - `docs/goals/PLAN.md`
  - `docs/goals/EXPERIMENTS.md`
  - `docs/goals/EXPERIMENT_NOTES.md`
- Do not store secrets or provider keys in goal docs.
- If a goal changes architecture, require updates to `implementation-notes.html` and `REFERENCE.md`.
- When a goal completes or materially advances, update `docs/agent-handoff.md` (current status, blockers, last E2E evidence) per `docs/agent-handoff.md`.
