# Relationship Agent Eval Harness Goal Notes

- 2026-05-20: Started goal execution from clean `main`; created `feature/relationship-agent-evals`.
- 2026-05-20: Baseline `npm test` passed with 17 files and 70 tests before eval harness changes.
- 2026-05-20: Design decision: keep the required eval set deterministic and local. Optional OpenRouter/model-backed repeated runs can layer on later or run only when `OPENROUTER_API_KEY` is present, but the required command must work without external credentials.
- 2026-05-20: Eval assertions should check state and semantic substrings instead of exact reply prose, because the product agent can later change wording without invalidating behavior.
