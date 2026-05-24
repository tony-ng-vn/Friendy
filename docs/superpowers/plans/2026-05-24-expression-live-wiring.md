# Expression Live Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Friendy's existing grounded expression layer into the live interpreted agent so eligible replies can become more natural without changing deterministic facts or tool behavior.

**Architecture:** Deterministic tools and response composers still produce the authoritative draft. A new optional expression dependency can rewrite eligible drafts from a fact bundle, then validation/fallback returns either the polished text or the original draft. The feature is disabled by default through `FRIENDY_EXPRESSION_LLM`, so local evals remain stable unless explicitly configured.

**Tech Stack:** TypeScript, Vitest, existing `interpretedAgent.ts`, `expressionBundleFactory.ts`, `expressionComposer.ts`, OpenAI-compatible fake fetch tests.

---

### Task 1: Add Live Agent Expression Dependency

**Files:**
- Modify: `src/relationship/interpretedAgent.ts`
- Test: `src/relationship/interpretedAgent.test.ts`

- [x] **Step 1: Write RED tests**

Add tests proving:
- when `expressionComposer.polishOutboundText` is injected and enabled for a save confirmation, the outbound text uses the polished message;
- when expression validation/fetch fails, the original deterministic draft is returned;
- tool calls and memory writes are unchanged.

Run:

```bash
npm test -- src/relationship/interpretedAgent.test.ts -t "expression"
```

Expected: FAIL because `createInterpretedRelationshipAgent` does not accept or call an expression composer yet.

- [x] **Step 2: Add typed optional dependency**

Add a minimal `expression?: { polishOutboundText(...) }` option to `InterpretedRelationshipAgentOptions`. Do not instantiate model clients inside tests; default runtime can call the existing `polishOutboundText`.

- [x] **Step 3: Wrap eligible drafts**

After deterministic execution creates a draft, build an `ExpressionFactBundle` for supported reply kinds and call the expression dependency. Supported first slice:
- `save_confirmation`
- `search_single_match`
- `search_ambiguous_matches`
- `search_no_match`
- `clarification`
- `pending_contact_explanation`
- `conversation_repair`
- `explain_agent_state`

Unsupported replies keep deterministic text.

- [x] **Step 4: Preserve traceability**

Persist expression metadata in `interpretedIntentJson`, including:
- `expressionUsed`
- `expressionValidationPassed`
- `expressionFallbackReason`
- `expressionModel`

Do not place raw fact bundle JSON into user-facing text.

- [x] **Step 5: Verify GREEN**

Run:

```bash
npm test -- src/relationship/interpretedAgent.test.ts -t "expression"
npm test -- src/relationship/expressionComposer.test.ts src/relationship/expressionBundleFactory.test.ts src/relationship/expressionValidator.test.ts
```

Expected: PASS.

### Task 2: Wire Spectrum Runtime Config

**Files:**
- Modify: `src/relationship/transports/spectrumTransport.ts`
- Test: `src/relationship/transports/spectrumTransport.test.ts`

- [x] **Step 1: Write RED test**

Add a runtime test that injects an expression composer into `createSpectrumFriendyRuntime`, handles a message that saves memory, and proves `replyText` is the polished text while the compact log still reports the original tool calls.

Run:

```bash
npm test -- src/relationship/transports/spectrumTransport.test.ts -t "expression"
```

Expected: FAIL because the transport does not pass expression dependencies to the agent.

- [x] **Step 2: Pass expression option through**

Add `expression` to `SpectrumRuntimeOptions` and `StartSpectrumFriendyAgentOptions`, then pass it into `createInterpretedRelationshipAgent`. Production defaults use the existing expression composer with env-based disabled-by-default config.

- [x] **Step 3: Verify GREEN**

Run:

```bash
npm test -- src/relationship/transports/spectrumTransport.test.ts -t "expression"
```

Expected: PASS.

### Task 3: Documentation And Verification

**Files:**
- Modify: `docs/agent-handoff.md`
- Modify: `docs/goals/relationship-agent-response-composer-goal.md`
- Modify: `implementation-notes.html`

- [x] **Step 1: Update handoff artifacts**

Record that the expression layer is now wired into live interpreted/Spectrum flows, remains disabled by default, and falls back to deterministic drafts.

- [x] **Step 2: Run verification**

Run:

```bash
npm test -- src/relationship/interpretedAgent.test.ts src/relationship/transports/spectrumTransport.test.ts src/relationship/expressionComposer.test.ts src/relationship/expressionBundleFactory.test.ts src/relationship/expressionValidator.test.ts
npm run eval:agent
npm run build
git diff --check
```

Expected: all pass. Do not commit unless the user explicitly asks.
