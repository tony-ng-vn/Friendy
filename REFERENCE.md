# Friendy Reference

This file is the repo map for coding agents. Read it before broad edits so you can jump to the right context instead of rediscovering the project structure.

## Product Snapshot

Friendy is a relationship memory agent for remembering and refinding people met at events. Spectrum/iMessage is the first communication surface, but the product identity is the relationship agent and memory system.

Current architecture direction:

```text
Transport message
-> normalized InboundAgentMessage
-> message interpretation
-> deterministic relationship tools
-> memory repository
-> logged response
```

## Start Here By Task

- Product understanding: `docs/product-spec.md`, `docs/demo-plan.md`, `docs/handoff.md`
- Current LLM interpreter goal: `docs/goals/llm-message-interpreter-goal.md`
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
- `src/relationship/tools.ts`: bounded tool API used by the agent.
- `src/relationship/agentCore.ts`: current deterministic relationship-agent router.
- `src/relationship/env.ts`: local env loading for standalone `tsx` scripts.
- `src/relationship/interpretation.ts`: in-progress LLM interpretation contract.
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
npm test -- src/relationship/interpretation.test.ts
```

## Environment

Local agent scripts read `.env.local` and `.env`.

Required for Spectrum:

```bash
SPECTRUM_PROJECT_ID=
SPECTRUM_PROJECT_SECRET=
FRIENDY_AGENT_NUMBER=+14156056081
```

Planned for OpenRouter interpreter:

```bash
OPENROUTER_API_KEY=
OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free
```

Never commit secrets.

## Research Basis For Agent Navigation

- OpenAI Codex supports repo instructions through `AGENTS.md`, and scoped files help keep guidance close to the code they govern: https://developers.openai.com/codex/guides/agents-md
- Anthropic's Claude Code memory guidance uses project memory files as persistent context and recommends keeping them concise and specific: https://docs.anthropic.com/en/docs/claude-code/memory
- Anthropic's agent engineering guidance emphasizes simple composable workflows, clear tool boundaries, and explicit evaluation loops over overcomplicated agent systems: https://www.anthropic.com/engineering/building-effective-agents
- The “Lost in the Middle” paper shows long contexts can degrade retrieval of relevant information, which supports short scoped files and index maps instead of one huge instruction file: https://arxiv.org/abs/2307.03172
- Recent context-engineering work frames context selection/organization as a core system-design problem for LLM agents, which supports `REFERENCE.md` as a routing index rather than dumping everything into prompts: https://arxiv.org/abs/2507.13334

## Current Caution

There may be active WIP on `feature/llm-message-interpreter`. Inspect `git status --short --branch` before editing and do not revert unrelated work.
