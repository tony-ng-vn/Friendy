# Friendy List People Tool Design

## Summary

Add `list_people` as a real deterministic Friendy tool instead of routing list-style requests through `search_memories`.

This is PR 2 after the regression-freeze work. The core change is a boundary fix:

```text
list/inventory requests -> list_people
clue/recall requests -> search_memories
```

`list_people` should return structured people, memory summaries, duplicate groups, and pending candidates so the response composer can produce grounded inventory answers such as:

```text
I remember these people from testing Friendy:

- Testing 12 - met during testing Friendy
- Testing 1 - testing Friendy
- Testing 2 - met during testing Friendy
- Testing 3 - met during testing Friendy

I also see possible duplicates:
- Testing 1 appears twice
- Testing 2 appears twice
- Testing 3 appears as both "Testing 3" and "Testing 3 from testing Friendy"
```

## Problem

Today `list_people` is not a real tool. In `interpretedAgent.ts`, `list_people` is rewritten into `search_memory`, then `searchMemories()` pushes `search_memories` and calls `tools.search_memories()`.

That creates three product failures:

- list requests can inherit search ambiguity behavior;
- list requests can return all saved people when the user asked for a filtered list;
- list responses can append stale pending-contact reminders that are unrelated to the list request.

The user-facing symptom from the live log was:

```text
List me in bullet of all people I met testing friendy
```

Friendy responded by listing all saved people, including unrelated people and stale pending reminders. That is inventory/list behavior being forced through a recall/search path.

## Goals

- Add a first-class `list_people` tool to `createRelationshipTools`.
- Add `list_people` to `AgentToolCall`.
- Route `intent: "list_people"` to `tools.list_people`, not `tools.search_memories`.
- Return structured data that groups memories by likely person identity.
- Include possible duplicate groups in the structured result.
- Optionally include pending candidates when `includePending: true`.
- Support filtered list requests such as "people I met testing Friendy" without using search fallback.
- Preserve deterministic grounding: the response composer can only format returned people, duplicates, and pending candidates.
- Make the existing regression-freeze case `duplicate-pending-filtered-list-regression` pass.

## Non-Goals

- Do not implement Apple Contacts mutation.
- Do not silently read Apple Contacts unless a real read-only adapter already exists and is explicitly wired.
- Do not add embeddings, FTS, reranking, or semantic search.
- Do not solve full identity resolution. Duplicate grouping can be deterministic and conservative.
- Do not delete, merge, or edit memories as part of listing.
- Do not make the model directly list people from memory. The model routes; deterministic code lists.

## Tool Input

Add this public tool input:

```ts
type ListPeopleSource = "friendy_memory" | "apple_contacts" | "both";

type ListPeopleRequest = {
  source: ListPeopleSource;
  limit: number;
  cursor?: string;
  dedupeByPerson?: boolean;
  includePending?: boolean;
};
```

The route/search layer may also carry filter clues. To keep the public tool focused while supporting filtered inventory requests, execution should derive an internal request:

```ts
type InternalListPeopleRequest = ListPeopleRequest & {
  userId: string;
  filter?: {
    rawText?: string;
    exactTerms?: string[];
    eventName?: string;
    topic?: string;
    tags?: string[];
  };
};
```

For:

```text
List me in bullet of all people I met testing friendy
```

the route should be equivalent to:

```json
{
  "intent": "list_people",
  "search": {
    "mode": "list_people",
    "semanticQuery": "people I met testing Friendy",
    "exactTerms": ["testing", "friendy"],
    "filters": {
      "topic": "testing Friendy",
      "tags": ["testing", "friendy"]
    }
  }
}
```

Then execution calls:

```ts
tools.list_people(userId, {
  source: "friendy_memory",
  limit: 20,
  dedupeByPerson: true,
  includePending: true,
  filter: {
    rawText: message.text,
    exactTerms: ["testing", "friendy"],
    topic: "testing Friendy",
    tags: ["testing", "friendy"]
  }
});
```

The exact TypeScript signature can be either:

```ts
list_people(userId: string, request: InternalListPeopleRequest): ListPeopleResult
```

or:

```ts
list_people(userId: string, request: ListPeopleRequest, filter?: InternalListPeopleRequest["filter"]): ListPeopleResult
```

Prefer the first option because it keeps the deterministic execution layer explicit.

## Source Handling

Implement `source: "friendy_memory"` in this PR.

For `source: "apple_contacts"` and `source: "both"`:

- If no read-only Apple Contacts adapter exists, return deterministic `unsupportedSources` metadata.
- Do not pretend Apple Contacts data was checked.
- Do not mutate Apple Contacts.
- Do not make the response composer say "contacts" when only Friendy memory was listed.

Recommended behavior:

```ts
if (request.source === "apple_contacts") {
  return {
    people: [],
    duplicateGroups: [],
    pendingCandidates: [],
    unsupportedSources: ["apple_contacts"],
    nextCursor: undefined
  };
}

if (request.source === "both") {
  return {
    ...listFriendyMemoryPeople(request),
    unsupportedSources: ["apple_contacts"]
  };
}
```

The response can say:

```text
I can list people from Friendy memory right now. Apple Contacts listing is not connected yet.
```

## Tool Output

Add structured output:

```ts
type ListedPersonMemory = {
  memoryId: string;
  summary: string;
};

type ListedPerson = {
  personId?: string;
  displayName: string;
  memories: ListedPersonMemory[];
  duplicateGroupId?: string;
  pendingCandidateIds?: string[];
};

type DuplicateGroup = {
  duplicateGroupId: string;
  reason: "same_display_name" | "similar_display_name" | "same_contact_method" | "pending_matches_saved";
  displayNames: string[];
  memoryIds: string[];
  pendingCandidateIds: string[];
};

type PendingCandidateSummary = {
  candidateId: string;
  displayName: string;
  status: "pending" | "prompted";
};

type ListPeopleResult = {
  people: ListedPerson[];
  duplicateGroups: DuplicateGroup[];
  pendingCandidates: PendingCandidateSummary[];
  appliedFilterLabel?: string;
  nextCursor?: string;
  unsupportedSources?: ListPeopleSource[];
};
```

`summary` must be generated from saved memory fields, such as:

- `Testing Friendy`
- `met during testing Friendy`
- `community lead at Photon Residency II`

Do not expose raw search scores, internal reasons, phone numbers, emails, or raw candidate payloads.

## Filtering Rules

Filtering is deterministic and lexical for this PR.

When `filter.exactTerms` or `filter.tags` are present:

- match against display name;
- memory event title;
- context note;
- tags;
- derived memory search document text if already available.

All meaningful filter terms should match for short filters like `testing friendy`. Generic words such as `people`, `list`, `bullet`, `met`, `contacts`, and `all` should not be required filter terms.

If the route has no filter, list all Friendy memories up to `limit`.

## Dedupe and Duplicate Groups

When `dedupeByPerson: true`, the tool should group records conservatively:

- exact normalized display name groups together;
- same saved contact method or candidate id groups together when present;
- pending candidate with same normalized display name as a saved memory creates a duplicate group;
- contextual suffix variants group together when deterministic, such as `Testing 3` and `Testing 3 from testing Friendy`.

For this PR, contextual suffix grouping should be limited to names that normalize to:

```text
<base name>
<base name> from <context>
```

Do not add fuzzy edit-distance grouping in this PR. That belongs to the later duplicate-audit/fuzzy-identity work.

The output should not merge memories destructively. It only groups them in the response.

Example:

```json
{
  "people": [
    {
      "displayName": "Testing 1",
      "memories": [
        { "memoryId": "memory_testing_1_a", "summary": "Testing Friendy" },
        { "memoryId": "memory_testing_1_b", "summary": "im just testing for friendy at the moment" }
      ],
      "duplicateGroupId": "duplicate_testing_1"
    }
  ],
  "duplicateGroups": [
    {
      "duplicateGroupId": "duplicate_testing_1",
      "reason": "same_display_name",
      "displayNames": ["Testing 1"],
      "memoryIds": ["memory_testing_1_a", "memory_testing_1_b"],
      "pendingCandidateIds": []
    }
  ],
  "pendingCandidates": []
}
```

## Pending Candidates

`includePending: true` should add pending/prompted candidates to `pendingCandidates` and link them to listed people when likely matching.

Rules:

- If a pending candidate has the same normalized display name as a listed person, add its id to that person's `pendingCandidateIds`.
- Also add a `pending_matches_saved` duplicate group.
- Do not append pending reminders automatically from the generic post-response hook for list responses.
- If the user explicitly asked for pending contacts, the response composer may include a pending section.

For ordinary list requests, duplicate/pending information should be informative, not a stale "I still need context" reminder.

## Routing Changes

Current behavior:

```text
intent: list_people
-> rewritten to search_memory
-> search_memories
-> composeListPeopleReply(search matches)
```

Target behavior:

```text
intent: list_people
-> policy validates list_people
-> tools.list_people
-> composeListPeopleReply(list result)
```

Required trace:

```json
{
  "route": {
    "domain": "relationship_memory",
    "intent": "list_people",
    "searchMode": "list_people",
    "exactTerms": ["testing", "friendy"]
  },
  "policyDecision": "allow",
  "toolCalls": ["list_people"]
}
```

`search_memories` should not appear for list requests unless the user actually asks for recall/search.

## Response Composer

Change `composeListPeopleReply` to accept `ListPeopleResult`, not search matches.

For a filtered request, the response should name the filter:

```text
I remember these people from testing Friendy:

- Testing 12 - met during testing Friendy
- Testing 1 - testing Friendy
- Testing 2 - met during testing Friendy
- Testing 3 - met during testing Friendy
```

If duplicate groups exist, append:

```text
I also see possible duplicates:

- Testing 1 appears twice
- Testing 2 appears twice
- Testing 3 appears as both "Testing 3" and "Testing 3 from testing Friendy"
```

Response rules:

- Respect bullet/list requests when the user asks for bullets.
- Use `appliedFilterLabel` when available to name the filtered list.
- Do not include unrelated people in filtered lists.
- Do not say "I have N saved people" for filtered lists unless the copy makes it clear N means matching people.
- Do not append stale pending reminders to list responses.
- Do not invent duplicate explanations not present in `duplicateGroups`.

## Tests

Update the regression-freeze case:

```text
duplicate-pending-filtered-list-regression
```

Expected after implementation:

- route intent is `list_people`;
- `toolCalls` includes `list_people`;
- `toolCalls` does not include `search_memories`;
- output uses bullet formatting;
- output includes only testing Friendy people;
- output excludes unrelated people;
- output includes duplicate information when duplicates are present;
- output does not include stale `I still need context for Testing 3`.

Add focused unit tests:

- `tools.list_people` lists all Friendy memories.
- `tools.list_people` filters by `testing friendy`.
- `tools.list_people` groups exact duplicate display names.
- `tools.list_people` links pending candidate ids when `includePending: true`.
- `tools.list_people` returns unsupported source metadata for Apple Contacts sources.
- `composeListPeopleReply` formats filtered bullets and duplicate groups without scores or raw diagnostics.

Keep these existing cases passing:

- `list-all-contact-recall`
- `event-recall-not-list-all`
- `broad-related-contact-recall`
- `pending-contact-pronoun-context`

## Acceptance Criteria

- `list_people` exists as a deterministic tool.
- `AgentToolCall` includes `list_people`.
- List requests do not use `search_memories`.
- `list_people` returns structured people, duplicate groups, and pending candidates.
- Filtered list requests return only matching people.
- Duplicate groups are exposed without destructive merging.
- Pending candidates are represented structurally, not as stale reminders.
- Apple Contacts sources are explicitly unsupported unless a read-only adapter is intentionally wired.
- The `duplicate-pending-filtered-list-regression` eval passes.
- The change does not implement Apple Contacts mutation, embeddings, or broad retrieval changes.
