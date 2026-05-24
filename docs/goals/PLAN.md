# Active Goal Plan: Bi-Directional Apple Contacts Integration

- [x] Read `docs/goals/apple-contacts-bidirectional-integration-goal.md`, `REFERENCE.md`, scoped AGENTS instructions, and the repo graph entry points.
- [x] Start subagent-driven execution with separate Swift and TypeScript codebase explorers.
- [x] Add RED source-level Swift contract tests for the native Contacts JSON actuator.
- [x] Implement Swift stdin JSON actuator using `CNContactStore` / `CNSaveRequest`, with no AppleScript.
- [x] Add RED TypeScript tests for the Apple Contacts adapter command envelope and result parsing.
- [x] Implement `src/relationship/contacts/macContactsAdapter.ts`.
- [x] Add RED tool tests for `read_apple_contact`, `add_apple_contact`, `update_apple_contact`, and `delete_apple_contact`.
- [x] Expose Apple Contact tools through `src/relationship/tools.ts`.
- [ ] Expose Apple Contact tools and intents through route capability lists.
- [ ] Add RED interpretation/prompt tests for Apple Contact mutation intents and confirmation rules.
- [ ] Add confirmation workflow state for Apple Contact create/update/delete and block writes before explicit `yes`.
- [ ] Add RED router-envelope test for linked Apple Contact metadata injection.
- [ ] Inject linked Apple Contact metadata into the router input envelope before LLM routing.
- [ ] Update docs and handoff artifacts for the new actuator, adapter, tools, workflows, and verification evidence.
- [ ] Run required verification: `npm test`, `npm run build`, `npm run eval:agent`, relevant Swift/source checks, and `git diff --check`.
- [ ] Commit incrementally with `<scope>:<message>` and push `main` after the goal is complete.

# Previous Active Goal Plan: Strict Mode and Trace Envelope

- [x] Read `docs/goals/strict-mode-trace-envelope-goal.md` and `docs/superpowers/plans/2026-05-23-strict-mode-trace-envelope.md`.
- [x] Add `FRIENDY_STRICT_MODE` parser and typed `FriendyStrictModeError`.
- [x] Add `FriendyTrace` to interpreted-agent results, persisted interaction JSON, and redacted runtime traces.
- [x] Add interpreter route metadata: `routeSource`, `fallbackUsed`, and `fallbackReason`.
- [x] Add strict failures for missing API key fallback, model execution failure, invalid schema, and explicit fallback interpreter use.
- [x] Add route policy guards for unknown routes, unsupported contact-management routes, missing tools, and ambiguous executable memory mutations.
- [x] Wire strict mode through foreground runtime config and Spectrum/iMessage runtime.
- [x] Add eval fallback usage reporting and a strict-mode fallback-rejection eval case.
- [x] Run full verification: `npm test`, `npm run build`, `npm run eval:agent`, and `git diff --check`.
- [x] Commit docs/final notes and push the branch.

# Completed Goal Plan: State-Aware Relationship Agent Routing

- [x] Read `docs/goals/state-aware-relationship-agent-routing-goal.md` and inspect current routing/state code.
- [x] Add RED transcript coverage for pending-contact pronoun facts, named fact cleanup, active pending inquiry, list/search interruption, event recall, and manual add-as memory creation.
- [x] Reconstruct an active pending-contact context frame from durable candidate prompt fields before previous-search follow-up handling.
- [x] Route pending-contact inquiry/context through deterministic candidate tools and log state-aware route fields.
- [x] Clean pending-contact context notes such as `She is a...` and `Sarah Fan is a...` before saving.
- [x] Route `Who did I meet/met at X?` as event recall, not list-all.
- [x] Add deterministic manual relationship memory creation for `add/save/remember Person as/is/from/at context`.
- [x] Add eval coverage for the new state-aware routing cases.
- [x] Replace remaining generic recoverable fallback copy with specific clarification/blocker language.
- [x] Run full verification: `npm test`, `npm run build`, `npm run eval:agent`, and `git diff --check`.
- [x] Commit incrementally and push `main`.

## Deferred Within Goal

- Full SQLite-backed conversation-frame table is not added in the first slice. The active pending-contact frame is reconstructable from already durable `ContactCandidate` prompt fields (`promptSpaceId`, `promptedAt`, `promptInteractionId`). The concrete table design for remaining frame types is recorded in `docs/goals/state-aware-relationship-agent-routing-goal.md`.

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
- [x] Add throttled `sensor_diagnostic` output for silent Contacts history polling.
- [x] Add `check:mac-mvp-e2e-state` to summarize live Mac sensor, ack, candidate, and memory artifacts.
- [x] Harden `check:mac-mvp-e2e-state` so stale memories for other contacts cannot satisfy the latest-contact proof.
- [x] Harden `check:mac-mvp-e2e-state` to require the latest contact stable id to link to a confirmed candidate and saved memory.
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
