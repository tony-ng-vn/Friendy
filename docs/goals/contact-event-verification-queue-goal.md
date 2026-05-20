# Goal: Contact Event Verification Queue MVP

Implement the Friendy contact-event verification queue MVP.

## Objective

Make the core product loop work from detected contact and calendar state, not only manual text saves.

```text
new contact detected
-> map to likely calendar event
-> add to verification queue
-> ask user to confirm/add context
-> save searchable relationship memory
-> later search retrieves the person
```

## Why This Matters

Friendy’s wedge is not just manual memory entry. The product becomes meaningfully better when it notices that a contact was added during an approved event window and asks the user to confirm.

## Non-Negotiables

- Use TDD.
- Commit incrementally with `<scope>:<message>`.
- Keep `implementation-notes.html` updated.
- Keep `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, and `docs/goals/EXPERIMENT_NOTES.md` updated.
- Do not scrape social platforms.
- Do not read iMessage history outside Spectrum-provided inbound messages.
- Do not commit secrets.
- Keep Spectrum/iMessage as a transport, not the product identity.

## Required Behavior

Add or improve a testable verification queue flow.

Detected contact:

- A new contact delta appears with name/contact method and `detectedAt`.
- Calendar events exist for the user.
- Friendy maps the contact to likely event context.
- Candidate is added to pending queue.

Event mapping:

- Short specific events should outrank long background events when both overlap.
- If multiple events overlap, store ranked event guesses.
- If no event overlaps, still create a candidate but ask the user where they met.
- If user corrects the event, save the corrected event context.

Verification:

- Friendy asks the user to confirm whether they met the person at the guessed event.
- User can confirm and add context in natural language.
- User can ignore the candidate.
- Confirmed contact becomes searchable relationship memory.

Onboarding/conversation identity:

- Do not require hardcoded `FRIENDY_OWNER_PHONE` for normal onboarding.
- First inbound Spectrum/iMessage conversation should establish the user conversation/space when possible.
- Startup/onboarding greeting should happen only after a known conversation exists, unless a real signup flow provides the recipient.

Search:

- Verified contacts can be retrieved by event, name, role, school, project, and context.
- Search response should include enough context to identify the right person.

## Test Cases

Cover at least:

- contact added during one clear event,
- contact added during overlapping short + long events,
- contact added when no event exists,
- user confirms guessed event,
- user corrects guessed event,
- user ignores candidate,
- saved verified contact can be searched later.

## Verification Commands

Run before completion:

```bash
npm test
npm run build
npm run agent:terminal -- "yes, recruiting agents, played piano"
git diff --check
```

## Completion Criteria

- The detected-contact -> event-map -> queue -> confirm -> save -> search flow is covered by automated tests.
- Overlap and no-event cases are handled.
- Spectrum user/conversation identity does not rely on hardcoded owner phone for normal first-contact onboarding.
- All verification commands pass.
- `README.md`, `REFERENCE.md`, and `implementation-notes.html` are updated if architecture or commands change.
- Changes are committed incrementally.
- `main` is pushed when complete.

