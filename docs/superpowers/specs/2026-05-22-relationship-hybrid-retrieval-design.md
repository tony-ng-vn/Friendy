# Relationship Hybrid Retrieval Design

## Summary

Friendy should eventually retrieve people from vague human memory, not just exact keyword overlap. Spec A fixes the front-door routing and query normalization bug so valid relationship queries reach `search_memories`. This Spec B designs the next retrieval layer after that routing work is stable.

The retrieval upgrade should be staged:

1. generate a stable searchable document for each relationship memory;
2. add local SQLite FTS5 retrieval when available;
3. merge FTS/current field-aware lexical results through deterministic scoring;
4. add optional embeddings through an explicit adapter after local retrieval quality is proven;
5. optionally rerank only the retrieved candidates, never the whole memory database.

The default implementation must remain local, deterministic, auditable, and safe for personal relationship data.

## Problem

The current `search_memories` implementation is field-aware and transparent. It scores extracted query terms across memory fields such as name, role, project, school, alias, context, tags, and event. This works for clear lexical recall:

```text
Who did I meet at Photon Residency II?
Who was making the Swift project?
Who slept in the same bed?
```

It is weaker for vague recall and paraphrases:

```text
Who was from the thing we were building?
Who was connected to the app testing?
Who did I save while debugging the Mac contact watcher?
Who was the person from that demo prep?
```

Spec A handles the most urgent failure: valid relationship-memory queries must reach search and should be normalized before scoring. That is necessary but not sufficient. Once routing is reliable, Friendy needs a retrieval layer that can combine exact fields, generated retrieval text, full-text search, and optional semantic similarity.

## Goals

- Improve recall quality for vague relationship-memory searches after Spec A is implemented.
- Keep current field-aware lexical scoring as a transparent baseline.
- Add a generated retrieval document per memory so all retrieval methods use the same normalized text.
- Add SQLite-backed full-text retrieval before adding embeddings.
- Design an optional embedding path that is explicit, configurable, and disabled by default.
- Merge and score candidates deterministically before response composition.
- Preserve grounded responses: Friendy may only answer using retrieved memory IDs.
- Add retrieval quality evals that test paraphrases, ambiguity, no-match behavior, and no hallucinated contacts.

## Non-Goals

- Do not change front-door routing; that is Spec A.
- Do not let the LLM search the entire database directly.
- Do not send raw Contacts data, phone numbers, emails, sensor events, or logs to an embedding provider.
- Do not make network embedding calls in tests or default local runtime.
- Do not replace the existing `RelationshipRepository` persistence contract with a vector database.
- Do not require embeddings for the first retrieval upgrade.
- Do not change candidate confirmation, consent, update, delete, or onboarding behavior.

## Prerequisites

Spec B should start only after Spec A is implemented and verified:

- broad relationship queries route to `search_memories`;
- query normalization is in place;
- route/search traces show whether search ran;
- existing evals pass with zero unsafe mutations and zero hallucinations.

If Spec A is not complete, retrieval work can hide the real bug by improving search quality for queries that still never reach search.

## Retrieval Architecture

```text
search_memories(userId, request)
  ↓
build effective query
  - route exactTerms
  - normalized query
  - raw query fallback
  ↓
retrieve candidates
  - current field-aware lexical scorer
  - generated retrieval document scorer
  - SQLite FTS5 scorer when available
  - optional embedding scorer when explicitly enabled
  ↓
merge by memoryId
  ↓
apply metadata filters
  - userId
  - personName
  - eventName
  - tags/topic
  - date context where available
  ↓
deterministic rank
  ↓
return MemorySearchResult[]
  ↓
grounded response composer
```

The retrieval layer should remain behind the existing tool boundary. Callers should still ask for memory search; they should not know whether a result came from field scoring, FTS, embeddings, or a merged rank.

## Retrieval Document

Each confirmed relationship memory should have a generated search document:

```ts
type MemorySearchDocument = {
  memoryId: string;
  userId: string;
  text: string;
  fields: {
    displayName: string;
    eventTitle?: string;
    contextNote: string;
    relationshipContext?: string;
    tags: string[];
    dateText?: string;
  };
  updatedAt: string;
};
```

The `text` field should be deterministic and human-readable:

```text
Name: Testing 12
Event: testing Friendy
Context: Met them during testing Friendy
Tags: testing, friendy
```

Rules:

- Include display name, event title, normalized context, relationship context, tags, and date text.
- Exclude phone numbers, emails, raw contact identifiers, sensor event IDs, prompt attempt IDs, and raw logs.
- Rebuild the document when a memory is created, updated, or deleted.
- Use the same document for FTS indexing and optional embeddings so retrieval behavior is easier to debug.

## SQLite FTS5 Layer

The first concrete retrieval upgrade should be local full-text search.

Add a SQLite FTS table if the runtime SQLite build supports FTS5:

```sql
CREATE VIRTUAL TABLE memory_search_fts USING fts5(
  memory_id UNINDEXED,
  user_id UNINDEXED,
  display_name,
  event_title,
  context_note,
  relationship_context,
  tags,
  search_text
);
```

Design constraints:

- FTS rows are derived from confirmed memories.
- Deleting a memory removes the matching FTS row.
- Updating a memory replaces the matching FTS row.
- If FTS5 is unavailable, Friendy must keep using the current lexical scorer without crashing.
- Tests should not require a platform-specific SQLite build feature unless the test first verifies FTS5 support.

FTS scoring should not replace field-aware scoring. It should add candidates and evidence.

## Optional Embedding Layer

Embeddings should be optional and disabled by default.

```ts
type MemoryEmbeddingProvider = {
  name: string;
  embed(texts: string[]): Promise<Array<{ text: string; vector: number[] }>>;
};
```

Runtime rules:

- No embedding provider is used unless explicitly configured.
- Tests use a deterministic fake provider, not network calls.
- The embedding input is the generated `MemorySearchDocument.text`, not raw Contacts/Spectrum/sensor data.
- If embedding generation fails, lexical and FTS retrieval still work.
- Embedding vectors are tied to `memoryId` and refreshed on memory create/update/delete.
- Provider name and vector dimensions are stored so incompatible embeddings are not mixed.

SQLite storage can be simple at first:

```sql
CREATE TABLE memory_embeddings (
  memory_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  source_text_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

This JSON-vector storage is not the final high-performance design. It is acceptable for the local MVP because memory counts are expected to be small and it keeps the repository simple. If retrieval grows beyond local scan needs, a later ADR can choose a vector extension or external vector store.

## Candidate Merge and Ranking

Each retrieval source should return candidate evidence:

```ts
type RetrievalCandidate = {
  memoryId: string;
  source: "field_lexical" | "document_lexical" | "fts" | "embedding";
  score: number;
  matchedTerms: string[];
};
```

Merge by `memoryId`:

```text
mergedScore =
  fieldLexicalScore * 1.0
  + documentLexicalScore * 0.6
  + ftsScore * 0.8
  + embeddingScore * 0.7
  + exactNameBoost
  + exactTagBoost
  + routeFilterBoost
```

The exact weights should be introduced behind tests and adjusted only when evals show a ranking problem. Exact name, explicit tags, and event filters should continue to outrank vague semantic similarity.

Selection rules:

- Event-wide recall may return up to 10 relevant memories.
- Single-person lookup should collapse to one result only when the top score is clearly ahead.
- Near ties should return an ambiguous multi-match response.
- No candidate above threshold should produce the existing no-match reply.
- The response composer must not mention retrieval sources, scores, embeddings, or FTS diagnostics.

## LLM Reranking

LLM reranking is optional and later than FTS/embedding retrieval.

If added, it must operate only over retrieved candidates:

```text
Input:
  user query
  up to 10 candidate memory summaries with IDs

Output:
  selected memory IDs
  confidence
  short rationale for logs/evals only
```

Rules:

- The model can only select from provided memory IDs.
- The model cannot invent names, contact methods, events, or memory facts.
- If reranking fails or returns invalid IDs, Friendy uses deterministic merged ranking.
- User-facing responses still come from `responseComposer.ts`.

Do not build LLM reranking until deterministic retrieval evals show a clear need.

## Privacy and Safety

Relationship memories are personal data. Retrieval must preserve the current consent and grounding boundaries.

Requirements:

- Index only confirmed memories.
- Do not index pending candidates until the user confirms them.
- Do not index ignored, expired, or deleted candidates.
- Do not index raw phone numbers or email addresses.
- Do not index raw Spectrum messages beyond the accepted memory context.
- Do not expose retrieval internals in user-facing copy.
- Keep no-match behavior conservative when confidence is low.
- Preserve memory deletion semantics across search documents, FTS rows, and embeddings.

## Test Strategy

Retrieval document tests:

- Creating a confirmed memory produces deterministic search text.
- Updating a memory updates search text.
- Deleting a memory removes the derived document.
- Generated text excludes phone numbers, emails, sensor ids, prompt ids, and raw contact identifiers.

FTS tests:

- If FTS5 is available, broad paraphrases retrieve the expected memories.
- If FTS5 is unavailable, the repository falls back to lexical search without throwing.
- FTS results merge with current field-aware results by memory ID.

Embedding adapter tests:

- A fake provider stores vectors for generated retrieval text.
- Failed embedding generation does not break lexical/FTS search.
- Mixed provider or dimension mismatch is rejected or ignored deterministically.
- Deleted memories remove embedding rows.

Ranking tests:

- Exact name beats semantic-only similarity.
- Exact tag/topic beats generic event overlap.
- Event-wide recall returns multiple relevant people.
- Ambiguous near ties ask the user which person they mean.
- No-match remains no-match when retrieved candidates are below threshold.

Product evals:

```text
Who was from the thing we were building?
Who was connected to the app testing?
Who did I save while debugging the Mac contact watcher?
Who was the person from that demo prep?
Anyone from the project we were testing?
```

Expected:

- relevant saved memories are returned when seeded;
- no hallucinated contacts;
- no unsafe mutations;
- no generic scope redirect for in-scope recall;
- no answer when only weak unrelated overlap exists.

## Implementation Staging

### PR 1: Retrieval Document

- Add a deterministic `MemorySearchDocument` builder.
- Add tests for included and excluded fields.
- Use the document text in an internal document-lexical scorer.
- Keep the current public `search_memories` interface stable.

### PR 2: SQLite FTS5

- Add FTS capability detection.
- Add FTS schema and synchronization for create/update/delete.
- Merge FTS candidates with existing lexical candidates.
- Preserve fallback when FTS5 is unavailable.

### PR 3: Hybrid Ranking

- Introduce retrieval candidate evidence and merge-by-memory ranking.
- Add ranking thresholds for single result, multi-match, and no-match.
- Extend evals for vague recall and ambiguity.

### PR 4: Optional Embeddings

- Add `MemoryEmbeddingProvider`.
- Add deterministic fake provider tests.
- Add SQLite embedding storage with provider/dimension/source hash.
- Keep provider disabled by default.
- Merge embedding candidates only when explicitly configured.

### PR 5: Optional Reranking

- Add candidate-only reranking behind a flag if deterministic hybrid retrieval is not enough.
- Keep invalid rerank output non-fatal.
- Keep response composition grounded in selected memory IDs.

## Acceptance Criteria

- Existing field-aware search behavior still passes.
- Search documents are deterministic and exclude private transport/contact internals.
- FTS-backed search improves vague recall when FTS5 is available and falls back cleanly when not.
- Hybrid ranking preserves exact-name and exact-tag precision.
- Optional embeddings never run by default and never run in tests without a fake provider.
- Memory update/delete operations keep derived retrieval state consistent.
- Product evals include vague recall cases and pass with zero hallucinated contacts and zero unsafe mutations.
- `npm test`, `npm run build`, and `npm run eval:agent` pass after implementation.
