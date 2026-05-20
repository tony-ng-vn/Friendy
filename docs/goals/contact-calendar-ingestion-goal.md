# Goal: Contact Calendar Ingestion Prototype

## Objective

Build Friendy's fixture-based contact/calendar ingestion prototype until one command can prove: contact snapshot diff -> newly added contact method -> detectedAt -> calendar event match -> pending candidate queue -> confirmation-ready candidate.

## Why This Matters

Friendy's product wedge depends on noticing new connections from approved contact/calendar context. The agent and memory layers already work once a candidate exists; this goal proves the safe ingestion step that creates those candidates without reading real user data by default.

## Non-Negotiables

- Use TDD.
- Commit incrementally with `<scope>:<message>`.
- Keep `implementation-notes.html` updated.
- Keep `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, and `docs/goals/EXPERIMENT_NOTES.md` updated.
- Do not commit secrets.
- Do not add UI.
- Do not read real calendars in this goal.
- Do not read real user contacts except through the explicit Contacts smoke command.
- Keep normal tests, build, evals, and fixture product flow free of real Contacts access.
- Keep real provider adapters as future interfaces only.
- Push `main` only after verification passes on `main`.

## Required Behavior

- Add contact snapshot types and diff module.
- Add calendar event provider abstraction using fixture events only.
- Add before/after contact snapshot fixtures.
- Detect newly added contacts when a new phone/email appears.
- Do not create candidates for name-only edits or duplicate contact methods.
- Assign `detectedAt` deterministically from fixture data in tests.
- Map newly detected contacts to calendar event context.
- Enqueue pending candidates through the existing repository/tool boundary.
- Add `npm run ingest:check`.
- `npm run ingest:check` must print a deterministic summary showing detected contact, event guesses, pending queue, and candidate id.
- Add optional real Contacts smoke command if the local environment supports it, for example `npm run ingest:contacts:smoke -- --name Friendy-001`.
- The real Contacts smoke command must be explicit and must never run during `npm test`, `npm run build`, `npm run eval:agent`, or `npm run ingest:check`.
- The smoke command may create only test contacts named `Friendy-<number>`.
- It must print the exact contact name and contact method it created.
- It must be safe to run repeatedly without creating uncontrolled duplicates.
- It must document how to manually delete the test contact.
- If real Contacts access is unavailable, it should fail clearly while keeping fixture-based ingestion working.
- Update evals if ingestion changes the core flow.

## Test Cases

Cover at least:

- new contact method -> detected contact delta,
- changed name only -> no detected contact,
- duplicate contact method -> no detected contact,
- contact added outside event window -> candidate with no event matches,
- contact added during overlapping short + long event -> short event ranks first,
- ignored duplicate contact -> no detected contact,
- queued candidate can still be confirmed and searched.

## Verification Commands

Run before completion:

```bash
npm test
npm run build
npm run eval:agent
npm run ingest:check
git diff --check
```

## Completion Criteria

- The fixture-based ingestion modules exist and are covered by automated tests.
- `npm run ingest:check` proves snapshot diff -> event match -> pending queue without real Contacts or real calendars.
- The optional Contacts smoke command exists and is explicit, safe, and documented.
- Existing evals still pass, or are updated if ingestion changes the core flow.
- `README.md`, `REFERENCE.md`, `src/relationship/AGENTS.md`, goal tracking docs, and `implementation-notes.html` are updated.
- All verification commands pass on the feature branch and again on `main`.
- Changes are committed incrementally.
- `main` is pushed after final verification.
