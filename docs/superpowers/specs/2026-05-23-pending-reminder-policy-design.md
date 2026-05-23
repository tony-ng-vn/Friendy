# Pending Reminder Policy Design (Concrete Fix Stack — PR 5)

## Summary

PR 5 replaces Friendy's blunt post-response pending reminder hook with a deterministic **pending reminder policy**. When the user asks a list, search, duplicate audit, delete, or repair question while a contact confirmation prompt is open, Friendy must answer the question first — without appending a confusing inline sentence like `I still need context for Testing 3...` on every unrelated reply.

PR 5 builds on PR 3 (structured intent router + intent-based suppression). It does **not** change routing order or OpenRouter payload shape — that is PR 4.

This spec depends on:

- **PR 1:** Regression tests for Testing 3 transcript behavior (reminder suppression cases).
- **PR 3:** `routePolicyValidator.shouldSuppressPendingReminder`, meta intents, `FriendyTrace.suppressedPendingReminder`.
- **PR 4 (optional, parallel):** State-aware LLM router. PR 5 does not require PR 4 to ship, but both specs share a compact per-turn context shape for duplicate/same-name detection.

## Stack numbering (do not confuse with Spec A)

| PR | Topic | Status |
|----|--------|--------|
| PR 1 | Regression eval freeze | Done |
| PR 2 | Real `list_people` tool | Done |
| PR 3 | Structured intent router + intent suppression | Done |
| PR 4 | Pass state into LLM router (OpenRouter payload) | Spec in progress |
| PR 5 | Pending reminder policy + presentation | **This spec** |

Old Spec A "PR 4: Policy Validator" is implemented as PR 3.

## Problem

PR 3 fixed the worst case: meta intents no longer get stale reminders. Two failure modes remain.

### Failure 1 — Inline reminder corrupts the primary answer

After a valid `search_memory` answer, Friendy still appends:

```text
I still need context for Testing 3 — what should I remember about them?
```

The user asked a search question, got an answer, then received an unrelated nag in the same breath. The primary answer and the pending workflow feel like one confused message.

### Failure 2 — Reminder fires when it should not

From the Testing 3 transcript and goal doc:

- User already has **saved** `Testing 3` memory **and** a **pending** `Testing 3` candidate (same display name). Reminding "I still need context for Testing 3" before same/different disambiguation is misleading.
- User just asked **why** Friendy is still asking (`conversation_repair` / `explain_agent_state`). A reminder in the same or next turn ignores the complaint.
- User gets the same reminder on **every** search/list interrupt within minutes — feels like a broken loop.

### PR 3 baseline (what already works)

```ts
// interpretedAgent.ts — simplified
if (activeFrame && intent === "search_memory" && !suppressPendingReminder) {
  outboundText += composePendingContactReminder(activeFrame.displayName);
}
```

`suppressPendingReminder` is true for: `list_people`, `duplicate_audit`, `explain_agent_state`, `conversation_repair`, `delete_memory_request`, `update_memory`, `delete_memory`, `clarify`, `reject`, and `search.mode === "list_people"`.

That is necessary but not sufficient.

## Goals

- Replace the inline append rule with `decidePendingReminder(...)` that returns **suppress**, **defer**, or **append footer**.
- Never append (inline or footer) on read-only/meta/mutation intents listed in PR 3 suppression set.
- Do not append when same display name exists in saved memory and pending candidate until same/different disambiguation completes.
- Do not append when the user just complained about the prompt (current turn repair/explain, or prior-turn complaint signal).
- Enforce a **TTL** so the same pending contact is not reminded more than once per window unless the user explicitly re-opens the workflow.
- When a reminder is appropriate, use a **separate footer section** — not a trailing sentence glued to the search/list body.
- Preserve the goal-doc behavior for search interruptions: `search_memory` may remind after answering, when policy says it is helpful and not confusing. `list_people` never appends a reminder footer in PR 5 because list replies already have their own pending-contact inventory section.
- Log reminder decisions on `FriendyTrace` for evals and strict-mode debugging.
- Keep all reminder copy **deterministic** (composers only; no LLM prose).

## Non-Goals

- Do not pass state into OpenRouter (PR 4).
- Do not change interpreter intents or tool routing (PR 3 / PR 4).
- Do not auto-confirm, auto-ignore, or mutate pending candidates from reminder logic.
- Do not add push notifications or background nags outside the reply that answers the user's question.
- Do not build a general "follow-up suggestions" engine — only pending contact context reminders.
- Do not require durable SQLite for reminder TTL in MVP (process-local per user is acceptable; durable schema noted as follow-up).

## Design approaches considered

### Approach A — Extend PR 3 `suppressPendingReminder` only

Keep inline append; add more intents and regex guards.

| Pros | Cons |
|------|------|
| Smallest diff | Does not fix presentation; TTL and same-name rules become tangled in `interpretedAgent.ts` |
| | Reminder logic stays coupled to route policy |

**Verdict:** Insufficient.

### Approach B — Dedicated `pendingReminderPolicy.ts` + footer composer (recommended)

Single pure function decides reminder; composer formats footer; agent loop calls policy after primary response is composed.

| Pros | Cons |
|------|------|
| Testable in isolation | New module + trace fields |
| Clear separation from route policy | Requires migrating PR 3 suppression list |
| Matches goal-doc "answer then remind" with readable layout | |

**Verdict:** Recommended.

### Approach C — LLM-generated reminder sentence

Model writes a soft reminder after each answer.

| Pros | Cons |
|------|------|
| Flexible wording | Violates non-negotiables; hallucination risk; non-deterministic evals |

**Verdict:** Rejected.

## Target flow

```text
Inbound message
  ↓
(existing PR 3 path: fast paths → hard safety → interpreter → route policy → tools)
  ↓
Primary response composer (search reply, list, explain, etc.)
  ↓
decidePendingReminder({
  userIntent,
  userText,
  activeWorkflow,
  responseKind,
  domainSummary,
  reminderState,
  listedEntities,
})
  ↓
  ├─ suppress → return primary only; trace.pendingReminderDecision = "suppressed"
  ├─ defer     → return primary only; trace.pendingReminderDecision = "deferred_ttl"
  └─ append    → primary + composePendingContactsFooter(...); trace.pendingReminderDecision = "appended_footer"
  ↓
Update reminderState (lastReminderAt, lastRemindedCandidateId)
  ↓
Interaction trace / eval
```

Reminder runs **after** the primary answer is known (`responseKind`) so list/search/explain bodies stay clean.

## Shared context with PR 4

PR 4 introduces `RouterInputEnvelope` for the OpenRouter call. PR 5 consumes a **subset** of the same facts through `PendingReminderContext` — computed once per turn in a builder both PRs can share later.

```ts
/** Subset used by PR 5; full shape owned by PR 4 spec. */
type PendingReminderContext = {
  userText: string;
  userIntent: MessageInterpretation["intent"];
  responseKind: PendingReminderResponseKind;
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
  reminderState: {
    lastReminderAt?: string;
    lastRemindedCandidateId?: string;
    lastUserComplaintAt?: string;
  };
};

type PendingReminderResponseKind =
  | "search_result"
  | "list_people"
  | "explain"
  | "repair"
  | "duplicate_audit"
  | "delete_confirm"
  | "capture_context"
  | "clarify"
  | "other";

type PendingReminderDecision =
  | { action: "suppress"; reason: string }
  | { action: "defer"; reason: string }
  | { action: "append"; reason: string; candidates: Array<{ candidateId: string; displayName: string }> };
```

PR 5 can build this from existing `buildConversationState`, `repo.listMemories`, and process-local `reminderState` without waiting for PR 4.

## Policy rules

### Rule 1 — Intent suppression (inherit PR 3)

Never append when `userIntent` is in:

```ts
const NEVER_REMIND_INTENTS = [
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
] as const;
```

Also suppress when `search.mode === "list_people"` even if intent is `search_memory`.

If a future schema migration adds `update_memory_request`, add it to this set in that same migration. PR 5 should not introduce unsupported intent strings by itself.

### Rule 2 — Response-kind suppression

Never append when `responseKind` is `explain`, `repair`, `duplicate_audit`, `delete_confirm`, or `clarify`.

### Rule 3 — Same-name / duplicate risk

When `activeWorkflow.displayName` normalizes to the same string as one or more saved memories **and** `sameNameDisambiguationPending === true` (user has not confirmed same vs different person), **suppress**.

Rationale: reminding "I still need context for Testing 3" while Friendy also has Testing 3 saved is exactly the Testing 3 confusion.

`sameNameDisambiguationPending` is true when:

- saved memories exist for normalized `activeWorkflow.displayName`, and
- pending candidate for that display name is still open, and
- the current process-local conversation context has not recorded a `sameOrDifferentResolution` for that candidate.

Add this process-local field for PR 5:

```ts
type SameOrDifferentResolution = {
  candidateId: string;
  resolvedAt: string;
  resolution: "same_person" | "different_person";
};

type PendingReminderState = {
  lastReminderAt?: string;
  lastRemindedCandidateId?: string;
  lastUserComplaintAt?: string;
  sameOrDifferentResolutions?: SameOrDifferentResolution[];
};
```

Set the resolution only when the same/different clarification flow receives a user answer and policy allows the workflow to proceed. Clear or ignore entries when the active candidate changes, the candidate is confirmed/ignored, or the resolution is older than the pending frame.

### Rule 4 — User complaint

Suppress when **either**:

- current turn `userIntent` is `conversation_repair` or `explain_agent_state`, or
- `reminderState.lastUserComplaintAt` is within `COMPLAINT_COOLDOWN_MS` (default 10 minutes).

Set `lastUserComplaintAt` when executing repair/explain composers.

### Rule 5 — TTL / repeat nag

If `reminderState.lastRemindedCandidateId === activeWorkflow.candidateId` and `now - lastReminderAt < REMINDER_TTL_MS` (default 15 minutes), **defer** (do not append again).

Reset TTL when:

- user supplies pending context (confirm path),
- user ignores candidate,
- active candidate changes (new prompt in space),
- user explicitly asks about the pending prompt (`explain_pending_workflow`).

### Rule 6 — When append is allowed

Append footer only when **all** hold:

- `activeWorkflow` exists,
- `userIntent === "search_memory"` (or follow-up search deterministic path with equivalent intent trace),
- rules 1–5 did not suppress/defer,
- primary response successfully answered the user (non-empty search/list body or explicit "no match" is still a valid primary answer).

`list_people` is intentionally excluded even when a goal-doc example says "search/list may remind." In PR 5, list replies should surface pending candidates inside the structured list response, not through the pending-reminder footer. `search_memory` remains the only read-only route that may append the footer.

### Rule 7 — Multiple pending candidates

When appending, footer lists **unsaved** pending contacts not already the subject of the primary answer:

```text
Also, I still have 1 unsaved contact waiting for context:
- Testing 4 — what should I remember about them?
```

For multiple:

```text
Also, I still have 2 unsaved contacts waiting for context:
- Testing 3 — what should I remember about them?
- Testing 4 — what should I remember about them?
```

Do **not** repeat the active candidate if the primary response was already about that workflow (e.g. failed context capture clarify).

## Presentation

### Deprecate inline append

Remove:

```ts
outboundText = `${outboundText} ${composePendingContactReminder(name)}`;
```

### Footer composer

Add to `responseComposer.ts`:

```ts
composePendingContactsFooter({
  items: Array<{ displayName: string; promptHint?: string }>;
}): string
```

Formatting rules:

- Blank line before `Also, I still have...` when primary body is multi-line.
- Singular/plural count in header.
- Each item: `- {displayName} — {promptHint || "what should I remember about them?"}`.
- Max 3 items in footer; if more pending, add `and N more`.

Keep `composePendingContactReminder` for backward compatibility in tests only, or migrate tests to footer shape.

## Module boundaries

| Module | Responsibility |
|--------|----------------|
| `pendingReminderPolicy.ts` | **New.** `decidePendingReminder`, pure policy |
| `pendingReminderPolicy.test.ts` | **New.** Rule matrix unit tests |
| `responseComposer.ts` | `composePendingContactsFooter` |
| `interpretedAgent.ts` | Call policy after primary compose; maintain `reminderState` in `ConversationContext` |
| `routePolicyValidator.ts` | **Remove** reminder suppression from route policy over time; route policy validates routes, reminder policy handles UX nag |
| `trace.ts` | Add `pendingReminderDecision?: "suppressed" \| "deferred" \| "appended_footer"` and `pendingReminderReason?: string` |
| `agentEvalRunner.ts` | Extend PR 1 cases + add TTL/same-name/footer cases |

### Migration note for `routePolicyValidator`

PR 3 added `suppressPendingReminder` on `ValidatedRoutePolicy`. PR 5 should:

1. Keep route policy focused on allow/clarify/reject/unsupported.
2. Move reminder suppression to `decidePendingReminder`.
3. Deprecate `suppressPendingReminder` on route policy in a follow-up commit within PR 5 (single PR is fine).

Until migrated, both may run; final behavior is **`decidePendingReminder` wins** for append decisions.

## Reminder state storage

Extend process-local `ConversationContext`:

```ts
type PendingReminderState = {
  lastReminderAt?: string;
  lastRemindedCandidateId?: string;
  lastUserComplaintAt?: string;
  sameOrDifferentResolutions?: Array<{
    candidateId: string;
    resolvedAt: string;
    resolution: "same_person" | "different_person";
  }>;
};
```

Attach to existing `conversationContexts` map keyed by `userId` (same lifetime as search context TTL today).

**Follow-up (post-PR 5):** persist `lastReminderAt` per `(userId, candidateId)` in SQLite if multi-device/session continuity becomes a requirement.

## Trace and evals

Extend `FriendyTrace`:

```ts
// Existing PR 3 field kept for one migration window.
suppressedPendingReminder?: boolean;
pendingReminderDecision?: "suppressed" | "deferred" | "appended_footer";
pendingReminderReason?: string;
```

During PR 5, `pendingReminderDecision` is the source of truth for new behavior. Keep `suppressedPendingReminder` populated as a compatibility projection:

- `true` when decision is `suppressed` or `deferred`;
- `false` when decision is `appended_footer`;
- `undefined` only when no active workflow existed and reminder policy did not run.

### PR 1 regression — must still pass

All existing "does not contain `I still need context for Testing 3`" assertions remain green.

Those assertions should be interpreted as stale same-name reminder guards. New footer tests may allow a footer for a different pending contact, but not for the saved+pending same-name Testing 3 ambiguity.

### New eval cases (PR 5)

| Case | Input | Expect |
|------|--------|--------|
| search-then-footer | Pending Sarah + "Who did I meet at Photon?" | Primary search answer; footer mentions Sarah; **no** inline mid-sentence reminder |
| same-name-no-remind | Saved Testing 3 + pending Testing 3 + search | suppress or defer until disambiguation |
| repair-no-remind | "Why u still asking for testing 3 context?" | no reminder text |
| ttl-defer | Two search interrupts within 15m | first may footer; second suppress/defer |
| list-never-remind | list_people with pending | no footer |

### Unit test matrix (`pendingReminderPolicy.test.ts`)

One test per rule 1–6 boundary; table-driven.

## Acceptance criteria

- [ ] `decidePendingReminder` exists and is pure (no repo I/O inside policy).
- [ ] Inline `composePendingContactReminder` append removed from happy path.
- [ ] Footer appears only when policy returns `append`.
- [ ] Same-name saved+pending suppresses reminder until disambiguation resolved.
- [ ] Repair/explain turns never get reminders on same turn.
- [ ] TTL prevents repeat footer within 15 minutes for same candidate.
- [ ] PR 1 regression evals pass unchanged.
- [ ] New PR 5 eval cases pass.
- [ ] `npm test`, `npm run build`, `npm run eval:agent` pass.
- [ ] Trace records `pendingReminderDecision` on interpreted turns.

## Implementation staging

1. Add failing `pendingReminderPolicy.test.ts` matrix.
2. Implement `decidePendingReminder` with rules 1–6.
3. Add `composePendingContactsFooter`.
4. Wire `interpretedAgent.ts`; add `PendingReminderState` to context.
5. Extend trace + evals.
6. Remove redundant inline append and migrate append/defer decisions off route policy. Keep `suppressPendingReminder` as a compatibility trace projection for one migration window.
7. Update `implementation-notes.html` and `docs/agent-handoff.md`.

## Relationship to PR 4

| Concern | PR 4 | PR 5 |
|---------|------|------|
| Mis-route complaint as context capture | Fixes at interpreter | — |
| Stale reminder after correct route | — | Fixes at composer |
| Shared `duplicateRisk` / pending summary | Builds for LLM | Consumes for policy |
| Spec timing | Can draft in parallel | This spec |

Implement PR 4 first when correctness is the priority: PR 5 cannot prevent a wrong route from capturing context before reminder policy runs. PR 5 can still be implemented independently after PR 3 if the goal is only to improve reminder presentation for already-correct routes.

## References

- `docs/superpowers/specs/2026-05-23-structured-intent-router-design.md` — PR 3 suppression baseline
- `docs/superpowers/specs/2026-05-23-friendy-regression-freeze-design.md` — stale reminder regression intent
- `docs/goals/state-aware-relationship-agent-routing-goal.md` — search interrupt + remind example
- `src/relationship/routePolicyValidator.ts` — current suppression set
- `src/relationship/responseComposer.ts` — `composePendingContactReminder`
