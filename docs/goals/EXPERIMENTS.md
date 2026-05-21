# Docs And Agent Navigation Cleanup Goal Experiments

## Baseline

- Date: 2026-05-21
- Branch: `main`
- Goal source: Codex active goal context and `docs/reviews/current-system-audit.md`.
- Starting state: `docs/reviews/current-system-audit.md` existed as an untracked audit artifact from the previous goal.

## Cleanup Pass

- Date: 2026-05-21
- Files updated: `README.md`, `REFERENCE.md`, `CHANGELOG.md`, `docs/ai-system-architecture.md`, `implementation-notes.html`, `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, `docs/goals/EXPERIMENT_NOTES.md`, `src/relationship/AGENTS.md`, and `src/relationship/ingestion/AGENTS.md`.
- Result: Stale local-checker guidance was corrected, ingestion got scoped instructions, completed goals were relabeled as historical references, architecture docs were marked canonical, the old web shell was relabeled, and implementation notes now start with current state.

## Verification

- Date: 2026-05-21
- `git status --short`: clean before recording verification evidence.
- Changed-file scope: cleanup commit `b4368ae` changed only docs and scoped `AGENTS.md` files.
- `npm test`: passed, 25 files and 101 tests.
- `npm run build`: passed, TypeScript and Vite production build completed.
- `npm run eval:agent`: passed, 12/12 required cases, 100% pass rate, 0 unsafe mutations, 0 hallucinations.
- `npm run check:imessage-e2e`: passed, contact confirmation and later search flow completed.
- `npm run ingest:check`: passed, fixture contacts produced expected pending queue.
- `npm run ingest:local:check -- --mock`: passed, mock `Friendy-101` contact mapped to `Photon Residency Dinner` and dry-run send was skipped.
- `git diff --check`: passed.
- `rg -n "demo|Demo"`: no matches.
