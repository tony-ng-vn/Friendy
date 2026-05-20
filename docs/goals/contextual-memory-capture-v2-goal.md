# Goal: Contextual Memory Capture V2

Read the Friendy repo and implement Contextual Memory Capture V2.

## Objective

Make Friendy correctly save and retrieve people from messy multi-turn event conversations.

## Why This Matters

Friendy currently handles simple manual saves, but normal users speak in follow-up fragments:

- "I also met Sarah Fah..."
- "And also met Felix Ng..."
- "same room with me and Amaya"

The agent must carry event and relationship context across recent turns. Otherwise it saves incomplete memories and later fails to retrieve everyone from the event.

## Non-Negotiables

- Use TDD.
- Commit incrementally with `<scope>:<message>`.
- Keep `implementation-notes.html` updated.
- Keep `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, and `docs/goals/EXPERIMENT_NOTES.md` updated.
- Do not let the LLM directly write memory.
- LLM output may interpret text into validated JSON only.
- Deterministic tools must perform saves, searches, ignores, and clarification.
- Do not commit secrets.

## Required Behavior

Add automated tests for one conversation containing Amaya, Sarah Fah, and Felix Ng.

The conversation:

```text
I met Amaya at Photon Residency II, and me and him sleep on the same bed cuz we ran out of bed :(
I also met Sarah Fah who ran Photon Residency II as the community lead
And also met Felix Ng who goes to UBC and sleep in the same room with me and Amaya
```

Expected:

- Friendy saves `Amaya`.
- Friendy saves `Sarah Fah`, not only `Sarah`.
- Sarah has event `Photon Residency II`.
- Sarah has role/context `community lead`.
- Friendy saves `Felix Ng`, not only `Felix`.
- Felix inherits `Photon Residency II` from recent conversation context even though the Felix message does not repeat the event.
- Felix stores `UBC`.
- Felix stores room/sleep context.
- Felix stores relationship/reference to `Amaya`.

Search requirements:

- `Who did I meet at Photon Residency II?` returns Amaya, Sarah Fah, and Felix Ng.
- `Who slept in the same room?` returns Felix Ng and can mention Amaya as related context.
- `Who was the community lead?` returns Sarah Fah.
- The agent must not drop event context just because the latest message used "also".

## Date Parsing Requirement

Add a real natural-language date parser instead of hand-written date rules.

Recommended library:

- `chrono-node` for natural language date extraction.

Use deterministic date parsing with:

- raw user text,
- `InboundAgentMessage.receivedAt`,
- user timezone when available.

Store both:

- raw date phrase, if present,
- normalized date/time or date window, if parsed.

Do not implement manual fallback rules for `today`, `yesterday`, or `2 days ago`.

## Architecture Direction

Add a small conversation-context layer.

It should track recent:

- active event,
- active date/date window,
- recently mentioned people,
- recent relationship references,
- unresolved references if useful.

The interpreted agent should enrich a validated interpretation with this context before deterministic tools save/search memory.

## Verification Commands

Run before completion:

```bash
npm test
npm run build
git diff --check
```

Also run a terminal or test harness smoke path that proves the Amaya/Sarah/Felix conversation saves and searches correctly.

## Completion Criteria

- All required behavior above is covered by automated tests.
- Full names are preserved for Sarah Fah and Felix Ng.
- Event context carryover works.
- Natural-language date parsing uses a real parser.
- All verification commands pass.
- `README.md`, `REFERENCE.md`, and `implementation-notes.html` are updated if architecture or commands change.
- Changes are committed incrementally.
- `main` is pushed when complete.

