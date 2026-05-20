# Goal: iMessage Contact Confirmation Loop

## Objective

Build Friendy's iMessage-first contact confirmation loop until a deterministic Spectrum/iMessage-style demo proves: fixture new phone contact detection -> event guess -> Friendy confirmation message -> user messy confirmation reply -> structured memory save -> later iMessage search retrieves the person.

## Why This Matters

Friendy's MVP is not just contact ingestion and not just chat search. The core product moment is Friendy proactively texting the user about a newly detected contact, getting human context back through iMessage, saving the confirmed relationship memory, and retrieving it later from vague context.

## Non-Negotiables

- Use TDD.
- Use iMessage/Spectrum transport boundaries or a deterministic Spectrum/iMessage simulator for the required demo.
- Keep live Spectrum sending optional; the required demo must run locally without sending real messages.
- Do not use the terminal transport as the required demo path.
- Do not add UI.
- Do not add LinkedIn, X, Instagram, or social detection.
- Keep phone contacts as the only MVP detection source.
- Keep real Contacts access limited to the explicit smoke command.
- Commit incrementally with `<scope>:<message>`.
- Keep `implementation-notes.html` updated.
- Keep `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, and `docs/goals/EXPERIMENT_NOTES.md` updated.
- Push `main` only after verification passes on `main`.

## Required Behavior

- Add a deterministic iMessage/Spectrum-style E2E demo command, expected name: `npm run demo:imessage-e2e`.
- The demo must start with fixture contact/calendar ingestion, not manually seeded memory.
- The demo must print the event guess and a Friendy confirmation message.
- The demo must route the messy user reply through the iMessage/Spectrum runtime boundary or deterministic simulator.
- The messy confirmation reply must include:

```text
met abc at Photon Residency II after havent met him since high school in minnesota
```

- Friendy must confirm the pending candidate and save a relationship memory tied to that candidate.
- The saved memory must include:
  - current event context: `Photon Residency II`
  - relationship backstory: `had not seen him since high school in Minnesota`
  - searchable note containing both the event and backstory
  - contact method from the detected new phone contact
- Later search must retrieve the person for:

```text
who did I run into from high school at Photon?
```

- The response must be conversational iMessage-style and must not leak raw match/debug language.

## Verification Commands

Run before completion:

```bash
npm test
npm run build
npm run eval:agent
npm run demo:imessage-e2e
npm run ingest:demo
git diff --check
```

## Completion Criteria

- Tests cover the new iMessage/Spectrum-style E2E path.
- Tests prove event context and relationship backstory are separated for the required messy reply.
- `npm run demo:imessage-e2e` prints the deterministic product loop from detection to later search.
- Existing evals still pass.
- `README.md`, `REFERENCE.md`, `docs/ai-system-architecture.md` if needed, goal tracking docs, and `implementation-notes.html` are updated.
- All verification commands pass on the feature branch and again on `main`.
- Changes are committed incrementally and pushed to `main`.
