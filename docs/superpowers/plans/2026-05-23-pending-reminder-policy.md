# Pending Reminder Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Friendy's inline pending-contact reminder append with a deterministic policy and footer composer that suppresses confusing reminders, rate-limits repeat reminders, and records trace decisions.

**Architecture:** Add a pure `pendingReminderPolicy.ts` module that consumes a bounded per-turn context and returns `suppress`, `defer`, or `append`. `interpretedAgent.ts` remains responsible for gathering state, composing the primary response, calling policy, updating process-local reminder state, and attaching trace fields.

**Tech Stack:** TypeScript, Vitest, existing Friendy interpreted agent, route policy validator, response composer, eval runner, process-local conversation context.

---

## File Structure

- Create: `src/relationship/pendingReminderPolicy.ts`
  - Owns `PendingReminderContext`, `PendingReminderDecision`, `PendingReminderState`, `decidePendingReminder`, and constants.
- Create: `src/relationship/pendingReminderPolicy.test.ts`
  - Table-driven tests for intent suppression, response-kind suppression, same-name disambiguation, complaint cooldown, TTL defer, and append.
- Modify: `src/relationship/responseComposer.ts`
  - Add `composePendingContactsFooter`.
  - Keep `composePendingContactReminder` only for compatibility until tests migrate.
- Modify: `src/relationship/responseComposer.test.ts`
  - Footer formatting tests.
- Modify: `src/relationship/trace.ts`
  - Add `pendingReminderDecision` and `pendingReminderReason`.
  - Keep `suppressedPendingReminder` as compatibility projection.
- Modify: `src/relationship/interpretedAgent.ts`
  - Add `reminderState` to process-local `ConversationContext`.
  - Remove inline `composePendingContactReminder` append.
  - Build `PendingReminderContext` after primary response and call policy.
- Modify: `src/relationship/routePolicyValidator.ts`
  - Keep validation focused on route policy. Stop making append/defer decisions there.
  - Keep `suppressPendingReminder` only as compatibility until trace migration is complete.
- Modify: `src/relationship/evals/agentEvalRunner.ts`
  - Add PR 5 eval cases for search footer, same-name suppression, repair suppression, TTL defer, and list no-footer.
- Modify: `src/relationship/evals/agentEvalRunner.test.ts`
  - Assert new eval catalog entries.
- Modify: `implementation-notes.html` and `docs/agent-handoff.md`
  - Record reminder policy decisions, trace migration, and verification.

## Task 1: Add Pure Pending Reminder Policy Tests

**Files:**
- Create: `src/relationship/pendingReminderPolicy.test.ts`
- Create: `src/relationship/pendingReminderPolicy.ts`

- [ ] **Step 1: Write failing policy tests**

Create `src/relationship/pendingReminderPolicy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decidePendingReminder, type PendingReminderContext } from "./pendingReminderPolicy";

const baseContext = (overrides: Partial<PendingReminderContext> = {}): PendingReminderContext => ({
  userText: "Who did I meet at Photon?",
  userIntent: "search_memory",
  searchMode: "event_recall",
  responseKind: "search_result",
  now: "2026-05-20T12:00:00.000Z",
  activeWorkflow: {
    kind: "pending_contact_confirmation",
    frameId: "frame_pending_contact_sarah",
    candidateId: "candidate_sarah",
    displayName: "Sarah Fan",
    lastFriendyPrompt: "I noticed you added Sarah Fan. Where did you meet them?"
  },
  pendingCandidates: [{ candidateId: "candidate_sarah", displayName: "Sarah Fan", status: "prompted" }],
  savedMemoriesForActiveName: [],
  duplicateRisk: false,
  sameNameDisambiguationPending: false,
  listedEntityIds: [],
  reminderState: {},
  ...overrides
});

describe("pending reminder policy", () => {
  it("suppresses list_people even when a pending contact exists", () => {
    expect(decidePendingReminder(baseContext({ userIntent: "list_people", responseKind: "list_people" }))).toMatchObject({
      action: "suppress",
      reason: "intent_suppressed"
    });
  });

  it("suppresses search_memory when search mode is list_people", () => {
    expect(decidePendingReminder(baseContext({ userIntent: "search_memory", searchMode: "list_people" }))).toMatchObject({
      action: "suppress",
      reason: "list_people_search_mode"
    });
  });

  it("suppresses same-name saved plus pending candidates until same-or-different is resolved", () => {
    expect(
      decidePendingReminder(
        baseContext({
          savedMemoriesForActiveName: [{ memoryId: "memory_testing_3", displayName: "Testing 3" }],
          activeWorkflow: {
            kind: "pending_contact_confirmation",
            frameId: "frame_pending_contact_testing_3",
            candidateId: "candidate_testing_3",
            displayName: "Testing 3",
            lastFriendyPrompt: "I noticed you added Testing 3. Where did you meet them?"
          },
          pendingCandidates: [{ candidateId: "candidate_testing_3", displayName: "Testing 3", status: "prompted" }],
          duplicateRisk: true,
          sameNameDisambiguationPending: true
        })
      )
    ).toMatchObject({ action: "suppress", reason: "same_name_disambiguation_pending" });
  });

  it("suppresses during complaint cooldown", () => {
    expect(
      decidePendingReminder(
        baseContext({
          reminderState: {
            lastUserComplaintAt: "2026-05-20T11:55:00.000Z"
          }
        })
      )
    ).toMatchObject({ action: "suppress", reason: "complaint_cooldown" });
  });

  it("defers repeated reminders for the same candidate within ttl", () => {
    expect(
      decidePendingReminder(
        baseContext({
          reminderState: {
            lastReminderAt: "2026-05-20T11:55:00.000Z",
            lastRemindedCandidateId: "candidate_sarah"
          }
        })
      )
    ).toMatchObject({ action: "defer", reason: "reminder_ttl" });
  });

  it("appends a footer for eligible search_memory replies", () => {
    expect(decidePendingReminder(baseContext())).toEqual({
      action: "append",
      reason: "eligible_search_interrupt",
      candidates: [{ candidateId: "candidate_sarah", displayName: "Sarah Fan" }]
    });
  });
});
```

- [ ] **Step 2: Add a minimal throwing module**

Create `src/relationship/pendingReminderPolicy.ts`:

```ts
import type { MessageInterpretation } from "./interpretation";

export type PendingReminderResponseKind =
  | "search_result"
  | "list_people"
  | "explain"
  | "repair"
  | "duplicate_audit"
  | "delete_confirm"
  | "capture_context"
  | "clarify"
  | "other";

export type SameOrDifferentResolution = {
  candidateId: string;
  resolvedAt: string;
  resolution: "same_person" | "different_person";
};

export type PendingReminderState = {
  lastReminderAt?: string;
  lastRemindedCandidateId?: string;
  lastUserComplaintAt?: string;
  sameOrDifferentResolutions?: SameOrDifferentResolution[];
};

export type PendingReminderContext = {
  userText: string;
  userIntent: MessageInterpretation["intent"];
  searchMode?: NonNullable<MessageInterpretation["search"]>["mode"];
  responseKind: PendingReminderResponseKind;
  now: string;
  activeWorkflow?: {
    kind: "pending_contact_confirmation";
    frameId: string;
    candidateId: string;
    displayName: string;
    lastFriendyPrompt: string;
  };
  pendingCandidates: Array<{ candidateId: string; displayName: string; status: string }>;
  savedMemoriesForActiveName: Array<{ memoryId: string; displayName: string }>;
  duplicateRisk: boolean;
  sameNameDisambiguationPending: boolean;
  listedEntityIds?: string[];
  reminderState: PendingReminderState;
};

export type PendingReminderDecision =
  | { action: "suppress"; reason: string }
  | { action: "defer"; reason: string }
  | { action: "append"; reason: string; candidates: Array<{ candidateId: string; displayName: string }> };

export function decidePendingReminder(_context: PendingReminderContext): PendingReminderDecision {
  throw new Error("decidePendingReminder not implemented");
}
```

- [ ] **Step 3: Run RED test**

```bash
npm test -- src/relationship/pendingReminderPolicy.test.ts
```

Expected: FAIL because `decidePendingReminder not implemented`.

- [ ] **Step 4: Commit RED tests**

```bash
git add src/relationship/pendingReminderPolicy.ts src/relationship/pendingReminderPolicy.test.ts
git commit -m "test:add pending reminder policy contract"
```

## Task 2: Implement Pending Reminder Policy

**Files:**
- Modify: `src/relationship/pendingReminderPolicy.ts`
- Test: `src/relationship/pendingReminderPolicy.test.ts`

- [ ] **Step 1: Implement the policy**

Replace `decidePendingReminder` with:

```ts
export const REMINDER_TTL_MS = 15 * 60 * 1000;
export const COMPLAINT_COOLDOWN_MS = 10 * 60 * 1000;

const NEVER_REMIND_INTENTS = new Set<MessageInterpretation["intent"]>([
  "list_people",
  "duplicate_audit",
  "delete_memory_request",
  "delete_memory",
  "update_memory",
  "explain_agent_state",
  "explain_pending_workflow",
  "conversation_repair",
  "clarify",
  "reject",
  "unknown",
  "ignore_candidate"
]);

const NEVER_REMIND_RESPONSE_KINDS = new Set<PendingReminderResponseKind>([
  "explain",
  "repair",
  "duplicate_audit",
  "delete_confirm",
  "clarify",
  "list_people"
]);

export function decidePendingReminder(context: PendingReminderContext): PendingReminderDecision {
  if (!context.activeWorkflow) {
    return { action: "suppress", reason: "no_active_workflow" };
  }

  if (NEVER_REMIND_INTENTS.has(context.userIntent)) {
    return { action: "suppress", reason: "intent_suppressed" };
  }

  if (context.userIntent === "search_memory" && context.searchMode === "list_people") {
    return { action: "suppress", reason: "list_people_search_mode" };
  }

  if (NEVER_REMIND_RESPONSE_KINDS.has(context.responseKind)) {
    return { action: "suppress", reason: "response_kind_suppressed" };
  }

  if (context.sameNameDisambiguationPending) {
    return { action: "suppress", reason: "same_name_disambiguation_pending" };
  }

  if (context.userIntent === "conversation_repair" || context.userIntent === "explain_agent_state") {
    return { action: "suppress", reason: "complaint_turn" };
  }

  if (withinMs(context.reminderState.lastUserComplaintAt, context.now, COMPLAINT_COOLDOWN_MS)) {
    return { action: "suppress", reason: "complaint_cooldown" };
  }

  if (
    context.reminderState.lastRemindedCandidateId === context.activeWorkflow.candidateId &&
    withinMs(context.reminderState.lastReminderAt, context.now, REMINDER_TTL_MS)
  ) {
    return { action: "defer", reason: "reminder_ttl" };
  }

  if (context.userIntent !== "search_memory") {
    return { action: "suppress", reason: "not_search_interrupt" };
  }

  const candidates = context.pendingCandidates
    .filter((candidate) => !context.listedEntityIds?.includes(candidate.candidateId))
    .slice(0, 3)
    .map((candidate) => ({ candidateId: candidate.candidateId, displayName: candidate.displayName }));

  if (candidates.length === 0) {
    return { action: "suppress", reason: "no_footer_candidates" };
  }

  return { action: "append", reason: "eligible_search_interrupt", candidates };
}

function withinMs(value: string | undefined, now: string, windowMs: number): boolean {
  if (!value) {
    return false;
  }

  const valueMs = Date.parse(value);
  const nowMs = Date.parse(now);
  if (Number.isNaN(valueMs) || Number.isNaN(nowMs)) {
    return false;
  }

  return nowMs - valueMs >= 0 && nowMs - valueMs < windowMs;
}
```

- [ ] **Step 2: Run policy tests**

```bash
npm test -- src/relationship/pendingReminderPolicy.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit policy implementation**

```bash
git add src/relationship/pendingReminderPolicy.ts src/relationship/pendingReminderPolicy.test.ts
git commit -m "feat:add pending reminder policy"
```

## Task 3: Add Footer Composer

**Files:**
- Modify: `src/relationship/responseComposer.ts`
- Modify: `src/relationship/responseComposer.test.ts`

- [ ] **Step 1: Write failing footer composer tests**

Add to `responseComposer.test.ts`:

```ts
it("formats a pending contacts footer with singular copy", () => {
  expect(
    composePendingContactsFooter({
      items: [{ displayName: "Sarah Fan" }]
    })
  ).toBe("Also, I still have 1 unsaved contact waiting for context:\n- Sarah Fan - what should I remember about them?");
});

it("formats a pending contacts footer with max three items and overflow", () => {
  expect(
    composePendingContactsFooter({
      items: [
        { displayName: "Testing 1" },
        { displayName: "Testing 2" },
        { displayName: "Testing 3" },
        { displayName: "Testing 4" }
      ]
    })
  ).toBe(
    [
      "Also, I still have 4 unsaved contacts waiting for context:",
      "- Testing 1 - what should I remember about them?",
      "- Testing 2 - what should I remember about them?",
      "- Testing 3 - what should I remember about them?",
      "and 1 more"
    ].join("\n")
  );
});
```

- [ ] **Step 2: Run RED test**

```bash
npm test -- src/relationship/responseComposer.test.ts
```

Expected: FAIL because `composePendingContactsFooter` is missing.

- [ ] **Step 3: Implement footer composer**

In `responseComposer.ts`, export:

```ts
type PendingContactsFooterInput = {
  items: Array<{ displayName: string; promptHint?: string }>;
};

export function composePendingContactsFooter({ items }: PendingContactsFooterInput): string {
  if (items.length === 0) {
    return "";
  }

  const visible = items.slice(0, 3);
  const hiddenCount = Math.max(0, items.length - visible.length);
  const header =
    items.length === 1
      ? "Also, I still have 1 unsaved contact waiting for context:"
      : `Also, I still have ${items.length} unsaved contacts waiting for context:`;
  const lines = visible.map((item) => `- ${item.displayName} - ${item.promptHint || "what should I remember about them?"}`);

  if (hiddenCount > 0) {
    lines.push(`and ${hiddenCount} more`);
  }

  return [header, ...lines].join("\n");
}
```

- [ ] **Step 4: Run composer tests**

```bash
npm test -- src/relationship/responseComposer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit composer**

```bash
git add src/relationship/responseComposer.ts src/relationship/responseComposer.test.ts
git commit -m "feat:add pending contacts footer composer"
```

## Task 4: Extend Trace Shape

**Files:**
- Modify: `src/relationship/trace.ts`
- Modify: `src/relationship/runtime/runtimeTrace.ts`
- Modify: `src/relationship/runtime/runtimeTrace.test.ts`
- Test: `src/relationship/runtime/runtimeTrace.test.ts`

- [ ] **Step 1: Write failing trace test**

Add to `runtimeTrace.test.ts`:

```ts
it("preserves pending reminder decision without private reminder text", () => {
  const trace = buildRedactedInteractionTrace({
    inboundText: "Who did I meet at Photon?",
    outboundText: "I found Sarah.",
    interpretedIntentJson: {},
    toolCalls: ["search_memories"],
    model: { used: true, provider: "openrouter", modelName: "test-model", fallbackUsed: false },
    friendyTrace: {
      strictMode: true,
      routeSource: "llm",
      fallbackUsed: false,
      policyDecision: "allow",
      pendingReminderDecision: "appended_footer",
      pendingReminderReason: "eligible_search_interrupt",
      suppressedPendingReminder: false,
      toolCalls: ["search_memories"]
    },
    now: "2026-05-20T12:00:00.000Z"
  });

  expect(trace.friendy?.pendingReminderDecision).toBe("appended_footer");
  expect(trace.friendy?.pendingReminderReason).toBe("eligible_search_interrupt");
});
```

- [ ] **Step 2: Run RED trace test**

```bash
npm test -- src/relationship/runtime/runtimeTrace.test.ts
```

Expected: FAIL because `FriendyTrace` and redacted trace do not expose the new fields.

- [ ] **Step 3: Add trace fields**

In `trace.ts`, update `FriendyTrace`:

```ts
pendingReminderDecision?: "suppressed" | "deferred" | "appended_footer";
pendingReminderReason?: string;
```

Update `createFriendyTrace` input and return object with the same fields.

In `runtimeTrace.ts`, include:

```ts
pendingReminderDecision: input.friendyTrace?.pendingReminderDecision,
pendingReminderReason: input.friendyTrace?.pendingReminderReason,
```

- [ ] **Step 4: Run trace tests**

```bash
npm test -- src/relationship/runtime/runtimeTrace.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit trace fields**

```bash
git add src/relationship/trace.ts src/relationship/runtime/runtimeTrace.ts src/relationship/runtime/runtimeTrace.test.ts
git commit -m "feat:add pending reminder trace fields"
```

## Task 5: Wire Policy Into Interpreted Agent

**Files:**
- Modify: `src/relationship/interpretedAgent.ts`
- Modify: `src/relationship/interpretedAgent.test.ts`
- Test: `src/relationship/interpretedAgent.test.ts`

- [ ] **Step 1: Write failing integration tests**

Add tests covering:

```ts
it("uses a footer instead of inline pending reminder after eligible search", async () => {
  // seed pending Sarah and a searchable Photon memory
  const result = await agent.handleMessage(inbound("Who did I meet at Photon?"));
  expect(result.outbound.text).toContain("I found");
  expect(result.outbound.text).toContain("\nAlso, I still have 1 unsaved contact waiting for context:\n- Sarah Fan");
  expect(result.outbound.text).not.toContain(". I still need context for Sarah Fan");
  expect(result.trace.pendingReminderDecision).toBe("appended_footer");
  expect(result.trace.suppressedPendingReminder).toBe(false);
});

it("does not append a footer for list_people routes", async () => {
  const result = await agent.handleMessage(inbound("List everyone I know"));
  expect(result.toolCalls).toEqual(["list_people"]);
  expect(result.outbound.text).not.toContain("Also, I still have");
  expect(result.trace.pendingReminderDecision).toBe("suppressed");
});

it("defers repeat search reminders within ttl", async () => {
  const first = await agent.handleMessage(inbound("Who did I meet at Photon?"));
  const second = await agent.handleMessage(inbound("Who did I meet at Friendy?"));
  expect(first.trace.pendingReminderDecision).toBe("appended_footer");
  expect(second.trace.pendingReminderDecision).toBe("deferred");
  expect(second.outbound.text).not.toContain("Also, I still have");
});
```

Use existing fixture helpers in `interpretedAgent.test.ts`; avoid exact full-prose assertions except for footer shape.

- [ ] **Step 2: Run RED integration tests**

```bash
npm test -- src/relationship/interpretedAgent.test.ts
```

Expected: FAIL because inline append still runs and no reminder policy state exists.

- [ ] **Step 3: Add reminder state to `ConversationContext`**

In `interpretedAgent.ts`, import:

```ts
import {
  decidePendingReminder,
  type PendingReminderDecision,
  type PendingReminderState
} from "./pendingReminderPolicy";
```

Extend `ConversationContext`:

```ts
reminderState?: PendingReminderState;
```

- [ ] **Step 4: Build context and apply decision**

After `outboundText = executeInterpretation(...)`, replace inline append with:

```ts
const pendingReminder = decidePendingReminder(
  buildPendingReminderContext({
    message,
    interpretation,
    pendingState,
    repo,
    outboundText,
    reminderState: turnContext.reminderState ?? {},
    now: now()
  })
);

if (pendingReminder.action === "append") {
  const footer = composePendingContactsFooter({
    items: pendingReminder.candidates.map((candidate) => ({
      displayName: candidate.displayName
    }))
  });
  if (footer.length > 0) {
    outboundText = `${outboundText}\n\n${footer}`;
  }
}
```

Add helper:

```ts
function responseKindForInterpretation(interpretation: MessageInterpretation): PendingReminderResponseKind {
  if (interpretation.intent === "list_people" || interpretation.search?.mode === "list_people") {
    return "list_people";
  }
  if (interpretation.intent === "search_memory") {
    return "search_result";
  }
  if (interpretation.intent === "explain_agent_state" || interpretation.intent === "explain_pending_workflow") {
    return "explain";
  }
  if (interpretation.intent === "conversation_repair") {
    return "repair";
  }
  if (interpretation.intent === "duplicate_audit") {
    return "duplicate_audit";
  }
  if (interpretation.intent === "delete_memory_request") {
    return "delete_confirm";
  }
  if (interpretation.intent === "clarify" || interpretation.needsClarification) {
    return "clarify";
  }
  return "other";
}
```

Add helper:

```ts
function buildPendingReminderContext(input: {
  message: InboundAgentMessage;
  interpretation: MessageInterpretation;
  pendingState: ConversationState;
  repo: RelationshipRepository;
  outboundText: string;
  reminderState: PendingReminderState;
  now: string;
}): PendingReminderContext {
  const active = input.pendingState.activeFrame;
  const savedMemoriesForActiveName = active
    ? listSavedMemoriesForDisplayName(input.repo, input.message.userId, active.displayName).map((memory) => ({
        memoryId: memory.id,
        displayName: memory.displayName
      }))
    : [];
  const sameNameDisambiguationPending = Boolean(active && savedMemoriesForActiveName.length > 0 && !hasSameOrDifferentResolution(input.reminderState, active.candidateId, active.openedAt));

  return {
    userText: input.message.text,
    userIntent: input.interpretation.intent,
    searchMode: input.interpretation.search?.mode,
    responseKind: responseKindForInterpretation(input.interpretation),
    now: input.now,
    activeWorkflow: active
      ? {
          kind: "pending_contact_confirmation",
          frameId: active.frameId,
          candidateId: active.candidateId,
          displayName: active.displayName,
          lastFriendyPrompt: active.lastFriendyPrompt
        }
      : undefined,
    pendingCandidates: input.pendingState.pendingContactQueue.map((candidate) => ({
      candidateId: candidate.candidateId,
      displayName: candidate.displayName,
      status: candidate.status
    })),
    savedMemoriesForActiveName,
    duplicateRisk: savedMemoriesForActiveName.length > 0,
    sameNameDisambiguationPending,
    listedEntityIds: [],
    reminderState: input.reminderState
  };
}
```

Add state updater:

```ts
function updateReminderState(
  previous: PendingReminderState,
  decision: PendingReminderDecision,
  pendingState: ConversationState,
  interpretation: MessageInterpretation,
  now: string
): PendingReminderState {
  const next: PendingReminderState = { ...previous };
  if (decision.action === "append" && pendingState.activeFrame) {
    next.lastReminderAt = now;
    next.lastRemindedCandidateId = pendingState.activeFrame.candidateId;
  }
  if (interpretation.intent === "conversation_repair" || interpretation.intent === "explain_agent_state") {
    next.lastUserComplaintAt = now;
  }
  if (interpretation.intent === "capture_pending_contact_context" || interpretation.intent === "answer_pending_contact_prompt") {
    next.lastReminderAt = undefined;
    next.lastRemindedCandidateId = undefined;
  }
  return next;
}
```

- [ ] **Step 5: Attach trace decision**

When creating interactions, include both:

```ts
pendingReminderDecision: pendingReminder.action === "defer" ? "deferred" : pendingReminder.action === "append" ? "appended_footer" : "suppressed",
pendingReminderReason: pendingReminder.reason,
suppressedPendingReminder: pendingReminder.action !== "append"
```

This may require extending `addInteractionWithTrace` / `traceFromInteractionFields` to read the fields from `interpretedIntentJson` or directly pass them into `createFriendyTrace`.

- [ ] **Step 6: Run interpreted-agent tests**

```bash
npm test -- src/relationship/interpretedAgent.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit agent wiring**

```bash
git add src/relationship/interpretedAgent.ts src/relationship/interpretedAgent.test.ts
git commit -m "feat:wire pending reminder policy"
```

## Task 6: Add PR 5 Eval Coverage

**Files:**
- Modify: `src/relationship/evals/agentEvalRunner.ts`
- Modify: `src/relationship/evals/agentEvalRunner.test.ts`

- [ ] **Step 1: Add eval cases to catalog**

Add required cases:

```ts
evalCase("pending-reminder-search-footer", "interpreted", [
  "search answer may append pending footer",
  "search footer is separate from primary answer",
  "search footer trace records appended decision"
]),
evalCase("pending-reminder-same-name-suppression", "interpreted", [
  "same-name saved plus pending suppresses reminder",
  "same-name reminder trace records suppression"
]),
evalCase("pending-reminder-ttl-defer", "interpreted", [
  "repeat search interrupt defers footer within ttl",
  "ttl defer trace records deferred decision"
]),
evalCase("pending-reminder-list-never-footer", "interpreted", [
  "list_people never appends pending reminder footer"
])
```

- [ ] **Step 2: Add catalog test assertions**

In `agentEvalRunner.test.ts`:

```ts
expect(relationshipAgentEvalCases.map((evalCase) => evalCase.id)).toEqual(
  expect.arrayContaining([
    "pending-reminder-search-footer",
    "pending-reminder-same-name-suppression",
    "pending-reminder-ttl-defer",
    "pending-reminder-list-never-footer"
  ])
);
```

- [ ] **Step 3: Implement executable cases**

Use existing harness helpers. Each case should assert behavior, not exact full prose:

```ts
assertion("search answer may append pending footer", "intent", result.outbound.text.includes("Also, I still have"));
assertion("search footer is separate from primary answer", "intent", result.outbound.text.includes("\n\nAlso, I still have"));
assertion("search footer trace records appended decision", "intent", result.trace.pendingReminderDecision === "appended_footer");
```

For `list_people`, assert:

```ts
assertion("list_people never appends pending reminder footer", "intent", !result.outbound.text.includes("Also, I still have"));
```

- [ ] **Step 4: Run eval runner tests**

```bash
npm test -- src/relationship/evals/agentEvalRunner.test.ts
```

Expected: PASS after updating expected total counts.

- [ ] **Step 5: Commit eval coverage**

```bash
git add src/relationship/evals/agentEvalRunner.ts src/relationship/evals/agentEvalRunner.test.ts
git commit -m "test:add pending reminder evals"
```

## Task 7: Migrate Route Policy Reminder Responsibility

**Files:**
- Modify: `src/relationship/routePolicyValidator.ts`
- Modify: `src/relationship/routePolicyValidator.test.ts`
- Test: `src/relationship/routePolicyValidator.test.ts`

- [ ] **Step 1: Add route policy compatibility test**

Add a test confirming route policy does not decide append/defer:

```ts
it("keeps suppressPendingReminder only as compatibility metadata", () => {
  const decision = validateRoutePolicy(
    {
      intent: "search_memory",
      confidence: 0.9,
      people: [],
      event: { name: "", dateText: "", location: "" },
      contextNote: "",
      query: "Photon",
      tags: [],
      needsClarification: false,
      clarificationQuestion: ""
    },
    { pendingContactQueue: [] }
  );

  expect(decision).toMatchObject({
    decision: "allow",
    suppressPendingReminder: false
  });
});
```

- [ ] **Step 2: Keep current API stable**

Do not remove `suppressPendingReminder` in PR 5 unless all callers/tests are updated in the same task. Leave a code comment:

```ts
// Compatibility projection for traces during PR 5. Append/defer decisions live in pendingReminderPolicy.ts.
```

- [ ] **Step 3: Run validator tests**

```bash
npm test -- src/relationship/routePolicyValidator.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit policy migration note**

```bash
git add src/relationship/routePolicyValidator.ts src/relationship/routePolicyValidator.test.ts
git commit -m "fix:limit route policy reminder responsibility"
```

## Task 8: Documentation And Final Verification

**Files:**
- Modify: `implementation-notes.html`
- Modify: `docs/agent-handoff.md`

- [ ] **Step 1: Update implementation notes**

Add:

```html
<li><strong>Pending reminder policy (2026-05-23).</strong> Replaced the inline pending-contact reminder append with a deterministic policy and footer. Search interruptions may append a separate footer when eligible; list_people never appends a footer because list replies include pending-contact inventory. Same-name saved/pending ambiguity, repair/explain turns, complaint cooldown, and TTL now suppress or defer reminders. Trace records pendingReminderDecision while preserving suppressedPendingReminder as a compatibility projection.</li>
```

- [ ] **Step 2: Update handoff**

Add:

```markdown
- PR 5 pending reminder policy implemented: inline reminders are removed from the happy path.
- `search_memory` may append a separate pending-contact footer; `list_people` never appends a footer.
- Reminder trace now includes `pendingReminderDecision` and `pendingReminderReason`; `suppressedPendingReminder` remains as a compatibility projection.
```

- [ ] **Step 3: Run full verification**

```bash
npm test -- src/relationship/pendingReminderPolicy.test.ts src/relationship/responseComposer.test.ts src/relationship/interpretedAgent.test.ts src/relationship/routePolicyValidator.test.ts src/relationship/evals/agentEvalRunner.test.ts src/relationship/runtime/runtimeTrace.test.ts
npm run build
npm run eval:agent
git diff --check
```

Expected:
- targeted tests pass;
- build passes;
- evals pass or only fail known unrelated frozen cases explicitly recorded in `implementation-notes.html`;
- whitespace check passes.

- [ ] **Step 4: Commit docs**

```bash
git add implementation-notes.html docs/agent-handoff.md
git commit -m "docs:record pending reminder policy"
```

## Self-Review Checklist

- [ ] `decidePendingReminder` is pure and has no repo I/O.
- [ ] Inline `composePendingContactReminder` append is removed from the successful search path.
- [ ] `list_people` never appends the PR 5 footer.
- [ ] `search_memory` may append the footer only when not suppressed/deferred.
- [ ] Same-name saved+pending ambiguity suppresses reminders until same/different is resolved.
- [ ] Complaint cooldown and TTL are covered by tests.
- [ ] Trace has `pendingReminderDecision` and compatibility `suppressedPendingReminder`.
- [ ] PR 1 stale Testing 3 assertions still pass.
