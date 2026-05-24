# Identity Resolution Design (Concrete Fix Stack — PR 6)

## Summary

PR 6 introduces a first-class **person identity layer** so Friendy can distinguish “same display name, different people” and “same person, renamed contact” without treating `displayName` as identity.

Today, candidates and memories are keyed informally by display name, candidate id, and contact-method hashes scattered across ingestion types. That causes the Testing 3 failure class: a saved memory and a pending candidate can share a display name while representing different contact-method identities, and Friendy has no durable workflow to ask the user to disambiguate.

PR 6 adds:

- `PersonIdentity` — stable person record owned by a Friendy user
- `AppleContactLink` — link from a person to Apple contact identifiers + method fingerprints
- `RelationshipMemory` — references `personId`; keeps `displayName` as presentation snapshot only
- `ContactCandidate` — references `personId?` until confirmed; never uses display name as primary key
- `duplicate_resolution` active workflow with same/different/ignore/not_sure replies

This spec depends on PR 3 (structured intents) and PR 5 (pending reminder suppression during disambiguation). It unblocks the RED eval `same-name-pending-contact-disambiguation-regression`.

## Stack numbering

| PR | Topic | Status |
|----|--------|--------|
| PR 1 | Regression eval freeze | Done |
| PR 2 | Real `list_people` tool | Done |
| PR 3 | Structured intent router | Done |
| PR 4 | Pass state into LLM router | Spec in progress |
| PR 5 | Pending reminder policy | Spec in progress |
| PR 6 | Identity resolution + duplicate workflow | **This spec** |
| PR 7 | Robust delete/update + fuzzy target lookup | Spec in progress |
| PR 8 | Sensor normalization + ack lifecycle | Spec in progress |
| PR 9 | Strict-mode dogfooding trace | Spec in progress |

## Problem

### Failure — display name is doing identity work

Current domain types (`src/relationship/types.ts`):

- `ContactCandidate` and `RelationshipMemory` both carry `displayName` as the primary human-visible identifier.
- Candidate ids are derived from display name slugs in `eventMapper.ts`.
- Duplicate audit groups by normalized display name only.
- Same-name pending fast path (`composeSameOrDifferentPendingReply`) exists but has no durable person record or workflow state.

From the regression freeze (`2026-05-23-friendy-regression-freeze-design.md`, Case 5) and live Testing 3 transcript:

- User already has saved memory **Testing 3** from event “testing Friendy”.
- A new contact delta arrives also named **Testing 3**.
- Friendy must ask: *“I already remember Testing 3 from testing Friendy. Is this the same Testing 3, or a different person?”*
- Until resolved, Friendy must not treat the pending candidate as the saved person, must not auto-confirm, and must not spam stale pending reminders (PR 5).

### Non-negotiable from introspection / architecture docs

- `displayName` is **presentation only** (also stated in `2026-05-21-local-macos-sensor-runtime-design.md`).
- Identity for a detected contact = stable contact identifiers + normalized method fingerprint, not the label the user typed in Contacts.
- Person identity must survive display-name edits and support multiple Apple contact links over time.

## Goals

- Add durable person identity records separate from display names.
- Link candidates and memories to `personId` while preserving existing user-facing copy patterns.
- When a new candidate’s display name matches an existing saved person **or** memory display name, open a `duplicate_resolution` workflow instead of silently queueing another ambiguous prompt.
- Support user replies: **same**, **different**, **ignore**, **not sure** (deterministic parsing; no LLM judgment on identity).
- On **same**: attach candidate to existing `personId`; continue normal confirm flow for event/context note.
- On **different**: create new `PersonIdentity`; continue as independent candidate.
- On **ignore**: mark candidate ignored; do not create person link.
- On **not sure**: keep workflow open; ask a shorter clarifying question; do not mutate memory.
- Suppress pending reminders while `duplicate_resolution` is active (PR 5 integration).
- Populate `ListedPerson.personId` from list-people tool (placeholder from PR 2 spec).
- Add SQLite persistence for person + link tables (extends PR 21 durable store pattern).
- Add eval + unit coverage for Testing 3 same-name scenario.

## Non-Goals

- Do not merge memories automatically on “same” — user still confirms event/context via existing `confirm_candidate` flow.
- Do not implement global contact dedupe across users.
- Do not expose raw phone/email in traces or user replies.
- Do not replace method-centric ingestion rules (new method still creates candidate).
- Do not build a general entity-resolution ML model.
- Do not change OpenAI payload shape (PR 4) — workflow state may be passed later.

## Design approaches considered

### Approach A — Display-name index only

Extend duplicate audit grouping and regex guards.

| Pros | Cons |
|------|------|
| Smallest schema change | Does not solve rename / method collision / durable workflow |
| | Still conflates identity with presentation |

**Verdict:** Rejected.

### Approach B — Person identity tables + active workflow frame (recommended)

Add `PersonIdentity` + `AppleContactLink`, reference from candidate/memory, store active `duplicate_resolution` in conversation/runtime state.

| Pros | Cons |
|------|------|
| Matches introspection model | Requires SQLite migration + backfill |
| Clear workflow boundary | More types and repository methods |
| Testable deterministic transitions | |

**Verdict:** Recommended.

### Approach C — External identity service

Separate microservice for person resolution.

| Pros | Cons |
|------|------|
| Clean boundary | Overkill for Mac MVP |

**Verdict:** Rejected.

## Domain model

### PersonIdentity

Stable person record scoped to one Friendy user.

```ts
export type PersonIdentity = {
  id: string;                 // person_<uuid>
  userId: string;
  canonicalDisplayName: string; // latest preferred label; not a lookup key
  createdAt: string;
  updatedAt: string;
  mergedIntoPersonId?: string;  // reserved; unused in PR 6
};
```

Rules:

- `canonicalDisplayName` updates when user confirms a candidate or edits memory display name.
- Search, delete, duplicate detection must not use this field as the sole key.

### AppleContactLink

Binds Apple/sensor identity signals to a person.

```ts
export type AppleContactLink = {
  id: string;
  personId: string;
  userId: string;
  contactIdentifier?: string;
  unifiedContactIdentifier?: string;
  containerIdentifier?: string;
  methodFingerprint: string;     // stable hash of normalized phones/emails
  displayNameSnapshot: string;   // presentation at link time
  sensorEventId?: string;
  linkedAt: string;
};
```

Rules:

- Method fingerprint matches existing ingestion normalization (reuse contact snapshot hashing).
- Multiple links may point to one person (re-import, device sync).
- Candidate confirmation creates or updates link.

### RelationshipMemory (changes)

```ts
export type RelationshipMemory = {
  // existing fields...
  personId: string;            // required for new memories; backfilled in migration
  displayName: string;         // presentation snapshot only
};
```

### ContactCandidate (changes)

```ts
export type ContactCandidate = {
  // existing fields...
  personId?: string;             // set after duplicate_resolution or on create when method matches existing link
  suspectedDuplicatePersonId?: string;
  duplicateResolutionStatus?: "pending" | "same" | "different" | "ignored" | "not_sure";
};
```

## Duplicate resolution workflow

### Trigger

When ingesting or prompting a new pending candidate:

```text
if normalizedDisplayName(candidate) matches normalizedDisplayName(any saved memory OR any PersonIdentity.canonicalDisplayName)
AND candidate.methodFingerprint does not already resolve to an existing AppleContactLink
then open duplicate_resolution workflow
```

Matching rules:

- Compare normalized display names (trim, lowercase, collapse whitespace).
- Also trigger when method fingerprint matches a link but display name diverges significantly (rename path) — ask confirm, do not auto-merge.

Do **not** trigger when method fingerprint resolves unambiguously to an existing person (attach `personId` silently and continue normal pending flow).

### Active workflow kind

Add to conversation / runtime active frame:

```ts
type ActiveWorkflowKind = "pending_contact_confirm" | "duplicate_resolution" | "pending_delete_confirm" | "pending_update_confirm";

type DuplicateResolutionFrame = {
  kind: "duplicate_resolution";
  candidateId: string;
  suspectedPersonId: string;
  displayName: string;
  priorEventTitle?: string;
};
```

### User-facing copy (deterministic composer)

Initial prompt example:

```text
I already remember Testing 3 from testing Friendy. Is this the same Testing 3, or a different person?
Reply same, different, ignore, or not sure.
```

Follow-ups:

| Reply | Action |
|-------|--------|
| `same` / `same person` / `yes same` | Attach candidate to suspected person; proceed to normal event/context confirmation |
| `different` / `different person` / `no different` | Create new `PersonIdentity`; clear suspected link |
| `ignore` | Ignore candidate via existing tool path |
| `not sure` / `unsure` | Short clarify: “No problem — reply same if it's the person you already saved, or different if it's someone new.” |

Parsing lives in new `duplicateResolution.ts` (mirror `candidateConfirmation.ts` style). No new top-level regex branches in `agentCore.ts`.

### Routing

- LLM may classify messy text, but resolution transitions are deterministic tools:
  - `resolve_duplicate_person`
  - existing `ignore_candidate`
- `interpretedAgent.ts` checks active `duplicate_resolution` frame **before** generic pending-candidate confirm routing.
- Intent `duplicate_resolution_reply` (or reuse `confirm_candidate` with frame guard) — prefer explicit intent in PR 3 schema extension.

## Persistence

SQLite tables (extend `sqliteRepository.ts`):

- `person_identities`
- `apple_contact_links`
- optional `duplicate_resolution_events` audit log

Migration / backfill:

1. For each existing memory, create `PersonIdentity` + link from `candidateId` contact metadata when available.
2. Else create person from memory row with method fingerprint = hash(displayName + memory.id) temporary until relink on next sensor event.
3. Set `RelationshipMemory.personId` on all rows.

In-memory repository used in tests mirrors the same API.

## Repository API (sketch)

```ts
findPersonByMethodFingerprint(userId, fingerprint): PersonIdentity | undefined;
findPeopleByDisplayNameNormalized(userId, displayName): PersonIdentity[];
createPersonIdentity(input): PersonIdentity;
linkAppleContact(input): AppleContactLink;
attachCandidateToPerson(candidateId, personId): ContactCandidate;
```

## Target flow

```text
sensor/contact delta
  -> create candidate (method-centric rules)
  -> if display-name collision with saved person/memory
       -> set suspectedDuplicatePersonId
       -> send duplicate_resolution prompt
       -> wait for same/different/ignore/not_sure
  -> else normal pending confirm prompt

user: "same"
  -> attach personId
  -> continue confirm_candidate flow (event/note)

user: "different"
  -> new PersonIdentity
  -> continue confirm_candidate flow as new person
```

## Trace / eval expectations

Extend `FriendyTrace`:

```ts
activeWorkflowKind?: "duplicate_resolution" | ...;
selectedTool?: string;
```

Eval case `same-name-pending-contact-disambiguation-regression` must pass:

- Opens duplicate prompt before generic context nag.
- Does not call `confirm_candidate` before resolution.
- `same` attaches person and continues; `different` creates distinct person id.

## Testing strategy

- Unit: `duplicateResolution.ts` reply parsing.
- Unit: repository person/link CRUD + backfill.
- Integration: `interpretedAgent.test.ts` same-name scenario with saved memory + pending candidate.
- Eval: un-RED `same-name-pending-contact-disambiguation-regression`.

Commands:

```bash
npm test -- src/relationship/duplicateResolution.test.ts
npm test -- src/relationship/interpretedAgent.test.ts
npm test -- src/relationship/sqliteRepository.test.ts
npm run eval:agent
```

## Boundaries

- **Always:** keep display name out of primary keys; deterministic composers for workflow copy.
- **Ask first:** SQLite schema migration affecting existing `.friendy/friendy.sqlite` files.
- **Never:** auto-merge memories on name match; expose raw contact methods in prompts.

## Success criteria

- [ ] `PersonIdentity`, `AppleContactLink` types and SQLite tables exist.
- [ ] New memories and confirmed candidates always have `personId`.
- [ ] Display-name collision opens `duplicate_resolution` with example copy above.
- [ ] `same` / `different` / `ignore` / `not sure` behave as specified.
- [ ] `same-name-pending-contact-disambiguation-regression` eval passes.
- [ ] PR 5 reminder policy suppresses nags during active duplicate resolution.

## Dependencies

- `docs/superpowers/specs/2026-05-23-friendy-regression-freeze-design.md`
- `docs/superpowers/specs/2026-05-23-pending-reminder-policy-design.md`
- `docs/superpowers/specs/2026-05-21-durable-runtime-store-design.md`
- `docs/superpowers/specs/2026-05-21-local-macos-sensor-runtime-design.md`
- `docs/superpowers/specs/2026-05-23-friendy-list-people-tool-design.md`
