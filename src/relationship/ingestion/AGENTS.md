# Ingestion Agent Instructions

This directory owns contact/calendar signal ingestion for the relationship-memory system.

- Keep fixture checks deterministic. `npm run ingest:check` and tests must not read real Contacts or calendars.
- Keep real macOS access behind explicit user-run commands only:
  - `npm run ingest:contacts:smoke -- --name Friendy-<number>`
  - `npm run ingest:local:check`
- Use `npm run ingest:local:check -- --mock` for deterministic local-check verification when macOS permissions are unavailable.
- Contact diffing is method-centric: a new normalized phone/email can create a candidate; name-only edits and duplicate normalized methods should not.
- Local checker output should flow through existing ingestion, repository, event matching, pending candidate, and Friendy prompt interfaces.
- Do not add background watchers, social detectors, or automatic memory saves from this directory.

Useful checks:

```bash
npm test -- src/relationship/ingestion/contactSnapshot.test.ts
npm test -- src/relationship/ingestion/ingestionPipeline.test.ts
npm test -- src/relationship/ingestion/localCheck.test.ts
npm test -- src/relationship/ingestion/localMacAdapters.test.ts
npm run ingest:check
npm run ingest:local:check -- --mock
```
