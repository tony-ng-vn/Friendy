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
- Follow-up red command: `npm test -- src/relationship/interpretedAgent.test.ts`
- Follow-up red result: Failed because event-wide Photon Residency II recall listed all people but still asked `Which person do you mean?`.
- Follow-up fix: Suppressed ambiguity prompts for event-wide recall queries and widened the close-score ambiguity threshold for narrow searches.
- Follow-up green command: `npm test -- src/relationship/tools.test.ts src/relationship/interpretedAgent.test.ts src/relationship/agentCore.test.ts`
- Follow-up green result: Passed, 3 files and 22 tests.

## Task 2 Demo Transcript

- Date: 2026-05-20
- Command: deterministic `node_modules/.bin/tsx --eval "<field-aware event-goer transcript>"`
- Result: Maya was the only confident match for recruiting-agents founder, Leo was the only confident devtools match, Rina matched CMU, Photon Residency II event recall listed Maya/Leo/Nina/Rina, and dinner-founder ambiguity asked a narrowing question.
- Transcript: `docs/goals/field-aware-memory-search-demo.md`.

## Task 3 Verification: Feature Branch

- Date: 2026-05-20
- Command: `npm test`
- Result: Passed, 17 files and 60 tests.
- Command: `npm run build`
- Result: Passed.
- Command: `git diff --check`
- Result: Passed.

## Task 4 Verification: Main Merge

- Date: 2026-05-20
- Merge: Fast-forwarded `main` from `69d2e80` to `3629048`.
- Command on `main`: `npm test`
- Result: Passed, 17 files and 60 tests.
- Command on `main`: `npm run build`
- Result: Passed.
- Command on `main`: `git diff --check`
- Result: Passed.
