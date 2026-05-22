# Mac-Only MVP Final Goal Plan

## Option B E2E Contact Detection Follow-Up

- [x] Fast-forward `main` and read `docs/goals/mac-mvp-e2e-contact-detection-goal.md`.
- [x] Audit landed app-bundle launch, start gate, schema, scope routing, and Swift wait-for-saved-name source.
- [x] Reproduce current automated drift: `macosSensorSource.test.ts` failed on the stale Calendar permission guard expectation.
- [x] Add RED tests for non-PII `contact_pending` diagnostics in the sensor event schema, runtime logging, and Swift source contract.
- [x] Implement `contact_pending` parsing/logging and Swift app-bundle event-log emits for queued/waiting contacts.
- [x] Fix pending-prompt routing so real recall questions still search and `agent:friendy:check` uses a net-new post-start contact id.
- [x] Run automated verification commands for the Option B follow-up.
- [x] Commit and push the source-level diagnostic slice.
- [x] Record latest Mac rerun evidence: app-bundle launch and pre-start contact ignore/ack worked; post-start contact prompt remains unverified.
- [ ] Run real Mac manual E2E and record contact name, timestamps, batch id, memory count, and recall result.

## Completed Mac MVP Final Runbook

- [x] Inspect current worktree, runbook, and final implementation plan.
- [x] Execute Task 1: pin Node version and add safe CI.
- [x] Execute Task 2: add structured `doctor:friendy`.
- [x] Execute Task 3: add inspectable runtime lifecycle logs.
- [x] Execute Task 4: add behavior contract artifacts.
- [x] Execute Task 5: add event guess strength and prompt routing.
- [x] Execute Task 6: add candidate lifecycle timing fields.
- [x] Execute Task 7: add active start gate and pause/resume.
- [x] Execute Task 8: add append-only memory revisions.
- [x] Execute Task 9: add bounded update and delete tools.
- [x] Execute Task 10: add follow-up search context TTL and correction routing.
- [x] Execute Task 11: add redacted runtime traces.
- [x] Execute Task 12: add required behavior evals and demo check.
- [x] Execute Task 13: align docs and implementation notes.
- [x] Run final verification across the completed MVP plan.
- [x] Push `main`.
