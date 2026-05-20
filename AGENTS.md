# Agent Instructions

## Implementation Notes

When implementing a spec, keep a running `implementation-notes.html` file, or a Markdown equivalent if HTML is impractical.

Use it to record decisions that were not in the spec, things that had to change, tradeoffs that had to be made, and anything else the user should know.

## Commits

Commit implementation work incrementally with detailed messages.

Use the format `<scope>:<message>`, for example `feat:add relationship memory agent search` or `test:add candidate confirmation coverage`.

## Destructive Commands

Do not run destructive commands without explicit user approval, including `rm -rf`, `git reset --hard`, `git clean -fdx`, force pushes, deleting branches, dropping databases, broad `chmod` or `chown`, or deleting user files.

## Code Comments

Use comments sparingly and only when they make the code easier to understand.

Prefer simple, useful comments that explain intent, constraints, or non-obvious tradeoffs. Do not add comments that merely restate what the next line of code already says.
