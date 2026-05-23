# Robust Delete/Update Design (Concrete Fix Stack — PR 7)

## Summary

PR 7 makes memory **delete** and **update** requests safe, fuzzy, and confirmation-gated. Destructive mutations must route through the structured LLM (`delete_memory_request`, `update_memory`), resolve targets via a dedicated **memory target lookup tool**, and never execute until the user confirms.

Today, fuzzy matching exists in `personNameMatch.ts` and partial confirmation wiring exists for delete (`pendingDelete` in `interpretedAgent.ts`), but:

- `attachPendingDeleteContext` only attaches when **exactly one** match exists — multi-match and high-confidence single-match UX are incomplete.
- Typo tolerance (`Unamed` → `Unnamed Contact`, `Srah` → `Sarah`) is inconsistent because lookup is duplicated across agent branches.
- Update mutations lack the same confirmation gate as delete.
- Regex fast paths in `detectMemoryMutationRequest()` compete with structured routing.

PR 7 centralizes lookup in `lookupMemoryTarget` and completes confirmation composers for single- and multi-match cases.

This spec unblocks the RED eval `fuzzy-delete-memory-confirmation-regression`.

## Stack numbering

| PR | Topic | Status |
|----|--------|--------|
| PR 6 | Identity resolution | Spec in progress |
| PR 7 | Robust delete/update + fuzzy target lookup | **This spec** |
| PR 8 | Sensor normalization + ack lifecycle | Spec in progress |
| PR 9 | Strict-mode dogfooding trace | Spec in progress |

Depends on PR 3 (structured intents). Compatible with PR 6 (`personId` may refine lookup later) but must not block on PR 6 landing.

## Problem

### Failure — destructive actions without robust target resolution

From regression freeze Case 4 and eval `fuzzy-delete-memory-confirmation-regression`:

1. User: “delete Unamed contact” (typo).
2. Friendy should find **Unnamed Contact** with fuzzy scoring.
3. Friendy asks: *“I found Unnamed Contact. Delete this from Friendy memory?”*
4. Only after explicit yes/confirm may `delete_memory` run.
5. Stale pending contact reminders must be suppressed during this flow (PR 3/5).

Additional gaps:

- Multiple matches: *“I found two possible matches… which one?”* with numbered options — not implemented.
- Update path: “change Sarah’s note to …” can mutate without the same confirmation discipline.
- Lookup logic spread across `interpretedAgent.ts`, `personNameMatch.ts`, and regex mutation detector — violates “no more top-level regex branches” guidance.

## Goals

- Route destructive requests via structured LLM intents only (`delete_memory_request`, `update_memory`).
- Add deterministic tool `lookup_memory_target(userId, query, { operation: "delete" | "update" })`.
- Move fuzzy/typo tolerance into that tool (wrap/extend `rankDisplayNameMatches`).
- Confirmation-required workflows:
  - **One high-confidence match** → single-target confirm prompt.
  - **Multiple plausible matches** → numbered disambiguation prompt.
  - **No match** → deterministic no-match reply.
- Only call `delete_memory` / `update_memory` after confirmation (`isConfirmationReply` or explicit numbered pick).
- Mirror delete confirmation for update (pending update frame).
- Remove or demote regex mutation fast paths that bypass lookup + confirmation.
- Suppress pending reminders during active delete/update confirmation (PR 5).
- Pass eval `fuzzy-delete-memory-confirmation-regression`.

## Non-Goals

- Do not add new top-level regex branches in `agentCore.ts` or `interpretedAgent.ts` for typo fixes.
- Do not delete or update without confirmation, even in strict mode tests (unless eval explicitly uses direct tool calls).
- Do not implement semantic embedding search for targets (display-name fuzzy only in PR 7).
- Do not change LLM schema beyond using existing intents + `interpretation.target.displayName`.
- Do not merge duplicate people (PR 6).

## Design approaches considered

### Approach A — Extend `rankDisplayNameMatches` call sites only

Patch `attachPendingDeleteContext` thresholds.

| Pros | Cons |
|------|------|
| Small diff | Leaves update path inconsistent; logic stays scattered |

**Verdict:** Insufficient.

### Approach B — `lookupMemoryTarget` tool + pending mutation frames (recommended)

Single lookup tool returns ranked candidates with scores; composers format confirm/disambiguate; agent stores `pendingDelete` / `pendingUpdate` frames.

| Pros | Cons |
|------|------|
| One lookup implementation | New tool + frame types |
| Testable typo cases | Migration from regex fast path |
| Matches architecture boundary | |

**Verdict:** Recommended.

### Approach C — LLM picks memory id directly

Model returns `memoryId` in structured output.

| Pros | Cons |
|------|------|
| Flexible | Unsafe; hallucinated ids; non-deterministic evals |

**Verdict:** Rejected.

## Memory target lookup tool

New module: `src/relationship/memoryTargetLookup.ts`

```ts
export type MemoryTargetLookupResult =
  | { kind: "none"; query: string }
  | { kind: "single"; memoryId: string; displayName: string; score: number; matchedVia: "exact" | "fuzzy" }
  | { kind: "ambiguous"; options: Array<{ memoryId: string; displayName: string; score: number }>; query: string };

export function lookupMemoryTarget(input: {
  userId: string;
  query: string;
  memories: RelationshipMemory[];
  minScore?: number;          // default 70
  ambiguityGap?: number;      // default 8 — top two within gap => ambiguous
}): MemoryTargetLookupResult;
```

Implementation:

- Reuse `rankDisplayNameMatches` for scoring.
- Map display names back to memories; if duplicate display names exist, include `personId` / event context in disambiguation lines when PR 6 available (fallback: event title + created date snippet).
- Typo fixtures must pass:
  - `Unamed` → `Unnamed Contact`
  - `Srah` → `Sarah`

Threshold policy:

| Condition | Result kind |
|-----------|-------------|
| Top score ≥ 85 and gap to #2 ≥ ambiguityGap | `single` |
| Top score ≥ minScore and gap < ambiguityGap | `ambiguous` |
| Top score ≥ minScore and only one candidate | `single` |
| Else | `none` |

Expose as agent tool:

```ts
lookup_memory_target(userId, query) => MemoryTargetLookupResult
```

Tool is read-only — never mutates.

## Confirmation workflows

### Active frames

```ts
type PendingDeleteFrame = {
  kind: "pending_delete_confirm";
  memoryId: string;
  displayName: string;
  query: string;
};

type PendingUpdateFrame = {
  kind: "pending_update_confirm";
  memoryId: string;
  displayName: string;
  proposedContextNote: string;
  query: string;
};
```

Store on `ConversationContext` (same pattern as existing `pendingDelete`).

### Composers (`responseComposer.ts`)

**Single match delete:**

```text
I found Unnamed Contact. Delete this from Friendy memory?
Reply yes to confirm or no to cancel.
```

**Multi match delete:**

```text
I found two possible matches for "Srah":
1. Sarah — met at Photon dinner
2. Sara Kim — met at recruiting meetup
Reply 1 or 2, or say cancel.
```

**Update analog:**

```text
I found Sarah. Update her note to "…" ?
```

All copy deterministic; no LLM prose.

### Routing order (`interpretedAgent.ts`)

```text
1. If pendingDelete/PendingUpdate frame + confirmation reply → execute mutation tool
2. If pendingDelete/PendingUpdate frame + numbered pick → resolve option
3. If intent delete_memory_request / update_memory:
     a. lookup_memory_target
     b. compose confirm / disambiguate / no-match
     c. attach pending frame when single target chosen for confirmation
4. Do NOT call delete_memory / update_memory in same turn
```

Remove or gate `detectMemoryMutationRequest()` regex path for user-facing destructive ops — keep only for tests if needed, behind `strictMode: false` fixture flag.

## Structured LLM contract

Use existing intents:

- `delete_memory_request` with `target.displayName` or extracted query span
- `update_memory` with `target.displayName` + new note fields

Policy validator (`routePolicyValidator.ts`):

- Destructive intents require lookup tool call before mutation tool in trace sequence (enforced in strict mode — PR 9).

## Trace fields

Extend `FriendyTrace`:

```ts
activeWorkflowKind?: "pending_delete_confirm" | "pending_update_confirm";
selectedTool?: "lookup_memory_target" | "delete_memory" | "update_memory";
```

Include lookup result kind in redacted trace (`single` | `ambiguous` | `none`) without leaking full memory ids in user-visible text.

## Target flow

```text
User: "delete Unamed contact"
  -> LLM: delete_memory_request { target: { displayName: "Unamed" } }
  -> lookup_memory_target("Unamed") => single Unnamed Contact
  -> "I found Unnamed Contact. Delete this from Friendy memory?"
  -> pendingDelete frame

User: "yes"
  -> delete_memory(confirmed)
  -> clear frame
```

```text
User: "delete Srah"
  -> lookup => ambiguous [Sarah, Sara Kim]
  -> numbered prompt
  -> user: "1"
  -> confirm delete Sarah
```

## Testing strategy

Unit:

- `memoryTargetLookup.test.ts` — typo cases, ambiguity gap, none.
- `responseComposer.test.ts` — confirm/disambiguate strings.

Integration:

- `interpretedAgent.test.ts` — no delete tool call before confirmation.
- Un-RED `fuzzy-delete-memory-confirmation-regression`.

Commands:

```bash
npm test -- src/relationship/memoryTargetLookup.test.ts
npm test -- src/relationship/interpretedAgent.test.ts
npm test -- src/relationship/responseComposer.test.ts
npm run eval:agent
```

## Boundaries

- **Always:** confirmation before `delete_memory` / `update_memory` for interpreted user messages.
- **Ask first:** changing interpretation schema intents.
- **Never:** typo fixes via new regex branches in router; silent delete on fuzzy match.

## Success criteria

- [ ] `lookup_memory_target` tool exists; fuzzy logic centralized.
- [ ] `Unamed` → `Unnamed Contact` and `Srah` → `Sarah` covered by tests.
- [ ] Single-match and multi-match confirmation copy implemented.
- [ ] Delete and update both require confirmation.
- [ ] `fuzzy-delete-memory-confirmation-regression` eval passes.
- [ ] No new top-level regex typo branches added.

## Dependencies

- `docs/superpowers/specs/2026-05-23-friendy-regression-freeze-design.md`
- `docs/superpowers/specs/2026-05-23-structured-intent-router-design.md`
- `docs/superpowers/specs/2026-05-23-pending-reminder-policy-design.md`
- `src/relationship/personNameMatch.ts` (scoring input)
