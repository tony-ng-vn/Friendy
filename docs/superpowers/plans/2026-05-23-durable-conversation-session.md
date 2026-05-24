# Durable Conversation Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist multi-turn workflow state in SQLite so pending delete, duplicate resolution, reminder TTL, and router carryover survive process restarts.

**Spec:** `docs/superpowers/specs/2026-05-23-durable-conversation-session-design.md`

**Architecture:** Add `ConversationSession` type and `conversationSessionStore` on the same SQLite file as the relationship repository. Replace Map-only persistence in `interpretedAgent.ts` when `FRIENDY_RUNTIME_STORE=sqlite`; keep Map as optional cache. PR 4 envelope builder and PR 5 reminder policy read session fields instead of private Map state.

**Tech Stack:** TypeScript, Vitest, SQLite, interpreted agent, router envelope (PR 4), reminder policy (PR 5).

**Depends on:** Durable runtime store (merged). **Recommended after:** PR 4–5 land; **integrates with:** PR 6–7 workflow frames, PR 9 trace `activeWorkflowKind`.

**Does not block:** PR 4–9 May 23 log fixes.

---

## File Structure

- Create: `src/relationship/conversationSession.ts` — `ConversationSession`, `ActiveWorkflow`, key helpers
- Create: `src/relationship/conversationSessionStore.ts` — store interface + in-memory impl
- Create: `src/relationship/conversationSessionStore.test.ts`
- Create: `src/relationship/conversationSession.test.ts` — caps, defaults
- Modify: `src/relationship/sqliteRepository.ts` — `conversation_sessions` table + SQLite store
- Modify: `src/relationship/interpretedAgent.ts` — load/upsert session; Map as cache only
- Modify: `src/relationship/routerInputEnvelope.ts` — accept session object (PR 4 integration)
- Modify: `src/relationship/pendingReminderPolicy.ts` — read `reminderState` from session (PR 5 integration)
- Modify: `src/relationship/runtime/friendyRuntimeCli.ts` — wire session store when sqlite runtime
- Modify: `implementation-notes.html`, `docs/agent-handoff.md`

---

## Task 1: Session Types and Helpers

**Files:** `conversationSession.ts`, `conversationSession.test.ts`

- [ ] **Step 1:** Write failing tests for `emptySession(key)`, routeHistory cap (10), recentEntityRefs cap.
- [ ] **Step 2:** Implement types from spec: `ActiveWorkflow` union, `ConversationSession`, `ConversationSessionKey`.
- [ ] **Step 3:** Add helpers: `appendRouteHistory`, `touchUpdatedAt`, migrate from legacy `ConversationContext`.
- [ ] **Step 4:** Run session unit tests.

---

## Task 2: In-Memory Session Store

**Files:** `conversationSessionStore.ts`, `conversationSessionStore.test.ts`

- [ ] **Step 1:** Write failing CRUD tests for get/upsert/delete by key (normalize null `spaceId`).
- [ ] **Step 2:** Implement in-memory store for unit tests.
- [ ] **Step 3:** Run store tests.

---

## Task 3: SQLite Table and Store

**Files:** `sqliteRepository.ts`, `sqliteRepository.test.ts`

- [ ] **Step 1:** Write failing test: session round-trips through SQLite on same DB as memories.
- [ ] **Step 2:** Add `conversation_sessions` table + `createSqliteConversationSessionStore`.
- [ ] **Step 3:** Run sqlite tests.

---

## Task 4: Agent Load/Write Path

**Files:** `interpretedAgent.ts`, `interpretedAgent.test.ts`

- [ ] **Step 1:** Write failing restart test: agent A sets `pending_delete_confirm` → new agent B loads session → confirm delete works.
- [ ] **Step 2:** At turn start: `sessionStore.getSession(key) ?? emptySession(key)`.
- [ ] **Step 3:** At turn end: update session fields (workflow, lastListResult, lastRouteDecision, carryover, reminderState); upsert.
- [ ] **Step 4:** When sqlite runtime: Map is write-through cache only; reload on cache miss.
- [ ] **Step 5:** Run interpreted agent tests.

---

## Task 5: PR 4 and PR 5 Integration Hooks

**Files:** `routerInputEnvelope.ts`, `pendingReminderPolicy.ts`, tests

- [ ] **Step 1:** Change envelope builder input to accept `ConversationSession` (or adapter from session).
- [ ] **Step 2:** Change reminder policy to read/write `session.reminderState` instead of Map-only `reminderState`.
- [ ] **Step 3:** Run PR 4/5 related tests if present; skip gracefully if PR 4/5 not merged yet (document in notes).

---

## Task 6: Runtime Wiring and Docs

**Files:** `friendyRuntimeCli.ts`, docs

- [ ] **Step 1:** Pass session store into interpreted agent factory for sqlite runtime paths.
- [ ] **Step 2:** Update handoff + implementation notes with migration note (empty session on upgrade).
- [ ] **Step 3:** Run full verification:

```bash
npm test -- src/relationship/conversationSession.test.ts
npm test -- src/relationship/conversationSessionStore.test.ts
npm test -- src/relationship/sqliteRepository.test.ts
npm test -- src/relationship/interpretedAgent.test.ts
npm run agent:friendy:check
npm run build
```

---

## Recovery Fallback (Optional Task)

- [ ] Implement `rebuildSessionFromInteractions(userId, lastN=5)` for `lastAgentPrompt` / `lastRouteDecision` only — best effort, no destructive workflow inference.
