# Goal: Relationship Agent Eval Harness

## Objective

Create a relationship-agent eval harness for Friendy until one command evaluates deterministic and LLM-interpreted behavior across realistic messy user trajectories.

## Why This Matters

Friendy’s core risk is not whether individual tools work. The hard part is whether the agent can understand messy relationship-memory conversations, map contacts to event context, avoid unsafe writes, and retrieve the right person later. A repeatable eval harness gives the project a measurable feedback loop for those agent behaviors.

## Non-Negotiables

- Use TDD.
- Commit incrementally with `<scope>:<message>`.
- Keep `implementation-notes.html` updated.
- Keep `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, and `docs/goals/EXPERIMENT_NOTES.md` updated.
- Do not commit secrets.
- Keep deterministic fallback evals runnable without OpenAI credentials.
- Do not weaken existing tests or safety behavior to make evals pass.
- Push `main` only after verification passes on `main`.

## Required Behavior

- Add an eval runner under `evals/` or `src/relationship/evals/`.
- Add `npm run eval:agent`.
- `npm run eval:agent` must exit nonzero if required evals fail.
- The eval runner must include at least 12 trajectory cases:
  1. clear event contact confirmation,
  2. overlapping event correction,
  3. no-event candidate with user-supplied event,
  4. ignored candidate,
  5. post-confirmation search,
  6. vague search requiring clarification,
  7. multi-person event recall,
  8. context carryover across messages,
  9. hallucination guard: unknown person is not invented,
  10. unsafe-save guard: memory is not saved without confirmation,
  11. Spectrum first-inbound identity,
  12. messy human wording with typos/slang.
- Each eval must use measurable assertions, not exact prose matching.
- Track metrics:
  - pass rate,
  - intent accuracy,
  - memory-write correctness,
  - search recall@3,
  - unsafe mutation count,
  - hallucination count,
  - clarification correctness.
- If `OPENAI_API_KEY` exists, the runner may optionally run stochastic/repeated model-backed evals and report variance. The required eval set must remain deterministic without the key.

## Test Cases

Cover at least:

- detected contact during one clear event -> confirmation saves the event and memory,
- detected contact during overlapping events -> user correction saves the corrected event,
- detected contact outside events -> user-supplied event title is saved,
- pending candidate ignored -> no memory write,
- confirmed candidate -> later search retrieves the person,
- vague search -> clarification without memory mutation,
- multi-person event recall -> multiple expected names returned,
- carryover conversation -> follow-up people inherit event context,
- unknown person search -> no invented memory,
- unsafe save phrasing without confirmation -> no pending candidate write,
- first Spectrum message without user ID -> uses `spaceId` identity,
- typo/slang capture/search -> expected memory/search behavior still passes.

## Verification Commands

Run before completion:

```bash
npm test
npm run build
npm run eval:agent
git diff --check
```

## Completion Criteria

- The eval runner exists and is covered by automated tests.
- `npm run eval:agent` runs the required deterministic eval set without OpenAI credentials.
- The eval runner has at least 12 named trajectory cases covering every required scenario.
- Metrics include pass rate, intent accuracy, memory-write correctness, search recall@3, unsafe mutation count, hallucination count, and clarification correctness.
- Required eval failures cause a nonzero process exit.
- Optional model-backed repeated runs are gated behind the presence of `OPENAI_API_KEY`.
- `README.md`, `REFERENCE.md`, `src/relationship/AGENTS.md`, `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, `docs/goals/EXPERIMENT_NOTES.md`, and `implementation-notes.html` are updated.
- All verification commands pass on the feature branch and again on `main`.
- Changes are committed incrementally.
- `main` is pushed after final verification.
