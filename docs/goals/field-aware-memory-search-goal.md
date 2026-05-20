# Goal: Field-Aware Memory Search

## Objective

Improve Friendy memory search so realistic event-goer queries rank the right person above generic shared-event matches.

## Why This Matters

The current MVP can save event memories, but search is still too lexical. Shared event terms like `Photon` and generic words like `making` can make unrelated people appear as equally likely results. Friendy only feels useful if vague searches recover the right person by stronger fields such as role, project, school, date, and specific context.

## Non-Negotiables

- Use TDD.
- Commit incrementally with `<scope>:<message>`.
- Keep `implementation-notes.html` updated.
- Keep `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, and `docs/goals/EXPERIMENT_NOTES.md` updated.
- Do not commit secrets.
- Do not weaken existing event-wide recall to make narrow searches pass.
- Do not add embeddings, vector databases, or LLM reranking for this goal.
- Keep search deterministic and locally testable.

## Required Behavior

- `Find the recruiting agents founder from Photon` returns Maya as the only confident top match instead of also returning Nina.
- `Who was making devtools?` returns Leo without also returning Rina.
- `Who goes to CMU?` returns Rina.
- `Who did I meet at Photon Residency II?` still returns all relevant event matches.
- `Who was the founder from dinner?` still asks a narrowing question when multiple founder-at-dinner memories are close.
- Ranking should prioritize specific field/context matches over generic shared event words.
- Generic verbs like `making`, `met`, `was`, and `goes` should not cause false confidence.

## Test Cases

Cover at least:

- Save Maya as `Photon Residency II dinner, founder working on recruiting agents`.
- Save Nina Park as `Photon Residency II, designer building an AI note-taking tool`.
- Search `Find the recruiting agents founder from Photon` -> Maya only, not Nina.
- Save Leo as `Photon Residency II, making devtools for agents`.
- Save Rina as `Photon Residency II, goes to CMU, class 2027 and making AI infra dashboard`.
- Search `Who was making devtools?` -> Leo only, not Rina.
- Search `Who goes to CMU?` -> Rina.
- Search `Who did I meet at Photon Residency II?` -> all relevant event matches.
- Save two dinner founder memories with different details.
- Search `Who was the founder from dinner?` -> multiple possible matches plus a narrowing question.

## Verification Commands

Run before completion:

```bash
npm test
npm run build
git diff --check
```

Also run a deterministic local product flow transcript that covers:

- recruiting-agents founder query,
- devtools query,
- CMU query,
- Photon Residency II event-wide query,
- ambiguous dinner founder query.

## Completion Criteria

- Required behavior is covered by automated tests.
- Field-aware ranking lives in the deterministic search layer, not response wording.
- Event-wide searches still return multiple relevant memories.
- Ambiguous close matches still ask a narrowing question.
- Product Flow transcript shows the exact measurable end-state queries working.
- `README.md`, `REFERENCE.md`, and `implementation-notes.html` are updated if architecture or behavior changes.
- All verification commands pass on the feature branch and again on `main`.
- Changes are committed incrementally.
- `main` is pushed when complete.
