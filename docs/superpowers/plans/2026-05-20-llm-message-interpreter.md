# LLM Message Interpreter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an LLM-backed interpretation layer that turns arbitrary user text into validated Friendy intents before deterministic tools write/search memory.

**Architecture:** Keep the existing relationship tools and repository as the source of truth. Add a transport-agnostic interpreter contract, OpenRouter structured-output client, deterministic fallback interpreter, async interpreted agent wrapper, and interaction logging. Wire Spectrum to the interpreted agent while preserving the existing terminal product flow.

**Tech Stack:** TypeScript, Vitest, `zod` for runtime validation, Fetch API for OpenRouter, existing `spectrum-ts` transport.

---

## File Structure

- Create `src/relationship/interpretation.ts`: interpretation types, Zod schema, JSON schema, validation helper, query builder.
- Create `src/relationship/interpretation.test.ts`: schema and helper tests for Amaya/Zhiyuan/search examples.
- Create `src/relationship/openRouterInterpreter.ts`: OpenRouter structured-output interpreter and fallback handling.
- Create `src/relationship/openRouterInterpreter.test.ts`: request-body, valid response, invalid response, and fallback tests with fake fetch.
- Create `src/relationship/interpretedAgent.ts`: async agent wrapper that executes validated interpretations through existing tools and logs interactions.
- Create `src/relationship/interpretedAgent.test.ts`: capture/search/logging tests.
- Modify `src/relationship/types.ts`: extend `AgentInteraction` with interpretation/model/latency/error fields.
- Modify `src/relationship/repository.ts`: store and list interaction logs.
- Modify `src/relationship/repository.test.ts`: verify interaction logs are stored.
- Modify `src/relationship/env.ts` and `.env.example`: add OpenRouter env support.
- Modify `src/relationship/transports/spectrumTransport.ts`: use interpreted agent and console log interaction records.
- Modify `src/relationship/transports/spectrumTransport.test.ts`: verify the normalized transport still works and interpreter env wiring is isolated.
- Modify `README.md`: document `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and natural-message testing.
- Modify `implementation-notes.html`: record interpreter architecture and verification.
- Modify `package.json` / `package-lock.json`: add `zod`.

## Task 1: Interpretation Contract

**Files:**
- Create: `src/relationship/interpretation.ts`
- Create: `src/relationship/interpretation.test.ts`

- [ ] Write failing tests for `validateMessageInterpretation`, `buildSearchQueryFromInterpretation`, and the Amaya/Zhiyuan/search interpretation examples.
- [ ] Run `npm test -- src/relationship/interpretation.test.ts` and confirm it fails because the module is missing.
- [ ] Implement the Zod schema, TypeScript type, JSON schema, validation helper, and search-query helper.
- [ ] Re-run `npm test -- src/relationship/interpretation.test.ts` and confirm it passes.
- [ ] Commit with `feat:add message interpretation contract`.

## Task 2: Repository Interaction Logging

**Files:**
- Modify: `src/relationship/types.ts`
- Modify: `src/relationship/repository.ts`
- Modify: `src/relationship/repository.test.ts`

- [ ] Write a failing repository test that adds and lists an `AgentInteraction` containing `interpretedIntentJson`, `modelUsed`, `confidence`, and `latencyMs`.
- [ ] Run `npm test -- src/relationship/repository.test.ts` and confirm it fails because logging methods/fields are missing.
- [ ] Extend `AgentInteraction` and add `addInteraction` / `listInteractions` to the repository.
- [ ] Re-run `npm test -- src/relationship/repository.test.ts` and confirm it passes.
- [ ] Commit with `feat:add relationship agent interaction logs`.

## Task 3: OpenRouter Interpreter

**Files:**
- Create: `src/relationship/openRouterInterpreter.ts`
- Create: `src/relationship/openRouterInterpreter.test.ts`
- Modify: `src/relationship/env.ts`
- Modify: `.env.example`
- Modify: `package.json`

- [ ] Install `zod` with `npm install zod`.
- [ ] Write failing tests with a fake `fetch` proving the request uses `response_format.type = "json_schema"`, `strict = true`, `provider.require_parameters = true`, and the configured model.
- [ ] Add tests for valid response parsing and invalid response fallback.
- [ ] Run `npm test -- src/relationship/openRouterInterpreter.test.ts` and confirm it fails because the module is missing.
- [ ] Implement `createOpenRouterInterpreter`, `createRuleBasedInterpreter`, `readOpenRouterConfig`, and default model `nvidia/nemotron-3-super-120b-a12b:free`.
- [ ] Re-run `npm test -- src/relationship/openRouterInterpreter.test.ts src/relationship/env.test.ts`.
- [ ] Commit with `feat:add openrouter message interpreter`.

## Task 4: Interpreted Agent Execution

**Files:**
- Create: `src/relationship/interpretedAgent.ts`
- Create: `src/relationship/interpretedAgent.test.ts`
- Modify: `src/relationship/tools.ts` if search stopwords need tightening.
- Modify: `src/relationship/tools.test.ts` if search behavior changes.

- [ ] Write failing tests proving capture of the Amaya and Zhiyuan messages creates memories rather than searches.
- [ ] Write a failing test proving `Who I have met at the Residency?` returns multiple event matches when multiple memories match.
- [ ] Write a failing test proving every interpreted turn is logged.
- [ ] Run `npm test -- src/relationship/interpretedAgent.test.ts` and confirm it fails because the module is missing.
- [ ] Implement `createInterpretedRelationshipAgent` with deterministic tool execution and logging.
- [ ] Tighten search stopwords only if needed to make interpreted search useful.
- [ ] Re-run interpreted-agent and tools tests.
- [ ] Commit with `feat:add interpreted relationship agent`.

## Task 5: Spectrum Transport Wiring

**Files:**
- Modify: `src/relationship/transports/spectrumTransport.ts`
- Modify: `src/relationship/transports/spectrumTransport.test.ts`
- Modify: `README.md`
- Modify: `implementation-notes.html`

- [ ] Write/update tests proving Spectrum message normalization remains transport-only and does not need raw parser behavior.
- [ ] Wire Spectrum to build an interpreter from env, create the interpreted agent, await `handleMessage`, reply with its outbound text, and print a compact interaction log line.
- [ ] Update README with OpenRouter env variables and live test examples.
- [ ] Update implementation notes with the LLM-interpreter decision.
- [ ] Run `npm test -- src/relationship/transports/spectrumTransport.test.ts src/relationship/interpretedAgent.test.ts`.
- [ ] Commit with `feat:wire spectrum through interpreted agent`.

## Task 6: Final Verification And Merge

**Files:**
- All touched files.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run agent:terminal -- "I met Amaya at Photon Residency II, and me and him sleep on the same bed cuz we ran out of bed :("`.
- [ ] Run `git diff --check`.
- [ ] Commit any verification note updates with `docs:record llm interpreter verification`.
- [ ] Merge the feature branch into `main` using fast-forward if possible.
- [ ] Re-run `npm test` and `npm run build` on `main`.
- [ ] Push `main`.

## Self-Review

- Spec coverage: The plan covers interpretation schema, OpenRouter structured outputs, fallback, deterministic execution, logs, Spectrum wiring, docs, and verification.
- Placeholder scan: No task contains unresolved placeholder markers.
- Type consistency: `MessageInterpretation`, `AgentInteraction`, and `createInterpretedRelationshipAgent` names are used consistently across tasks.
