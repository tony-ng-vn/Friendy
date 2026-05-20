# Goal: Local macOS Contact/Calendar Checker

## Objective

Build Friendy's explicit local macOS contact/calendar checker until `npm run ingest:local:check` can detect a newly added phone/email contact, map it to the best calendar event by detection time, create a pending candidate, and produce the same Friendy confirmation prompt used by the iMessage/Spectrum contact confirmation loop.

## Why This Matters

Friendy already proves the core relationship loop with fixture data. The next MVP step is proving the first real sensor boundary: a user adds a phone contact locally, Friendy detects the new contact method, connects it to calendar context, and prepares the iMessage confirmation path without requiring a UI or a background daemon.

## Non-Negotiables

- Use TDD.
- Commit incrementally with `<scope>:<message>`.
- Keep `implementation-notes.html`, `CHANGELOG.md`, `README.md`, `REFERENCE.md`, and `docs/ai-system-architecture.md` updated.
- Keep `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, and `docs/goals/EXPERIMENT_NOTES.md` updated.
- Do not add UI.
- Do not add LinkedIn, X, Instagram, or social detection.
- Do not create a background watcher/daemon.
- Do not read iMessage.
- Do not auto-save relationship memory without user confirmation.
- Do not commit secrets.
- Do not weaken fixture ingestion, iMessage flow checks, or deterministic eval behavior.
- Keep product wording; do not reintroduce show-oriented framing.

## Required Behavior

- Add `npm run ingest:local:check`.
- The command is explicit and local-only.
- On macOS, real Contacts and Calendar access can happen only from this command.
- On non-macOS or missing permissions, real-provider mode must fail clearly without breaking fixture checks.
- The command defaults to safe dry-run behavior that prints the outbound Friendy confirmation prompt instead of sending a live iMessage.
- Live sending requires `FRIENDY_LOCAL_CHECK_SEND=1`.
- The live-send branch is testable with a mocked sender.
- A test contact named `Friendy-<number>` is enough to exercise the local detection path.
- The detected contact flows through existing ingestion, repository, event matching, candidate queue, and iMessage/Spectrum prompt boundaries.
- Existing `npm run check:imessage-e2e` and `npm run ingest:check` continue to pass.

## Test Cases

- Real macOS provider adapters are behind explicit commands and are not imported or executed by normal tests, build, evals, `check:imessage-e2e`, or `ingest:check`.
- Contact detection ignores name-only edits and detects only new normalized phone/email methods.
- Local checker maps a detected contact to the best overlapping calendar event.
- No-event case still creates a pending candidate with no event guess and asks the user for context.
- Dry-run prints the exact Friendy confirmation prompt and does not send a live message.
- Live send path is guarded by `FRIENDY_LOCAL_CHECK_SEND=1` and can be exercised with a mocked sender.
- Non-macOS real-provider mode returns a clear failure message.

## Verification Commands

Run before completion:

```bash
npm test
npm run build
npm run eval:agent
npm run check:imessage-e2e
npm run ingest:check
npm run ingest:local:check -- --mock
git diff --check
repo-wide forbidden-term search for old show-oriented wording
```

The repo-wide forbidden-term search must return no matches.

## Completion Criteria

- `npm run ingest:local:check` exists.
- A deterministic mock local check proves the full contact -> event -> pending candidate -> prompt path.
- Real macOS Contacts/Calendar adapters exist behind the explicit local command and fail clearly outside macOS.
- Dry-run is the default.
- Live send requires `FRIENDY_LOCAL_CHECK_SEND=1`.
- Existing fixture and iMessage product checks still pass.
- Docs and progress files are updated.
- Changes are committed incrementally and pushed to `main` after verification passes on `main`.
