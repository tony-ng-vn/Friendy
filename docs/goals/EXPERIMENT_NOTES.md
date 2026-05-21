# Candidate Intake Interface Spec Goal Notes

- 2026-05-21: This is intentionally a red/spec pass. Production behavior should not change in this goal.
- 2026-05-21: Candidate Intake scope is detected-contact candidates only. Manual memory capture, durable state, UI, and Spectrum transport behavior are out of scope.
- 2026-05-21: The red spec requires structured outcomes, not user-facing copy. `responseComposer` remains responsible for wording.
- 2026-05-21: `candidateConfirmation.ts` should remain the later implementation's event-correction helper instead of redesigning event correction in the first refactor.
- 2026-05-21: Verification matched the intended red state: focused Candidate Intake tests fail because the future module does not exist, while all pre-existing test files still pass under `npm test`.
- 2026-05-21: Candidate Intake is now the single confirm/ignore decision module for queued contact candidates. The module still delegates actual mutation to relationship tools.
- 2026-05-21: Ambiguity handling is intentionally stricter when there are multiple plausible reviewable candidates. The one exception is ingestion compatibility: if exactly one pending candidate has event guesses, a bare confirmation can resolve that candidate.
- 2026-05-21: User-facing copy remains outside Candidate Intake. Agents translate structured Candidate Intake outcomes through `responseComposer`.
- 2026-05-21: Verification is green across focused tests, full tests, build, deterministic agent evals, iMessage product flow, fixture ingestion, and local checker mock mode.
