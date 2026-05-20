# iMessage Contact Confirmation Loop Goal Experiments

## Baseline: Start Current Goal

- Date: 2026-05-20
- Branch: `feature/imessage-contact-confirmation-loop`
- Goal source: Codex active goal context and `docs/goals/imessage-contact-confirmation-loop-goal.md`.
- Baseline command: `npm test`
- Baseline result: Passed, 21 files and 89 tests.
- Result: Use TDD to add a deterministic iMessage/Spectrum-style product-flow path that proves fixture contact ingestion can produce an iMessage confirmation, save messy confirmed context, and retrieve the person later by vague search.

## RED: iMessage E2E And Backstory Contracts

- Date: 2026-05-20
- Command: `npm test -- src/relationship/candidateConfirmation.test.ts src/relationship/transports/imessageE2eFlow.test.ts`
- Expected failure: the iMessage E2E flow module did not exist, and candidate confirmation did not return `relationshipContext` or select `Photon Residency II` from the messy confirmation sentence.
- Result: Failed at the missing flow-module boundary and the missing backstory/event parsing behavior.

## GREEN: Deterministic iMessage Confirmation Flow

- Date: 2026-05-20
- Commands:
  - `npm test -- src/relationship/candidateConfirmation.test.ts src/relationship/transports/imessageE2eFlow.test.ts src/relationship/transports/spectrumTransport.test.ts src/relationship/interpretedAgent.test.ts src/relationship/tools.test.ts`
  - `npm run check:imessage-e2e`
- Result: Focused tests passed with 5 files and 24 tests. The product-flow check printed detection, event guess, iMessage confirmation prompt, messy confirmation reply, saved memory, separated relationship backstory, and later search retrieval for Abc.

## Cleanup: Product-First Terminology

- Date: 2026-05-20
- Commands:
  - repo-wide forbidden-term search for the old presentation framing
  - `npm test -- src/relationship/candidateConfirmation.test.ts src/relationship/transports/imessageE2eFlow.test.ts src/relationship/transports/spectrumTransport.test.ts src/relationship/interpretedAgent.test.ts src/relationship/tools.test.ts src/relationship/ingestion/ingestionPipeline.test.ts src/App.test.tsx`
  - `npm run check:imessage-e2e`
  - `npm run ingest:check`
- Result: Removed project-wide show-oriented wording and renamed fixture identifiers, files, and scripts to product-flow/check language. The forbidden-term search found no remaining presentation-framing text. The targeted test suite passed with 7 files and 30 tests, and both product checks printed the expected deterministic flows.

## Verification: Feature Branch After Cleanup

- Date: 2026-05-20
- Commands:
  - `npm test`
  - `npm run build`
  - `npm run eval:agent`
  - `npm run check:imessage-e2e`
  - `npm run ingest:check`
  - `git diff --check`
  - repo-wide forbidden-term search for the old presentation framing
- Result: Full tests passed with 23 files and 92 tests. Build passed. Agent evals passed 12/12 required cases. Both product checks printed the expected deterministic flows. Whitespace check passed. The forbidden-term search returned no matches.

## Verification: Main After Fast-Forward

- Date: 2026-05-20
- Commands:
  - `npm test`
  - `npm run build`
  - `npm run eval:agent`
  - `npm run check:imessage-e2e`
  - `npm run ingest:check`
  - `git diff --check`
  - repo-wide forbidden-term search for the old presentation framing
- Result: Main verification passed with 23 test files and 92 tests, successful production build, 12/12 required agent eval cases, both product checks, whitespace check, and no forbidden-term matches.
