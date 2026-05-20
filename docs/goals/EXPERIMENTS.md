# Contact Calendar Ingestion Goal Experiments

## Baseline: Start Current Goal

- Date: 2026-05-20
- Branch: `feature/contact-calendar-ingestion`
- Goal source: Codex active goal context and `docs/goals/contact-calendar-ingestion-goal.md`.
- Baseline command: `npm test`
- Baseline result: Passed, 18 files and 75 tests.
- Result: Use TDD to add fixture-based contact snapshot diffing, calendar provider abstraction, candidate ingestion, deterministic demo command, and explicit real Contacts smoke command.

## RED: Ingestion And Contacts Smoke Contracts

- Date: 2026-05-20
- Command: `npm test -- src/relationship/ingestion/contactSnapshot.test.ts src/relationship/ingestion/ingestionPipeline.test.ts src/relationship/contacts/contactsSmoke.test.ts`
- Expected failure: contact snapshot, ingestion pipeline, and Contacts smoke modules did not exist yet.
- Result: Failed at the missing-module boundary, then tests also pinned the required `ingest:demo` and `ingest:contacts:smoke` npm scripts before implementation.

## GREEN: Fixture Ingestion Prototype

- Date: 2026-05-20
- Commands:
  - `npm test -- src/relationship/ingestion/contactSnapshot.test.ts src/relationship/ingestion/ingestionPipeline.test.ts src/relationship/contacts/contactsSmoke.test.ts`
  - `npm run ingest:demo`
  - `npm run build`
- Result: Targeted tests passed with 3 files and 14 tests. `npm run ingest:demo` printed deterministic detected contacts, candidate ids, event guesses, and pending queue. Build passed after fixing a contact diff type narrowing issue.

## VERIFY: Feature Branch Required Gates

- Date: 2026-05-20
- Branch: `feature/contact-calendar-ingestion`
- Commands:
  - `npm test`
  - `npm run build`
  - `npm run eval:agent`
  - `npm run ingest:demo`
  - `git diff --check`
- Result: Passed. Full tests reported 21 files and 89 tests. Eval harness passed 12/12 required cases with 0 unsafe mutations and 0 hallucinations. Ingest demo printed deterministic detected contacts, candidate ids, ranked event guesses, and pending queue.

## VERIFY: Main Required Gates

- Date: 2026-05-20
- Branch: `main`
- Commands:
  - `npm test`
  - `npm run build`
  - `npm run eval:agent`
  - `npm run ingest:demo`
  - `git diff --check`
- Result: Passed after fast-forwarding `main`. Full tests reported 21 files and 89 tests. Eval harness passed 12/12 required cases with 0 unsafe mutations and 0 hallucinations. Ingest demo printed the same deterministic candidate/event summary.
