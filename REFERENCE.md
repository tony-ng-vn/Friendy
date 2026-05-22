# Friendy Reference

This file is the repo map for coding agents. Read it before broad edits so you can jump to the right context instead of rediscovering the project structure.

## Product Snapshot

Friendy is a relationship memory agent for remembering and refinding people met at events. Spectrum/iMessage is the first communication surface, but the product identity is the relationship agent and memory system.

Current architecture direction:

```text
Detected contact delta
-> event-window matching
-> pending verification queue
-> user confirmation or ignore
-> searchable relationship memory

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

- Product understanding: `docs/product-spec.md`, `docs/product-flow-plan.md`, `docs/handoff.md`
- AI system architecture: `docs/ai-system-architecture.md`
- Agent navigation structure: `docs/agent-navigation.md`
- Goal queue: `docs/goals/README.md`
- Goal-writing rules: `docs/goals/goal-writing-guide.md`
- Current Mac-only MVP behavior spec: `docs/superpowers/specs/friendy-mac-only-mvp-onboarding-agent-behavior-design-finished.md`
- Current Mac-only MVP implementation plan: `docs/superpowers/plans/2026-05-22-mac-only-mvp-final-implementation.md`
- Current Mac-only MVP goal prompts: `docs/goals/mac-mvp-final-goal-runbook.md`
- Mac MVP live E2E (Option B) goal: `docs/goals/mac-mvp-e2e-contact-detection-goal.md`
- Completed iMessage contact confirmation goal: `docs/goals/imessage-contact-confirmation-loop-goal.md`
- Completed local macOS checker goal: `docs/goals/local-macos-contact-calendar-checker-goal.md`
- Current system audit: `docs/reviews/current-system-audit.md`
- Superpowers specs and plans: `docs/superpowers/README.md`
- Implementation decisions and verification history: `implementation-notes.html`
- Relationship-agent source: `src/relationship/`
- Legacy local web shell: `src/App.tsx`, `src/agent.ts`, `src/memoryStore.ts`, `src/mockData.ts`
- Spectrum/iMessage adapter: `src/relationship/transports/spectrumTransport.ts`
- Terminal smoke product flow: `src/relationship/transports/terminalTransport.ts`

## Source Map

- `src/relationship/types.ts`: shared domain and agent message types.
- `src/relationship/fixtures.ts`: deterministic product flow user, events, detected contacts, and ambiguous memories.
- `src/relationship/eventMapper.ts`: deterministic contact-to-calendar matching.
- `src/relationship/repository.ts`: in-memory repository boundary for candidates, memories, events, and future logs.
- `src/relationship/candidateConfirmation.ts`: deterministic consent-reply parsing for pending contact candidates, including corrected event context.
- `src/relationship/tools.ts`: bounded tool API used by the agent, including deterministic field-aware memory search.
- `src/relationship/responseComposer.ts`: deterministic user-facing wording for save/search/no-match/clarify/ignore replies.
- `src/relationship/agentCore.ts`: current deterministic relationship-agent router.
- `src/relationship/env.ts`: local env loading for standalone `tsx` scripts.
- `src/relationship/interpretation.ts`: LLM interpretation contract.
- `src/relationship/interpretedAgent.ts`: interpreted execution wrapper with conversation-context carryover.
- `src/relationship/temporalContext.ts`: chrono-node natural-language date parsing.
- `src/relationship/openRouterInterpreter.ts`: OpenRouter structured-output interpreter and deterministic fallback.
- `src/relationship/ingestion/`: fixture contact snapshot diffing, fixture calendar provider, and ingestion product flow pipeline.
- `src/relationship/ingestion/localMacAdapters.ts`: explicit macOS Contacts/Calendar adapters, parser helpers, and non-macOS guards.
- `src/relationship/ingestion/localCheck.ts`: provider-neutral local contact/calendar checker that creates candidates and confirmation prompts.
- `src/relationship/ingestion/localCheckCli.ts`: `npm run ingest:local:check` entry point, state file handling, dry-run default, and guarded live Spectrum sender.
- `src/relationship/contacts/`: explicit macOS Contacts smoke command for `Friendy-<number>` test contacts only.
- `src/relationship/evals/`: trajectory eval runner and CLI for deterministic agent behavior checks.
- `src/relationship/evals/macMvpDemoCheck.ts`: deterministic Mac MVP demo check for phone-verified/start/contact-prompt/save/recall/update.
- `src/relationship/runtime/friendyDoctor.ts`: structured local runtime readiness check for Node, env, SQLite, sensor state, prompt transport, sensor binary/mock mode, and native permission availability.
- `src/relationship/runtime/friendyRuntimeCli.ts`: canonical foreground Mac MVP runtime entry point.
- `src/relationship/transports/`: communication adapters and deterministic iMessage E2E product flow; product logic should live above this layer.

## Commands

```bash
npm test
npm run build
npm run agent:terminal -- "yes, recruiting agents, played piano"
npm run eval:agent
npm run check:mac-mvp-demo
npm run check:imessage-e2e
npm run ingest:check
npm run ingest:local:check -- --mock
npm run doctor:friendy
npm run agent:friendy
npm run agent:spectrum
```

Optional macOS Contacts smoke command:

```bash
npm run ingest:contacts:smoke -- --name Friendy-001
```

This command is explicit, accepts only `Friendy-<number>` names, and must not run from tests, build, evals, or `ingest:check`.

Explicit local Contacts/Calendar checker:

```bash
npm run ingest:local:check -- --mock
npm run ingest:local:check
```

The mock mode is deterministic and safe for non-macOS verification. The real mode reads macOS Contacts and Calendar only when the command is invoked, stores local snapshot state in `.friendy/local-contact-snapshot.json`, and defaults to printing the Friendy confirmation prompt instead of sending a live message.

Use targeted tests while developing:

```bash
npm test -- src/relationship/agentCore.test.ts
npm test -- src/relationship/interpretedAgent.test.ts
npm test -- src/relationship/responseComposer.test.ts
npm test -- src/relationship/interpretation.test.ts
npm test -- src/relationship/temporalContext.test.ts
npm test -- src/relationship/evals/agentEvalRunner.test.ts
npm test -- src/relationship/evals/macMvpDemoCheck.test.ts
npm test -- src/relationship/transports/spectrumTransport.test.ts
npm test -- src/relationship/transports/imessageE2eFlow.test.ts
npm test -- src/relationship/candidateConfirmation.test.ts
npm test -- src/relationship/ingestion/contactSnapshot.test.ts
npm test -- src/relationship/ingestion/ingestionPipeline.test.ts
npm test -- src/relationship/ingestion/localMacAdapters.test.ts
npm test -- src/relationship/ingestion/localCheck.test.ts
npm test -- src/relationship/contacts/contactsSmoke.test.ts
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

Local checker:

```bash
FRIENDY_LOCAL_USER_ID=
FRIENDY_LOCAL_CHECK_SEND=1
FRIENDY_LOCAL_CHECK_TO_PHONE=
FRIENDY_OWNER_PHONE=
```

`FRIENDY_LOCAL_CHECK_SEND=1` is required before the local checker sends a live Spectrum/iMessage prompt. Without it, the command stays in dry-run mode.

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
