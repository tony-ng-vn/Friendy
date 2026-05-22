# Code Commenting Guide

Short reference for Friendy source comments. For system boundaries and the agent loop, see [AI System Architecture](./ai-system-architecture.md).

## What to document

| Layer | What to write |
| --- | --- |
| File block | Purpose, module boundary, who imports/calls it |
| Exported API | JSDoc on functions, types, classes — params, returns, invariants |
| Inline | Non-obvious thresholds, security, idempotency, design tradeoffs only |

Skip test files unless setup is genuinely non-obvious.

## Core themes (cross-link, do not paste specs)

- **LLM interprets, tools mutate** — interpretation produces JSON; writes, ignores, and search go through deterministic tools ([architecture](./ai-system-architecture.md#agent-loop)).
- **Candidate before memory** — contact deltas become pending candidates; user consent promotes to searchable memory.
- **Method-centric ingestion** — new phone/email methods create candidates; name-only edits do not.
- **Deterministic consent** — pending-candidate approval and event correction bypass the model (`candidateConfirmation.ts`).
- **Scope before tools** — `scopeBoundary.ts` rejects general-assistant requests before the agent runs.

## Good examples

```typescript
/**
 * Shared relationship-agent domain types.
 *
 * Plain data objects shared by transports, ingestion, tools, and tests.
 * The LLM may produce interpretations that reference these shapes; only
 * deterministic tools mutate persisted state. See docs/ai-system-architecture.md.
 */
```

```typescript
/**
 * Classifies whether Friendy should handle a message before any relationship tools run.
 *
 * @param input.text - Raw inbound user message
 * @param input.hasPendingCandidate - Whether a consent prompt is awaiting reply
 * @returns In-scope capability, clarification question, or out-of-scope redirect
 */
export function decideMessageScope(input: ScopeBoundaryInput): ScopeDecision
```

```typescript
// Short events beat long background events — users remember the dinner, not the whole residency.
const EVENT_KIND_CONFIDENCE = { short: 0.92, long: 0.62, all_day: 0.42 } as const;
```

## Bad examples

```typescript
// Returns true if the value is yes
export function isConfirmationReply(value: string): boolean
```

```typescript
/**
 * ContactCandidate is a type that represents a contact candidate with an id and status
 * and also includes all the fields from ContactCandidateDetected plus more fields.
 */
export type ContactCandidate = ...
```

```typescript
// Loop through events and filter overlapping ones
const overlapping = events.filter((event) => { ... });
```

## Checklist before merging comment-only changes

- [ ] File block present on non-trivial modules
- [ ] Exported symbols have JSDoc where the API boundary matters
- [ ] No restated obvious code; no long spec paste
- [ ] `npm test` passes for touched modules
