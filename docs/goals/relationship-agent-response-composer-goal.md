# Goal: Relationship Agent Response Composer

Implement a Friendy response composer that makes replies conversational while staying grounded in deterministic facts.

## Objective

Replace robotic search/save replies with human iMessage-style answers that feel like a relationship memory agent instead of a database trace.

## Why This Matters

Current responses leak internals:

```text
Likely Amaya. Your saved note says "...". matched: bed. Contact: manual contact.
```

That proves retrieval happened, but it feels wrong. Friendy should answer like a helpful buddy who remembers the context.

## Non-Negotiables

- Use TDD.
- Commit incrementally with `<scope>:<message>`.
- Keep `implementation-notes.html` updated.
- Keep `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, and `docs/goals/EXPERIMENT_NOTES.md` updated.
- The composer must not invent facts.
- Deterministic tools still select the facts and matches.
- If an LLM is used for wording, it receives selected facts only and must not perform retrieval or write memory.
- Do not commit secrets.

## Required Behavior

Add a `responseComposer` boundary.

It should format:

- save confirmations,
- single search result,
- multiple search results,
- no-match responses,
- clarification prompts,
- ignore confirmations.

Search replies must not expose:

- `matched:`,
- raw scoring,
- algorithm/debug language,
- `manual contact`,
- raw internal reason strings.

Expected Amaya bed-search style:

```text
I think that was Amaya — you told me you met them at Photon Residency II, and the clue was that you two ended up sharing a bed because beds ran out. I don’t have a contact link saved yet.
```

Shorter iMessage-friendly variants are acceptable, but they must sound human and remain grounded.

No contact method behavior:

- If no real contact method exists, say something like `I don’t have a contact link saved yet.`
- Do not say `manual contact`.

Multiple match behavior:

- If several people match, list them briefly.
- If confidence is unclear, ask a narrowing question.
- Do not pretend a single result is certain when scores are close.

## Optional LLM Composer

You may add an optional LLM response composer if it is clearly bounded:

```text
selected deterministic facts -> LLM wording -> final reply
```

The LLM composer must:

- be optional,
- have deterministic fallback,
- never choose matches,
- never write memory,
- never invent contact methods,
- be covered by tests with fake model calls.

## Verification Commands

Run before completion:

```bash
npm test
npm run build
git diff --check
```

## Completion Criteria

- User-facing replies no longer leak search internals.
- Amaya, Sarah, Felix, no-match, multiple-match, and clarification replies have automated coverage.
- If LLM composition is added, fake-model tests prove grounding and fallback.
- All verification commands pass.
- `README.md`, `REFERENCE.md`, and `implementation-notes.html` are updated if architecture or commands change.
- Changes are committed incrementally.
- `main` is pushed when complete.

