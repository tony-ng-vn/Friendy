# Field-Aware Memory Search Goal Experiments

## Baseline: Start Current Goal

- Date: 2026-05-20
- Branch: `feature/field-aware-memory-search`
- Observation: `main` was clean and in sync with `origin/main` before branching.
- Goal source: `docs/goals/field-aware-memory-search-goal.md`.
- Baseline command: `npm test`
- Baseline result: Passed, 17 files and 55 tests.
- Result: Use TDD around `createRelationshipTools().search_memories` and interpreted-agent search behavior.

## Task 1 Red/Green: Field-Aware Ranking

- Date: 2026-05-20
- Red command: `npm test -- src/relationship/tools.test.ts src/relationship/interpretedAgent.test.ts`
- Red result: Failed because `Find the recruiting agents founder from Photon` returned Maya plus Nina, `Who was making devtools?` returned Leo plus Rina, and the interpreted-agent path returned multiple generic shared-event matches instead of one confident match.
- Fix: Replaced flattened haystack scoring with deterministic field-aware scoring that separates event, role, project, school/class, alias, context, and tags. Narrow searches now require enough term coverage and collapse to the top result only when its specific-field score clearly beats the next match. Event-wide searches remain broad.
- Green command: `npm test -- src/relationship/tools.test.ts src/relationship/interpretedAgent.test.ts`
- Green result: Passed, 2 files and 17 tests.
