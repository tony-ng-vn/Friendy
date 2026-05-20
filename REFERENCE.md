# Friendy Reference

This file is the repo map for coding agents. Read it before broad edits so you can jump to the right context instead of rediscovering the project structure.

## Product Snapshot

Friendy is a relationship memory agent for remembering and refinding people met at events. Spectrum/iMessage is the first communication surface, but the product identity is the relationship agent and memory system.

Current architecture direction:

```text
Transport message
-> normalized InboundAgentMessage
-> message interpretation
-> conversation context enrichment
-> deterministic relationship tools
-> deterministic response composition
-> memory repository
-> logged response
```

## Start Here By Task

- Product understanding: `docs/product-spec.md`, `docs/demo-plan.md`, `docs/handoff.md`
- Agent navigation structure: `docs/agent-navigation.md`
- Goal queue: `docs/goals/README.md`
- Goal-writing rules: `docs/goals/goal-writing-guide.md`
- Current field-aware search goal: `docs/goals/field-aware-memory-search-goal.md`
- Superpowers specs and plans: `docs/superpowers/README.md`
- Implementation decisions and verification history: `implementation-notes.html`
- Relationship-agent source: `src/relationship/`
- Existing UI/demo shell: `src/App.tsx`, `src/agent.ts`, `src/memoryStore.ts`, `src/mockData.ts`
- Spectrum/iMessage adapter: `src/relationship/transports/spectrumTransport.ts`
- Terminal smoke demo: `src/relationship/transports/terminalTransport.ts`

## Source Map

- `src/relationship/types.ts`: shared domain and agent message types.
- `src/relationship/fixtures.ts`: deterministic demo user, events, detected contacts, and ambiguous memories.
- `src/relationship/eventMapper.ts`: deterministic contact-to-calendar matching.
- `src/relationship/repository.ts`: in-memory repository boundary for candidates, memories, events, and future logs.
- `src/relationship/tools.ts`: bounded tool API used by the agent, including deterministic field-aware memory search.
- `src/relationship/responseComposer.ts`: deterministic user-facing wording for save/search/no-match/clarify/ignore replies.
- `src/relationship/agentCore.ts`: current deterministic relationship-agent router.
- `src/relationship/env.ts`: local env loading for standalone `tsx` scripts.
- `src/relationship/interpretation.ts`: LLM interpretation contract.
- `src/relationship/interpretedAgent.ts`: interpreted execution wrapper with conversation-context carryover.
- `src/relationship/temporalContext.ts`: chrono-node natural-language date parsing.
- `src/relationship/openRouterInterpreter.ts`: OpenRouter structured-output interpreter and deterministic fallback.
- `src/relationship/transports/`: communication adapters; product logic should live above this layer.

## Commands

```bash
npm test
npm run build
npm run agent:terminal -- "yes, recruiting agents, played piano"
npm run agent:spectrum
```

Use targeted tests while developing:

```bash
npm test -- src/relationship/agentCore.test.ts
npm test -- src/relationship/interpretedAgent.test.ts
npm test -- src/relationship/responseComposer.test.ts
npm test -- src/relationship/interpretation.test.ts
npm test -- src/relationship/temporalContext.test.ts
```

## Environment

Local agent scripts read `.env.local` and `.env`.

Required for Spectrum:

```bash
SPECTRUM_PROJECT_ID=
SPECTRUM_PROJECT_SECRET=
FRIENDY_AGENT_NUMBER=+14156056081
```

OpenRouter interpreter:

```bash
OPENROUTER_API_KEY=
OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free
```

Never commit secrets.

## Research Basis For Agent Navigation

See `docs/agent-navigation.md` for the full source-backed rationale.

- OpenAI Codex supports repo instructions through `AGENTS.md` and nested instruction files: https://developers.openai.com/codex/guides/agents-md
- Anthropic recommends concise, specific project memory and local scoping for narrower instructions: https://docs.anthropic.com/en/docs/claude-code/memory
- Anthropic's context-engineering guidance supports high-signal context plus just-in-time retrieval through lightweight identifiers: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- "Lost in the Middle" supports the caution that longer context is not automatically better for retrieval: https://arxiv.org/abs/2307.03172
- Recent AGENTS.md studies support using context files carefully and keeping unnecessary requirements out of always-loaded instructions: https://arxiv.org/abs/2510.21413 and https://arxiv.org/abs/2602.11988

## Current Caution

Inspect `git status --short --branch` before editing and do not revert unrelated work. Active goal-mode work may update `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, and `docs/goals/EXPERIMENT_NOTES.md`.
