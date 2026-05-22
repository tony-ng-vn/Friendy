# Agent Instructions

## Navigation First

Start by reading `REFERENCE.md` when you need repo context. It is the navigation map for product docs, implementation plans, source modules, commands, and current development focus.

Prefer adding or updating scoped `AGENTS.md` files when a subdirectory needs durable local context. Keep those files short, specific, and navigational; do not duplicate full specs or long implementation plans inside them.

When changing agent-navigation structure, follow `docs/agent-navigation.md`. The default pattern is one repo map plus small scoped rules, not a large always-loaded instruction file.

## Session Handoff

When resuming work or handing off to a new agent, read `docs/agent-handoff.md` after `REFERENCE.md`. That file holds current status, the active goal, and blockers.

When you finish meaningful work or close a goal, update `docs/agent-handoff.md`, the active goal file under `docs/goals/`, and `implementation-notes.html`. See `docs/agent-handoff.md` for the required update rule.

## Implementation Notes

When implementing a spec, keep a running `implementation-notes.html` file, or a Markdown equivalent if HTML is impractical.

Use it to record decisions that were not in the spec, things that had to change, tradeoffs that had to be made, and anything else the user should know. Do not use it as the only handoff doc — pair it with `docs/agent-handoff.md`.

## Commits

Commit implementation work incrementally with detailed messages.

Use the format `<scope>:<message>`, for example `feat:add relationship memory agent search` or `test:add candidate confirmation coverage`.

## Destructive Commands

Do not run destructive commands without explicit user approval, including `rm -rf`, `git reset --hard`, `git clean -fdx`, force pushes, deleting branches, dropping databases, broad `chmod` or `chown`, or deleting user files.

## Code Comments

Use comments sparingly and only when they make the code easier to understand.

Prefer simple, useful comments that explain intent, constraints, or non-obvious tradeoffs. Do not add comments that merely restate what the next line of code already says.

For TypeScript modules, add concise JSDoc to exported functions, types, and classes when it helps another agent or engineer understand the purpose, boundary, or design decision behind the API.
