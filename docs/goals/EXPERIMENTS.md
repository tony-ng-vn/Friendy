# Mac-Only MVP Final Goal Experiments

## Baseline

- Date: 2026-05-22
- Branch: `main`
- Goal source: `docs/goals/mac-mvp-final-goal-runbook.md`.
- Starting state: worktree clean and `main` matched `origin/main`.

## Task 1 Red Test

- Date: 2026-05-22
- File added: `src/relationship/runtime/nodeVersion.test.ts`.
- Red run: `npm test -- src/relationship/runtime/nodeVersion.test.ts` failed because `packageJson.engines?.node` was `undefined` instead of `>=24`.

## Task 1 Green Verification

- Date: 2026-05-22
- Added `engines.node: >=24` to `package.json` and `package-lock.json`.
- Added `.nvmrc` and `.node-version` with `24`.
- Added `.github/workflows/ci.yml` with local MVP checks.
- `npm test -- src/relationship/runtime/nodeVersion.test.ts`: passed with 1 file and 1 test.
- `npm run build`: passed.
- `git diff --check`: passed.
