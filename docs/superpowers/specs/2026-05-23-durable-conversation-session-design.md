# Durable Conversation Session Design (Concrete Fix Stack — PR 10)

## Summary

PR 10 adds a **repository-backed conversation session** so Friendy’s multi-turn workflow state survives process restarts, delayed iMessage replies, and separate runtime/checker processes. Today, interpreted-agent state lives in a process-local `Map<string, ConversationContext>` (`interpretedAgent.ts`), which is rebuilt from scratch on every restart and cannot answer meta questions about *prior* turns unless those facts happen to still be in SQLite domain tables.

PR 10 does **not** block PR 4–9 (May 23 log fixes). Ship PR 4–9 first. PR 10 closes the durability gap for long-running dogfood and production iMessage latency.

PR 10 is a **session projection layer**, not a full event-sourced graph (ActiveGraph-style event log remains a later milestone). Interactions are already persisted; this PR adds a compact **current session snapshot** keyed by user + channel.

## Stack numbering

| PR | Topic | Status |
|----|--------|--------|
| PR 1–3 | Regression freeze, `list_people`, structured router | Done |
| PR 4 | Pass state into LLM router | Executing |
| PR 5 | Pending reminder policy | Plan ready |
| PR 6–9 | Identity, delete/update, sensor, strict dogfood | Spec only |
| PR 10 | Durable conversation session | **This spec** |

## Problem

### Failure — domain memory without durable conversation/task state

Current per-user state in `interpretedAgent.ts`:

```ts
type ConversationContext = {
  activeEventName?: string;
  activeDateContext?: TemporalContext;
  lastSearch?: SearchContext;
  activeMemoryId?: string;
  pendingDelete?: { memoryId: string; displayName: string };
  recentPeople: string[];
};
const conversationContexts = new Map<string, ConversationContext>();
```

Separate `ConversationState` (`conversationState.ts`) derives **pending contact frames** from repository candidates each turn — it is not persisted as a session either.

Missing durable fields the product needs:

```ts
activeWorkflow
lastListResult
lastAgentPrompt
lastRouteDecision
recentEntityRefs
pendingUpdateTarget
duplicateResolutionState
reminderState
routeHistory (short)
lastUserComplaintAt
```

Without these, Friendy cannot reliably answer across restarts:

> “Why are you still asking for Testing 3 context when you already have it?”

…because `explain_agent_state` depends on reconstructing context from scattered interactions and pending candidates, not a queryable session record.

### What already persists (do not duplicate)

SQLite already stores (`sqliteRepository.ts`, durable runtime store spec):

- relationship memories, candidates, event matches
- interactions (full turn log with traces)
- sensor processed events, runtime sensor state

PR 10 **projects** a small snapshot from domain + last N interactions; it does not replace the interactions table.

## Goals

- Add `ConversationSession` type and SQLite `conversation_sessions` table.
- Key sessions by `(userId, platform, spaceId?)` — spaceId optional but required for multi-space Spectrum later.
- Persist workflow and carryover fields listed below.
- Replace direct Map read/write in `interpretedAgent.ts` with session store API; keep in-memory Map as **optional cache** keyed same as SQLite row.
- Let PR 4 `buildRouterInputEnvelope()` read session + domain summary (session supplies conversation half; repo supplies domain half).
- Let PR 5 `decidePendingReminder()` read `reminderState` from session.
- Let PR 6 `duplicate_resolution` and PR 7 `pendingDelete`/`pendingUpdate` frames survive restart.
- Session survives agent reconstruction: new `createInterpretedRelationshipAgent()` loads session from store on first message.
- Tests prove state survives new agent instance / simulated restart.

## Non-Goals

- Do not implement full event-sourced replay graph (future milestone).
- Do not send full session JSON to OpenRouter — PR 4 envelope remains compact/redacted.
- Do not replace `interactions` table or store unbounded message history in session row.
- Do not add cloud sync or multi-device session merge.
- Do not block PR 4–9 on PR 10 landing.
- Do not persist raw phone/email in session JSON.

## Design approaches considered

### Approach A — Rebuild session from interactions each turn

Scan last N interactions and infer workflow state.

| Pros | Cons |
|------|------|
| No new table | Slow, fragile, hard to test; misses non-interaction state |

**Verdict:** Rejected as primary; acceptable as **recovery fallback** only.

### Approach B — SQLite session snapshot + Map cache (recommended)

One row per session key; update after each successful turn; Map mirrors row for hot path.

| Pros | Cons |
|------|------|
| Simple; matches durable store pattern | Must keep session and domain mutations consistent |
| Survives restart | Schema migration |

**Verdict:** Recommended.

### Approach C — Full event log + projection worker

ActiveGraph-style replay.

| Pros | Cons |
|------|------|
| Auditable, forkable | Overkill for Mac MVP |

**Verdict:** Deferred; PR 10 schema should not prevent future event append.

## Session model

```ts
export type ConversationSessionKey = {
  userId: string;
  platform: AgentPlatform;
  spaceId?: string;
};

export type ActiveWorkflow =
  | {
      kind: "pending_contact_confirm";
      frameId: string;
      candidateId: string;
      displayName: string;
      lastFriendyPrompt: string;
      openedAt: string;
    }
  | {
      kind: "duplicate_resolution";
      candidateId: string;
      suspectedPersonId: string;
      displayName: string;
      priorEventTitle?: string;
      openedAt: string;
    }
  | {
      kind: "pending_delete_confirm";
      memoryId: string;
      displayName: string;
      query: string;
      openedAt: string;
    }
  | {
      kind: "pending_update_confirm";
      memoryId: string;
      displayName: string;
      proposedContextNote: string;
      openedAt: string;
    };

export type ConversationSession = {
  key: ConversationSessionKey;
  activeWorkflow?: ActiveWorkflow;
  lastSearch?: SearchContext;
  lastListResult?: {
    listedAt: string;
    memoryIds: string[];
    personIds?: string[];
    filterSummary?: string;
  };
  activeMemoryId?: string;
  recentEntityRefs: Array<{
    kind: "candidate" | "memory" | "person";
    id?: string;
    displayName: string;
    referencedAt: string;
  }>;
  lastAgentPrompt?: {
    text: string;
    interactionId?: string;
    createdAt: string;
  };
  lastRouteDecision?: {
    intent: string;
    routeSource: string;
    createdAt: string;
  };
  reminderState?: {
    lastReminderAt?: string;
    lastRemindedCandidateId?: string;
    lastUserComplaintAt?: string;
  };
  routeHistory: Array<{
    intent: string;
    routeSource: string;
    createdAt: string;
  }>; // cap 10, FIFO
  carryover?: {
    activeEventName?: string;
    activeDateContext?: TemporalContext;
    recentPeople: string[]; // cap 10
  };
  updatedAt: string;
  version: number; // optimistic concurrency
};
```

### Mapping from current `ConversationContext`

| Old Map field | Session location |
|---------------|------------------|
| `activeEventName`, `activeDateContext`, `recentPeople` | `carryover` |
| `lastSearch` | `lastSearch` |
| `activeMemoryId` | `activeMemoryId` |
| `pendingDelete` | `activeWorkflow.kind: pending_delete_confirm` |

## Persistence

### SQLite table

```sql
CREATE TABLE IF NOT EXISTS conversation_sessions (
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  space_id TEXT,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (user_id, platform, space_id)
);
CREATE INDEX IF NOT EXISTS conversation_sessions_updated_idx
  ON conversation_sessions(updated_at);
```

- Store full `ConversationSession` as JSON in `raw_json` (same pattern as `interactions`).
- `space_id` NULL normalized to empty string in primary key logic for stable lookup.

### Store API

New module: `src/relationship/conversationSessionStore.ts`

```ts
export type ConversationSessionStore = {
  getSession(key: ConversationSessionKey): ConversationSession | undefined;
  upsertSession(session: ConversationSession): ConversationSession;
  deleteSession(key: ConversationSessionKey): void;
};
```

Implementations:

- `createSqliteConversationSessionStore(db)` — production / dogfood
- `createInMemoryConversationSessionStore()` — unit tests

Wire into `createSqliteRelationshipRepository` or parallel store on same DB file (prefer same `FRIENDY_SQLITE_PATH`).

## Agent integration

### Read path (start of turn)

```text
handleMessage(message)
  -> resolve session key from message
  -> load session from store (or create empty defaults)
  -> merge into turnContext / buildConversationState + session.activeWorkflow
  -> buildRouterInputEnvelope (PR 4) from session + repo
  -> interpret → validate → execute tools
```

### Write path (end of successful turn)

```text
  -> update session fields from turn outcome
  -> append routeHistory entry (trim to 10)
  -> upsert session row
  -> optional: refresh Map cache
```

### Cache rule

```ts
// Map is cache only — SQLite is source of truth when runtime store is sqlite
if (runtimeStore === "sqlite") {
  session = sessionStore.getSession(key) ?? emptySession(key);
} else {
  session = memoryCache.get(cacheKey) ?? emptySession(key);
}
```

In-memory-only test repos may keep Map-only behavior without SQLite.

## Cross-PR contracts

| Consumer | Session fields used |
|----------|---------------------|
| PR 4 router envelope | `activeWorkflow`, `lastListResult`, `recentEntityRefs`, `lastRouteDecision`, `routeHistory`, `lastAgentPrompt` |
| PR 5 reminder policy | `reminderState`, `activeWorkflow`, `lastListResult`, `lastUserComplaintAt` |
| PR 6 duplicate resolution | `activeWorkflow.kind: duplicate_resolution` |
| PR 7 delete/update confirm | `activeWorkflow` pending delete/update |
| PR 9 trace | `activeWorkflowKind` derived from `session.activeWorkflow?.kind` |

PR 4 spec should reference PR 10 as **recommended before production dogfood across restarts** but not a hard dependency for envelope builder (envelope can accept in-memory session object built from Map until PR 10 lands).

## Recovery fallback

If session row missing but interactions exist:

- optional `rebuildSessionFromInteractions(userId, lastN=5)` best-effort recovery for `lastAgentPrompt` and `lastRouteDecision` only;
- do **not** infer destructive workflows from heuristics alone — require explicit user confirmation again.

## Target flow

```text
User confirms delete → pending_delete_confirm in session → process restart
  -> next "yes" loads session → executes delete_memory without re-search

User asks "why still asking Testing 3?" → explain_agent_state reads
  activeWorkflow + lastListResult + domain pending/saved Testing 3 summaries
```

## Testing strategy

Unit:

- `conversationSessionStore.test.ts` — CRUD, key normalization, version bump
- `conversationSession.test.ts` — routeHistory cap, entity ref cap

Integration:

- `interpretedAgent.test.ts` — create agent A, set pending delete, destroy A, create agent B, confirm delete succeeds
- `sqliteRepository.test.ts` — session row persists alongside candidates/memories

Commands:

```bash
npm test -- src/relationship/conversationSessionStore.test.ts
npm test -- src/relationship/interpretedAgent.test.ts
npm test -- src/relationship/sqliteRepository.test.ts
npm run agent:friendy:check
```

## Migration

- New table only; no backfill required.
- Empty session on first message after upgrade.
- Optional one-time import: if `pendingDelete` exists only in old Map at upgrade moment, lost on restart until PR 10 — document in implementation notes.

## Boundaries

- **Always:** SQLite session is source of truth when runtime store is sqlite; redact secrets in `raw_json`
- **Ask first:** schema changes to `conversation_sessions`; increasing session JSON size caps
- **Never:** store raw contact methods; use session as only audit log (interactions remain canonical history)

## Success criteria

- [ ] `ConversationSession` type and `conversation_sessions` SQLite table exist.
- [ ] `interpretedAgent.ts` uses session store instead of Map-only persistence when `FRIENDY_RUNTIME_STORE=sqlite`.
- [ ] `pending_delete_confirm` (and PR 6/7 workflows when landed) survives new agent instance in tests.
- [ ] PR 4 envelope builder accepts session object without reading private Map.
- [ ] PR 5 reminder TTL/complaint fields can read/write `reminderState` on session.
- [ ] Map remains optional cache; cache miss reloads from SQLite.

## Dependencies

- `docs/superpowers/specs/2026-05-21-durable-runtime-store-design.md`
- `docs/superpowers/specs/2026-05-23-pass-state-into-llm-router-design.md` (PR 4)
- `docs/superpowers/specs/2026-05-23-pending-reminder-policy-design.md` (PR 5)
- `src/relationship/interpretedAgent.ts`, `src/relationship/conversationState.ts`, `src/relationship/sqliteRepository.ts`

## Deferred follow-ups (not PR 10)

- Event-sourced `FriendyEventLog` with replay projections
- Cross-device session merge
- Session expiry/TTL for abandoned workflows (separate policy PR)
