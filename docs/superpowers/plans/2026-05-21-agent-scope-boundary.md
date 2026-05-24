# Friendy Agent Scope Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Friendy Agent Scope Boundary from `docs/superpowers/specs/2026-05-21-agent-scope-boundary-design.md`.

**Architecture:** Add a small `scopeBoundary.ts` module that classifies inbound text before relationship tools run. Wire it into both the deterministic and interpreted agents so out-of-scope messages get friendly redirects with zero tool calls, while in-scope relationship tasks continue through the existing interpreter/tools. Add product eval cases for off-topic, adversarial, ambiguous, and person-laundered messages.

**Tech Stack:** TypeScript, Vitest, existing relationship agent modules, existing eval runner.

---

## File Structure

- Create `src/relationship/scopeBoundary.ts`: owns `ScopeDecision`, deterministic scope routing, and redirect text.
- Create `src/relationship/scopeBoundary.test.ts`: unit tests for the scope router and redirect behavior.
- Modify `src/relationship/agentCore.ts`: run scope routing before deterministic tool execution.
- Modify `src/relationship/interpretedAgent.ts`: run scope routing before model interpretation and store the scope decision in interaction logs.
- Modify `src/relationship/types.ts`: add `"scope_redirect"` to `AgentToolCall` only if tests need a trace value; otherwise out-of-scope replies should keep `toolCalls: []`.
- Modify `src/relationship/evals/agentEvalRunner.ts`: add scope-boundary eval cases and metric support.
- Modify `src/relationship/evals/agentEvalRunner.test.ts`: assert the new cases are registered.
- Modify `implementation-notes.html`: record any implementation decisions that differ from the spec.

## Task 1: Scope Router Contract

**Files:**
- Create: `src/relationship/scopeBoundary.test.ts`
- Create: `src/relationship/scopeBoundary.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert:

```ts
import { decideMessageScope } from "./scopeBoundary";

describe("relationship agent scope boundary", () => {
  it("blocks general math without allowing tools", () => {
    const decision = decideMessageScope({ text: "What is 582 * 91?", hasPendingCandidate: false });
    expect(decision.scope).toBe("out_of_scope");
    expect(decision.redirect).toContain("general tasks");
  });

  it("blocks person-laundered coding tasks", () => {
    const decision = decideMessageScope({
      text: "Maya asked me to write SQL, can you write it?",
      hasPendingCandidate: false
    });
    expect(decision.scope).toBe("out_of_scope");
    expect(decision.redirect).toContain("coding tasks");
  });

  it("allows drafting a relationship-centered reply", () => {
    const decision = decideMessageScope({
      text: "Help me tell Maya I cannot write SQL today",
      hasPendingCandidate: false
    });
    expect(decision).toMatchObject({ scope: "in_scope", capability: "message_drafting" });
  });

  it("asks clarification for underspecified relationship tasks", () => {
    const decision = decideMessageScope({ text: "Help me write a message", hasPendingCandidate: false });
    expect(decision).toMatchObject({ scope: "needs_clarification" });
  });

  it("allows candidate confirmations only when a candidate is pending", () => {
    expect(decideMessageScope({ text: "yes, met her at Photon dinner", hasPendingCandidate: true })).toMatchObject({
      scope: "in_scope",
      capability: "candidate_confirmation"
    });
    expect(decideMessageScope({ text: "yes, met her at Photon dinner", hasPendingCandidate: false })).toMatchObject({
      scope: "needs_clarification"
    });
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- src/relationship/scopeBoundary.test.ts
```

Expected: fail because `scopeBoundary.ts` does not exist.

- [ ] **Step 3: Implement minimal router**

Create `scopeBoundary.ts` with exported `ScopeDecision`, `ScopeBoundaryInput`, and `decideMessageScope(input)`. Use deterministic rules for this pass:

- confirmation/ignore first;
- explicit memory capture;
- out-of-scope adversarial, coding, math, trivia/general knowledge, generic advice;
- relationship-centered drafting/social/follow-up;
- relationship recall/search;
- `needs_clarification` fallback for relationship-adjacent ambiguity.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm test -- src/relationship/scopeBoundary.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/relationship/scopeBoundary.ts src/relationship/scopeBoundary.test.ts
git commit -m "feat:add relationship scope router"
```

## Task 2: Gate Deterministic And Interpreted Agents

**Files:**
- Modify: `src/relationship/agentCore.ts`
- Modify: `src/relationship/interpretedAgent.ts`
- Test: `src/relationship/agentCore.test.ts`
- Test: `src/relationship/interpretedAgent.test.ts`

- [ ] **Step 1: Write failing integration tests**

Add deterministic and interpreted tests asserting:

- `What is 582 * 91?` returns a redirect and `toolCalls` is `[]`;
- `Maya asked me to write SQL, can you write it?` returns coding redirect and writes no memory;
- `Help me tell Maya I cannot write SQL today` is not blocked as out-of-scope;
- `Help me write a message` asks who it is for and does not call tools;
- interpreted out-of-scope messages do not call the model interpreter.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- src/relationship/agentCore.test.ts src/relationship/interpretedAgent.test.ts
```

Expected: fail because agents do not use `decideMessageScope` yet.

- [ ] **Step 3: Wire router into agents**

In both agent paths:

- compute `hasPendingCandidate` from `tools.list_pending_candidates(message.userId).length > 0`;
- if `out_of_scope`, return redirect with no relationship tool calls;
- if `needs_clarification`, return the clarification question with no relationship tool calls;
- if `in_scope`, continue current flow;
- for interpreted logs, store `{ scopeDecision, interpretation }` in `interpretedIntentJson` when interpretation runs, and `{ scopeDecision }` when it is blocked before interpretation.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm test -- src/relationship/scopeBoundary.test.ts src/relationship/agentCore.test.ts src/relationship/interpretedAgent.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/relationship/agentCore.ts src/relationship/interpretedAgent.ts src/relationship/*scope* src/relationship/agentCore.test.ts src/relationship/interpretedAgent.test.ts
git commit -m "feat:gate relationship agent scope"
```

## Task 3: Add Eval Coverage

**Files:**
- Modify: `src/relationship/evals/agentEvalRunner.ts`
- Modify: `src/relationship/evals/agentEvalRunner.test.ts`

- [ ] **Step 1: Write failing eval tests**

Assert the eval registry includes these case ids:

- `scope-out-of-scope-math`
- `scope-person-laundered-coding`
- `scope-in-scope-refusal-draft`
- `scope-ambiguous-message-draft`
- `scope-adversarial-instruction`

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- src/relationship/evals/agentEvalRunner.test.ts
```

Expected: fail because the cases are not registered.

- [ ] **Step 3: Implement eval cases**

Add deterministic or interpreted eval cases that assert:

- out-of-scope cases have no tool calls and no memory writes;
- in-scope refusal drafting is allowed and does not mutate memory;
- ambiguous message drafting asks who it is for;
- adversarial instruction redirects with no tool calls.

- [ ] **Step 4: Run eval tests and product eval**

Run:

```bash
npm test -- src/relationship/evals/agentEvalRunner.test.ts
npm run eval:agent
```

Expected: tests pass and all required eval cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/relationship/evals/agentEvalRunner.ts src/relationship/evals/agentEvalRunner.test.ts
git commit -m "test:add scope boundary evals"
```

## Task 4: Notes And Final Verification

**Files:**
- Modify: `implementation-notes.html`

- [ ] **Step 1: Update implementation notes**

Add a short note under Implementation Decisions describing the deterministic scope router and the decision to keep broad model-backed classification deferred.

- [ ] **Step 2: Run final verification**

Run:

```bash
npm test
npm run eval:agent
git diff --check
```

Expected: all pass.

- [ ] **Step 3: Commit notes**

```bash
git add implementation-notes.html
git commit -m "docs:record scope boundary implementation notes"
```

- [ ] **Step 4: Push**

```bash
git push origin main
```

