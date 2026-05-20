# Relationship Agent Instructions

This directory is the core relationship-memory system.

Architecture boundaries:

- `eventMapper.ts` maps contact detection time to calendar context deterministically.
- `repository.ts` owns in-memory persistence boundaries.
- `candidateConfirmation.ts` owns deterministic parsing for pending-contact consent replies and corrected event context.
- `tools.ts` exposes small deterministic actions for the agent, including field-aware search ranking.
- `responseComposer.ts` owns deterministic user-facing wording. It may format selected facts, but it must not choose matches, write memories, or expose raw search reasons.
- `agentCore.ts` is the current deterministic router.
- `interpretation.ts` is the contract for LLM-to-JSON interpretation.
- `interpretedAgent.ts` enriches validated interpretations with recent conversation context before deterministic tools execute.
- `temporalContext.ts` owns chrono-node date parsing; do not hand-roll relative-date rules in agent code.
- `evals/` owns trajectory-level agent evaluation. Eval assertions should check state, tool calls, metrics, and semantic substrings, not exact reply prose.
- `transports/` adapts communication surfaces and should not own product logic.

Rules:

- Do not let an LLM write memories directly. The model may interpret; deterministic tools execute.
- Preserve raw inbound text and interpretation/log metadata when adding logging.
- Keep user-facing replies short enough for iMessage.
- Never pretend certainty when search results are ambiguous.
- Do not leak raw search internals such as `matched:`, score details, tool debug text, or placeholder labels like `manual contact` in user-facing replies.
- Keep memory search deterministic unless a goal explicitly adds a model reranker. Role, project, school/class, alias, and specific context should outrank generic shared event words for narrow searches.
- Keep queued-contact confirmation deterministic. The LLM may interpret messy capture/search text, but approval, ignore, event correction, and pending queue writes should go through explicit tools.
- Add tests for realistic messy user messages, not only ideal command syntax.
- When adding agent behavior that spans multiple turns, add or update an eval case in `evals/agentEvalRunner.ts` so `npm run eval:agent` remains a product-level safety check.

Useful test targets:

```bash
npm test -- src/relationship/agentCore.test.ts
npm test -- src/relationship/interpretedAgent.test.ts
npm test -- src/relationship/responseComposer.test.ts
npm test -- src/relationship/interpretation.test.ts
npm test -- src/relationship/temporalContext.test.ts
npm test -- src/relationship/tools.test.ts
npm test -- src/relationship/repository.test.ts
npm test -- src/relationship/evals/agentEvalRunner.test.ts
npm run eval:agent
npm test -- src/relationship/transports/spectrumTransport.test.ts
```
