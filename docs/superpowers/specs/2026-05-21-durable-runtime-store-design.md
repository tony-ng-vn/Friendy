# Friendy Durable Runtime Store Design

## Summary

Friendy needs a shared durable state layer so the explicit local contact/calendar checker and the live Spectrum/iMessage runtime can see the same pending candidates, event matches, and relationship memories.

The next architecture should add a SQLite-backed runtime store behind the existing repository/tool boundary. The product behavior should stay the same: new contacts become pending candidates, the user confirms or ignores them through iMessage, and later searches retrieve confirmed relationship memories.

## Goals

- Persist Friendy runtime state across separate Node.js processes.
- Let the local checker create pending candidates that the Spectrum/iMessage agent can later confirm, ignore, or search.
- Keep deterministic tools as the only mutation boundary for candidates and memories.
- Keep the existing in-memory repository for focused tests and fast fixtures.
- Add a SQLite-backed repository adapter without changing agent, ingestion, or transport behavior.
- Make the store location configurable for local development and future deployment.
- Keep the implementation small enough for TDD and local verification.

## Non-Goals

- Do not add Notion as the primary runtime database.
- Do not add Mem0, Membase, embeddings, or vector search.
- Do not add cloud sync.
- Do not add background contact monitoring.
- Do not add LinkedIn, X, Instagram, or other social detectors.
- Do not change Spectrum/iMessage user-facing behavior except that state can now persist across process boundaries.
- Do not remove the in-memory repository.

## Product Problem

The current system can prove the product loop locally, but the state boundary is still weak. A local checker process can detect a new contact and create a pending candidate in its own repository instance, while a separate Spectrum/iMessage process may not see that candidate later.

That breaks the core MVP moment:

```text
new phone contact -> event guess -> pending candidate -> iMessage confirmation -> saved memory -> later search
```

The MVP is not credible until this loop can survive separate process lifetimes.

## Recommended Approach

Use SQLite as the first durable runtime store.

SQLite is the right first store because it is local, durable, easy to test, and good enough for one-user/early-product runtime state. It avoids the operational cost and external latency of Notion, while being much safer than a hand-written JSON state file for separate process access.

Notion can become an optional admin mirror later. Mem0 or Membase can become optional semantic memory layers later. Neither should be the source of truth for the current confirmation loop.

## Architecture

```text
Local Contacts/Calendar checker
  -> ingestion pipeline
  -> RelationshipTools
  -> SQLite-backed RelationshipRepository
  -> pending candidate persisted

Spectrum/iMessage runtime
  -> interpreted agent
  -> RelationshipTools
  -> SQLite-backed RelationshipRepository
  -> confirm/search/ignore persisted state
```

The repository interface remains the seam. Agents, tools, transports, evals, and ingestion should not know whether the repository is in-memory or SQLite-backed.

## Store Boundary

Create a runtime store module responsible for opening the SQLite database, applying schema setup, and exposing a repository-compatible adapter.

The existing in-memory repository remains the default for most unit tests. Runtime entry points should choose the SQLite-backed repository when a persistent store path is configured.

Use Node's built-in `node:sqlite` module through `DatabaseSync`. The repo currently runs on Node 24, where this avoids adding a native package dependency for the first durable store pass.

Expected configuration:

```text
FRIENDY_RUNTIME_STORE=sqlite
FRIENDY_SQLITE_PATH=.friendy/friendy.sqlite
```

If `FRIENDY_RUNTIME_STORE` is missing, command-line checks can continue using deterministic fixture repositories unless the command explicitly needs persistence.

## Data To Persist

Persist only state needed by the MVP loop:

- users
- calendar events
- pending contact candidates
- candidate event matches or enough event data to recompute matches
- ignored candidates
- confirmed relationship memories
- agent interactions if already routed through repository logging

Avoid persisting derived formatting, response text, or UI-only state.

## Data Model

The SQLite schema should reflect existing TypeScript domain objects instead of inventing a new product model.

Required tables:

```text
users
  id primary key
  display_name
  phone_number
  timezone
  created_at
  updated_at

calendar_events
  id primary key
  user_id
  title
  starts_at
  ends_at
  location
  source
  created_at
  updated_at

contact_candidates
  id primary key
  user_id
  display_name
  detected_at
  source
  status
  raw_json
  created_at
  updated_at

candidate_event_matches
  candidate_id
  event_id
  rank
  confidence
  reason
  primary key(candidate_id, event_id)

relationship_memories
  id primary key
  user_id
  display_name
  event_id
  event_title
  context_note
  relationship_context
  contact_method_json
  tags_json
  detected_at
  confirmed_at
  raw_json
  created_at
  updated_at

agent_interactions
  id primary key
  user_id
  platform
  space_id
  inbound_text
  interpretation_json
  tool_calls_json
  outbound_text
  created_at
```

Use JSON columns as text for nested fields where the current TypeScript objects are still evolving. Store a full `raw_json` snapshot on candidates and memories so the adapter can preserve current TypeScript object shape while keeping a few indexed columns for lookup. Do not prematurely normalize every contact method, tag, or interpretation detail.

## Repository Behavior

The SQLite-backed repository should preserve the behavior of the in-memory repository:

- creating a candidate makes it visible in `list_pending_candidates`;
- confirming a candidate creates a relationship memory and removes the candidate from the pending queue;
- ignoring a candidate removes it from the pending queue without creating a memory;
- event matching works from stored calendar events and candidate timestamps;
- searching memories returns the same shape as existing search tools;
- user scoping prevents one user from seeing another user's candidates or memories.

Cross-instance behavior is the key new requirement:

```text
repo A creates candidate -> repo B lists same pending candidate
repo B confirms candidate -> repo C searches confirmed memory
```

## Entry Point Wiring

Add a small repository factory for runtime commands:

```text
createRuntimeRelationshipRepository(env)
```

Rules:

- In tests and pure fixtures, keep using `createRelationshipRepository`.
- In live Spectrum/iMessage runtime, use SQLite when configured.
- In explicit local checker, use SQLite when configured so the checker and Spectrum runtime share state.
- In local checker mock mode, allow an isolated temporary SQLite path for persistence tests.

## Error Handling

- Apply schema setup with hand-written `CREATE TABLE IF NOT EXISTS` statements when opening the runtime store.
- If SQLite cannot open, fail fast with a clear message naming `FRIENDY_SQLITE_PATH`.
- If schema setup fails, fail fast.
- If a candidate or memory payload cannot be serialized, throw before mutating state.
- Do not silently fall back from SQLite to in-memory in live runtime commands. Silent fallback would hide the exact bug this feature is meant to fix.

## Testing

Required tests:

- SQLite repository can create, list, confirm, ignore, and search using the same tool calls as the in-memory repository.
- Cross-instance test proves separate repository instances with the same SQLite file share candidates and memories.
- Local checker creates a pending candidate in SQLite and a separate interpreted agent instance can confirm it.
- Spectrum runtime factory chooses SQLite when configured and in-memory only when explicitly unconfigured.
- Existing `npm run eval:agent`, `npm run check:imessage-e2e`, `npm run ingest:check`, and `npm run ingest:local:check -- --mock` continue to pass.

## Privacy And Safety

SQLite files contain relationship memory and contact metadata. Keep the default path under `.friendy/`, which is already ignored by git. Do not commit local database files.

The store must not change consent behavior:

- detected contacts remain pending candidates;
- no candidate becomes a memory without user confirmation;
- ignored candidates should not appear in later pending queues;
- deleted or ignored state should be respected by later searches and prompts.

## Open Decisions

No product decision remains open for this spec.

Implementation should use `node:sqlite`, hand-written schema setup, and `raw_json` snapshots for evolving nested fields.
