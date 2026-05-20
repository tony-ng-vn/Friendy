# Field-Aware Memory Search Goal Notes

- 2026-05-20: Started goal execution from clean `main`; created `feature/field-aware-memory-search`. Read `docs/goals/goal-writing-guide.md` and current search code. The current gap is `tools.ts` scoring: it flattens name, event, context note, and tags into one lexical haystack, so shared event terms and generic verbs can tie stronger role/project/school clues.
- 2026-05-20: Baseline `npm test` passed with 17 files and 55 tests before implementation changes.
- 2026-05-20: Added RED tests for Maya/Nina recruiting founder, Leo/Rina devtools, CMU, event-wide Photon Residency II recall, and ambiguous dinner founders. Implemented field-aware deterministic scoring in `tools.ts`; targeted tests now pass.
- 2026-05-20: Demo transcript initially showed event-wide recall unnecessarily asking `Which person do you mean?`, while mixed dinner-founder ambiguity did not ask a narrowing question. Fixed ambiguity handling so broad event recall lists without narrowing and close narrow matches still ask.
- 2026-05-20: Saved the deterministic transcript to `docs/goals/field-aware-memory-search-demo.md` and updated README, REFERENCE, scoped relationship-agent guidance, and implementation notes.
- 2026-05-20: Feature-branch verification passed with full `npm test`, `npm run build`, and `git diff --check`.
- 2026-05-20: Fast-forwarded `main` and reran `npm test`, `npm run build`, and `git diff --check` successfully before pushing.
