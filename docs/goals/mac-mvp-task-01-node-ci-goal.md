# Goal: Mac MVP Task 1 - Node Version And CI

## Copy/Paste Goal

```text
/goal Read docs/goals/mac-mvp-task-01-node-ci-goal.md and execute it exactly. Use TDD when changing behavior, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Objective

Execute Task 1 from `docs/superpowers/plans/2026-05-22-mac-only-mvp-final-implementation.md` until the repo pins Node 24 or newer and has safe GitHub Actions CI for the local MVP checks.

## Why This Matters

Friendy depends on Node's built-in `node:sqlite`; the MVP should fail early and clearly on unsupported runtimes.

## Non-Negotiables

- Execute Task 1 only; do not start Task 2.
- Use TDD for the Node version contract.
- Keep `implementation-notes.html` updated.
- Keep active goal tracking files updated.
- Do not commit secrets.
- Do not weaken existing scripts or checks.

## Required Behavior

- `package.json` declares `engines.node` as `>=24`.
- `.nvmrc` and `.node-version` both pin Node 24.
- CI runs install, tests, build, evals, mock local checks, runtime check, sensor fixture skip/pass, and whitespace check.

## Test Cases

Cover at least:

- Missing `engines.node` fails the targeted contract test before implementation.
- The final targeted contract test passes after implementation.
- The CI workflow uses `.nvmrc`.

## Verification Commands

Run the Task 1 commands from the final plan, including:

```bash
npm test -- src/relationship/runtime/nodeVersion.test.ts
npm run build
git diff --check
```

## Completion Criteria

- Task 1 checklist is complete.
- All verification commands pass.
- Docs and implementation notes are updated.
- Changes are committed with `chore:pin node version and add ci checks`.
- `main` is pushed.
