# Relationship Agent Eval Harness Goal Notes

- 2026-05-20: Started goal execution from clean `main`; created `feature/relationship-agent-evals`.
- 2026-05-20: Baseline `npm test` passed with 17 files and 70 tests before eval harness changes.
- 2026-05-20: Design decision: keep the required eval set deterministic and local. Optional OpenRouter/model-backed repeated runs can layer on later or run only when `OPENROUTER_API_KEY` is present, but the required command must work without external credentials.
- 2026-05-20: Eval assertions should check state and semantic substrings instead of exact reply prose, because the product agent can later change wording without invalidating behavior.
- 2026-05-20: Added `src/relationship/evals/agentEvalRunner.ts` and `agentEvalCli.ts`. The required eval suite uses the rule-based interpreter and deterministic tools; optional model-backed sampling is gated by both `OPENROUTER_API_KEY` and `FRIENDY_EVAL_RUN_MODEL=1`.
- 2026-05-20: `npm run eval:agent` now reports pass rate, intent accuracy, memory-write correctness, search recall@3, unsafe mutation count, hallucination count, clarification correctness, per-case assertion results, and model-backed eval availability.
