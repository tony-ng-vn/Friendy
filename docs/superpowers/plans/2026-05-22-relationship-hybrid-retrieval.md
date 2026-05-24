# Relationship Hybrid Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the deterministic Spec B retrieval slice: generated memory search documents, SQLite FTS5 when available, merged retrieval evidence, and vague-recall eval coverage.

**Architecture:** Keep `search_memories` as the public tool boundary. Add deterministic search documents as derived state, let SQLite repositories maintain/backfill those documents plus optional FTS rows, and have `tools.ts` merge field-aware lexical candidates with document/FTS candidates before response composition.

**Tech Stack:** TypeScript, Vitest, Node 24 `node:sqlite`, SQLite FTS5 with fallback.

---

### Task 1: Retrieval Document Builder

**Files:**
- Create: `src/relationship/memorySearchDocument.ts`
- Test: `src/relationship/memorySearchDocument.test.ts`
- Modify: `docs/superpowers/README.md`

- [ ] **Step 1: Write failing tests**

Create tests that assert a `RelationshipMemory` produces deterministic text with name/event/context/tags/date and excludes `primaryContactLabel`, `candidateId`, `eventId`, phone numbers, emails, and sensor ids.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/relationship/memorySearchDocument.test.ts`

Expected: fails because `memorySearchDocument.ts` does not exist.

- [ ] **Step 3: Implement minimal builder**

Add `MemorySearchDocument`, `buildMemorySearchDocument(memory)`, `scoreMemorySearchDocument(document, terms)`, and local token helpers. The builder must only use accepted memory fields.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/relationship/memorySearchDocument.test.ts`

- [ ] **Step 5: Commit**

Commit: `feat:add memory search document builder`

### Task 2: Use Documents In Tool Ranking

**Files:**
- Modify: `src/relationship/tools.ts`
- Test: `src/relationship/tools.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving document-lexical evidence can retrieve a memory by generated document fields and that exact name/tag precision still outranks generic document overlap.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/relationship/tools.test.ts`

Expected: new document evidence test fails.

- [ ] **Step 3: Merge field and document evidence**

In `search_memories`, keep the current field-aware scorer, add document lexical candidates from `buildMemorySearchDocument`, merge by `memory.id`, and preserve current event-wide, threshold, and ambiguity behavior.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/relationship/tools.test.ts`

- [ ] **Step 5: Commit**

Commit: `feat:merge document lexical memory search`

### Task 3: SQLite Search Documents And FTS

**Files:**
- Modify: `src/relationship/repository.ts`
- Modify: `src/relationship/sqliteRepository.ts`
- Test: `src/relationship/repository.test.ts`
- Test: `src/relationship/sqliteRepository.test.ts`

- [ ] **Step 1: Write failing tests**

Add repository tests for derived document visibility after memory create/update/delete. Add SQLite tests for the `memory_search_documents` table, idempotent backfill on reopen, and FTS-backed search when `CREATE VIRTUAL TABLE ... fts5` is supported.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts`

Expected: derived-document and FTS tests fail.

- [ ] **Step 3: Implement repository derived state**

Extend `RelationshipRepository` with `listMemorySearchDocuments(userId?)` and optional `searchMemoryDocuments(userId, query, terms)`. The in-memory repository should derive documents from visible memories. The SQLite repository should create `memory_search_documents`, attempt `memory_search_fts`, backfill on open, and update/delete derived rows in the same transactions as memory writes.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts`

- [ ] **Step 5: Commit**

Commit: `feat:add sqlite memory search documents`

### Task 4: Hybrid Ranking And Product Eval

**Files:**
- Modify: `src/relationship/tools.ts`
- Modify: `src/relationship/evals/agentEvalRunner.ts`
- Modify: `src/relationship/evals/agentEvalRunner.test.ts`
- Modify: `src/relationship/evals/behavior-contract-cases.ts`

- [ ] **Step 1: Write failing tests**

Add a product eval for a vague retrieval-document query such as `Who did I save while debugging the Mac contact watcher?`, seeded with matching and non-matching memories. Assert search is called, the matching person is returned, and no generic redirect or hallucinated contact appears.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/relationship/evals/agentEvalRunner.test.ts`

Expected: new eval catalog/executable behavior fails before hybrid search is wired.

- [ ] **Step 3: Wire SQLite FTS candidates into tools**

Have `search_memories` ask `repo.searchMemoryDocuments?.(...)` for FTS/document repository candidates, merge them with field/document lexical evidence, apply existing selection rules, and keep user-facing response copy unchanged.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/relationship/tools.test.ts src/relationship/evals/agentEvalRunner.test.ts`
Run: `npm run eval:agent`

- [ ] **Step 5: Commit**

Commit: `test:add hybrid retrieval eval`

### Task 5: Notes And Verification

**Files:**
- Modify: `implementation-notes.html`
- Modify: `docs/agent-handoff.md`

- [ ] **Step 1: Update docs**

Record that Spec B deterministic retrieval is implemented, while optional embeddings/reranking remain deferred.

- [ ] **Step 2: Full verification**

Run:

```bash
npm test
npm run build
npm run eval:agent
git diff --check
```

- [ ] **Step 3: Commit and push**

Commit: `docs:record hybrid retrieval implementation`

Push `main` after the worktree is clean and verification has passed.
