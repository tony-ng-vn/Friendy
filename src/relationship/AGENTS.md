# Relationship Agent Instructions

This directory is the core relationship-memory system.

Architecture boundaries:

- `eventMapper.ts` maps contact detection time to calendar context deterministically.
- `repository.ts` owns in-memory persistence boundaries.
- `tools.ts` exposes small deterministic actions for the agent.
- `agentCore.ts` is the current deterministic router.
- `interpretation.ts` is the contract for LLM-to-JSON interpretation.
- `interpretedAgent.ts` enriches validated interpretations with recent conversation context before deterministic tools execute.
- `temporalContext.ts` owns chrono-node date parsing; do not hand-roll relative-date rules in agent code.
- `transports/` adapts communication surfaces and should not own product logic.

Rules:

- Do not let an LLM write memories directly. The model may interpret; deterministic tools execute.
- Preserve raw inbound text and interpretation/log metadata when adding logging.
- Keep user-facing replies short enough for iMessage.
- Never pretend certainty when search results are ambiguous.
- Add tests for realistic messy user messages, not only ideal command syntax.

Useful test targets:

```bash
npm test -- src/relationship/agentCore.test.ts
npm test -- src/relationship/interpretedAgent.test.ts
npm test -- src/relationship/interpretation.test.ts
npm test -- src/relationship/temporalContext.test.ts
npm test -- src/relationship/tools.test.ts
```
