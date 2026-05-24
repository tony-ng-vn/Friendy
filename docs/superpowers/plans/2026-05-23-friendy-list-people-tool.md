# Friendy List People Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class deterministic `list_people` tool so list/inventory requests no longer route through `search_memories`.

**Architecture:** Implement structured listing in the tool layer first, format it through `responseComposer`, then route `intent: "list_people"` directly to the new tool from `interpretedAgent`. The model still only routes; deterministic tools read Friendy memory, group duplicate-like people, include pending candidate summaries, and return structured data. Apple Contacts sources return explicit unsupported metadata in this plan.

**Tech Stack:** TypeScript, Vitest, Friendy in-memory repository, existing relationship tools, interpreted relationship agent, response composer.

---

## File Structure

- Modify `src/relationship/types.ts`
  - Add `"list_people"` to `AgentToolCall`.
- Modify `src/relationship/tools.ts`
  - Add exported list tool types: `ListPeopleSource`, `ListPeopleRequest`, `InternalListPeopleRequest`, `ListedPersonMemory`, `ListedPerson`, `DuplicateGroup`, `PendingCandidateSummary`, `ListPeopleResult`.
  - Add `list_people(userId, request)` to `createRelationshipTools`.
  - Add deterministic filtering, grouping, duplicate-group generation, pending-candidate linking, and unsupported Apple Contacts source metadata.
- Modify `src/relationship/tools.test.ts`
  - Add unit coverage for all `list_people` tool behavior before implementation.
- Modify `src/relationship/responseComposer.ts`
  - Change `composeListPeopleReply` to accept a `ListPeopleResult` plus formatting hints.
  - Keep `composeSearchReply` unchanged.
- Modify `src/relationship/responseComposer.test.ts`
  - Add list formatting tests that verify bullets, duplicate groups, unsupported sources, and no internal diagnostics.
- Modify `src/relationship/interpretedAgent.ts`
  - Stop rewriting `list_people` into `search_memory`.
  - Make `requiredToolForInterpretation()` return `"list_people"` for `intent: "list_people"`.
  - Add `listPeople()` execution helper that calls `tools.list_people` and `composeListPeopleReply`.
  - Suppress generic pending-contact reminder append for list responses.
- Modify `src/relationship/interpretedAgent.test.ts`
  - Add focused route/tool trace test for `list_people`.
- Modify `src/relationship/evals/agentEvalRunner.ts`
  - Update `duplicate-pending-filtered-list-regression` expectations to include `list_people` and duplicate copy once implementation exists.
- Modify docs/notes:
  - `implementation-notes.html`
  - `docs/goals/EXPERIMENTS.md`
  - `docs/goals/EXPERIMENT_NOTES.md`

## Guardrails

- Do not call `search_memories` from `list_people`.
- Do not add Apple Contacts mutation.
- Do not add Apple Contacts read integration in this PR.
- Do not add embeddings, FTS, reranking, or semantic search.
- Do not merge, delete, or edit memories while listing.
- Do not use model output to directly construct listed people.
- Keep the existing search behavior and search tests passing.

## Task 1: Add Tool Contract and RED Tool Tests

**Files:**
- Modify: `src/relationship/types.ts`
- Modify: `src/relationship/tools.ts`
- Modify: `src/relationship/tools.test.ts`

- [ ] **Step 1: Add `list_people` to tool-call type**

In `src/relationship/types.ts`, add `"list_people"` to `AgentToolCall` immediately before `"search_memories"`:

```ts
export type AgentToolCall =
  | "list_people"
  | "search_memories"
  | "list_pending_candidates"
```

- [ ] **Step 2: Add exported list types in `tools.ts`**

In `src/relationship/tools.ts`, add these types below `MemorySearchResult`:

```ts
export type ListPeopleSource = "friendy_memory" | "apple_contacts" | "both";

export type ListPeopleRequest = {
  source: ListPeopleSource;
  limit: number;
  cursor?: string;
  dedupeByPerson?: boolean;
  includePending?: boolean;
};

export type InternalListPeopleRequest = ListPeopleRequest & {
  filter?: {
    rawText?: string;
    exactTerms?: string[];
    eventName?: string;
    topic?: string;
    tags?: string[];
  };
};

export type ListedPersonMemory = {
  memoryId: string;
  summary: string;
};

export type ListedPerson = {
  personId?: string;
  displayName: string;
  memories: ListedPersonMemory[];
  duplicateGroupId?: string;
  pendingCandidateIds?: string[];
};

export type DuplicateGroup = {
  duplicateGroupId: string;
  reason: "same_display_name" | "similar_display_name" | "same_contact_method" | "pending_matches_saved";
  displayNames: string[];
  memoryIds: string[];
  pendingCandidateIds: string[];
};

export type PendingCandidateSummary = {
  candidateId: string;
  displayName: string;
  status: "pending" | "prompted";
};

export type ListPeopleResult = {
  people: ListedPerson[];
  duplicateGroups: DuplicateGroup[];
  pendingCandidates: PendingCandidateSummary[];
  appliedFilterLabel?: string;
  nextCursor?: string;
  unsupportedSources?: ListPeopleSource[];
};
```

- [ ] **Step 3: Write failing tests for `tools.list_people`**

In `src/relationship/tools.test.ts`, replace:

```ts
import type { RelationshipMemory } from "./types";
```

with:

```ts
import type { ContactCandidateDetected, RelationshipMemory } from "./types";
```

Add these tests before `it("updates a memory through a bounded tool...")`:

```ts
  it("lists Friendy memory as structured people without using search results", () => {
    const tools = createToolsWithMemories([
      memory("Testing 12", "testing Friendy", "Met them during testing Friendy"),
      memory("Sarah Fan", "Photon Residency II", "community lead at Photon Residency II")
    ]);

    const result = tools.list_people(fixtureUser.id, {
      source: "friendy_memory",
      limit: 20,
      dedupeByPerson: true
    });

    expect(result.people).toEqual([
      {
        displayName: "Testing 12",
        memories: [{ memoryId: "memory_testing_12", summary: "Met them during testing Friendy" }]
      },
      {
        displayName: "Sarah Fan",
        memories: [{ memoryId: "memory_sarah_fan", summary: "community lead at Photon Residency II" }]
      }
    ]);
    expect(result.duplicateGroups).toEqual([]);
    expect(result.pendingCandidates).toEqual([]);
  });

  it("filters listed people by meaningful Friendy terms", () => {
    const tools = createToolsWithMemories([
      memory("Testing 12", "testing Friendy", "Met them during testing Friendy"),
      memory("Testing 3", "testing Friendy", "I met testing 3 during testing Friendy"),
      memory("Sarah Fan", "Photon Residency II", "community lead at Photon Residency II")
    ]);

    const result = tools.list_people(fixtureUser.id, {
      source: "friendy_memory",
      limit: 20,
      dedupeByPerson: true,
      filter: {
        rawText: "List me in bullet of all people I met testing friendy",
        exactTerms: ["testing", "friendy"],
        tags: ["testing", "friendy"]
      }
    });

    expect(result.appliedFilterLabel).toBe("testing friendy");
    expect(result.people.map((person) => person.displayName)).toEqual(["Testing 12", "Testing 3"]);
    expect(result.people.flatMap((person) => person.memories.map((item) => item.memoryId))).toEqual([
      "memory_testing_12",
      "memory_testing_3"
    ]);
  });

  it("groups exact duplicate display names without destructive merging", () => {
    const tools = createToolsWithMemories([
      memory("Testing 1", "testing Friendy", "Testing Friendy"),
      { ...memory("Testing 1", "", "im just testing for friendy at the moment"), id: "memory_testing_1_retry" }
    ]);

    const result = tools.list_people(fixtureUser.id, {
      source: "friendy_memory",
      limit: 20,
      dedupeByPerson: true,
      filter: { exactTerms: ["testing", "friendy"] }
    });

    expect(result.people).toHaveLength(1);
    expect(result.people[0]).toMatchObject({
      displayName: "Testing 1",
      duplicateGroupId: "duplicate_testing_1",
      memories: [
        { memoryId: "memory_testing_1", summary: "Testing Friendy" },
        { memoryId: "memory_testing_1_retry", summary: "im just testing for friendy at the moment" }
      ]
    });
    expect(result.duplicateGroups).toEqual([
      {
        duplicateGroupId: "duplicate_testing_1",
        reason: "same_display_name",
        displayNames: ["Testing 1"],
        memoryIds: ["memory_testing_1", "memory_testing_1_retry"],
        pendingCandidateIds: []
      }
    ]);
  });

  it("links pending candidates to same-name saved people when requested", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      memories: [memory("Testing 3", "testing Friendy", "I met testing 3 during testing Friendy")]
    });
    const tools = createRelationshipTools(repo);
    const pending = tools.create_contact_candidate(candidate("Testing 3", "contact_testing_3_pending"));
    repo.markCandidatePrompted(pending.id, "interaction_prompt_testing_3", {
      spaceId: "imessage_testing",
      promptedAt: "2026-05-20T11:59:00.000Z"
    });

    const result = tools.list_people(fixtureUser.id, {
      source: "friendy_memory",
      limit: 20,
      dedupeByPerson: true,
      includePending: true
    });

    expect(result.pendingCandidates).toEqual([
      {
        candidateId: pending.id,
        displayName: "Testing 3",
        status: "prompted"
      }
    ]);
    expect(result.people[0].pendingCandidateIds).toEqual([pending.id]);
    expect(result.duplicateGroups).toEqual([
      {
        duplicateGroupId: "duplicate_testing_3",
        reason: "pending_matches_saved",
        displayNames: ["Testing 3"],
        memoryIds: ["memory_testing_3"],
        pendingCandidateIds: [pending.id]
      }
    ]);
  });

  it("marks Apple Contacts sources unsupported without pretending to list them", () => {
    const tools = createToolsWithMemories([memory("Testing 12", "testing Friendy", "Met them during testing Friendy")]);

    expect(
      tools.list_people(fixtureUser.id, {
        source: "apple_contacts",
        limit: 20,
        dedupeByPerson: true
      })
    ).toEqual({
      people: [],
      duplicateGroups: [],
      pendingCandidates: [],
      unsupportedSources: ["apple_contacts"]
    });

    expect(
      tools.list_people(fixtureUser.id, {
        source: "both",
        limit: 20,
        dedupeByPerson: true
      })
    ).toMatchObject({
      people: [{ displayName: "Testing 12" }],
      unsupportedSources: ["apple_contacts"]
    });
  });
```

Add this helper near the existing test helpers at the bottom of `tools.test.ts`:

```ts
function candidate(displayName: string, contactIdentifier: string): ContactCandidateDetected {
  return {
    ...fixtureDetectedContact,
    displayName,
    contactIdentifier,
    phoneNumbers: ["+15550101903"],
    emails: []
  };
}
```

- [ ] **Step 4: Run tool tests and verify RED**

Run:

```bash
npm test -- src/relationship/tools.test.ts
```

Expected: FAIL because `tools.list_people` is not defined.

- [ ] **Step 5: Commit RED tests**

```bash
git add src/relationship/types.ts src/relationship/tools.ts src/relationship/tools.test.ts
git commit -m "test:add list people tool contract"
```

## Task 2: Implement `tools.list_people`

**Files:**
- Modify: `src/relationship/tools.ts`
- Test: `src/relationship/tools.test.ts`

- [ ] **Step 1: Add `list_people` method to `createRelationshipTools`**

In `src/relationship/tools.ts`, add this method before `search_memories`:

```ts
    list_people(userId: string, request: InternalListPeopleRequest): ListPeopleResult {
      return listPeopleFromRepository(repo, userId, request);
    },
```

- [ ] **Step 2: Add deterministic implementation helpers**

Add these helpers after `interactionIdFromManualKey()`:

```ts
function listPeopleFromRepository(
  repo: RelationshipRepository,
  userId: string,
  request: InternalListPeopleRequest
): ListPeopleResult {
  if (request.source === "apple_contacts") {
    return {
      people: [],
      duplicateGroups: [],
      pendingCandidates: [],
      unsupportedSources: ["apple_contacts"]
    };
  }

  const memories = repo
    .listMemories(userId)
    .filter((memory) => memoryMatchesListFilter(memory, request.filter))
    .slice(0, Math.max(0, request.limit));
  const pendingCandidates = request.includePending
    ? repo
        .listPendingCandidates(userId)
        .filter((candidate) => candidate.status === "pending" || candidate.status === "prompted")
        .map((candidate) => ({
          candidateId: candidate.id,
          displayName: candidate.displayName,
          status: candidate.status as "pending" | "prompted"
        }))
    : [];

  const grouped = request.dedupeByPerson === false ? groupMemoriesIndividually(memories) : groupMemoriesByPerson(memories);
  const duplicateGroups = buildDuplicateGroups(grouped, pendingCandidates);
  const people = grouped.map((group) => {
    const duplicateGroup = duplicateGroups.find((item) => item.memoryIds.some((memoryId) => group.memories.some((memory) => memory.id === memoryId)));
    const pendingCandidateIds = pendingCandidates
      .filter((candidate) => normalizedPersonName(candidate.displayName) === group.key)
      .map((candidate) => candidate.candidateId);

    return {
      displayName: group.displayName,
      memories: group.memories.map((memory) => ({
        memoryId: memory.id,
        summary: summarizeListedMemory(memory)
      })),
      duplicateGroupId: duplicateGroup?.duplicateGroupId,
      pendingCandidateIds: pendingCandidateIds.length > 0 ? pendingCandidateIds : undefined
    };
  });

  return {
    people,
    duplicateGroups,
    pendingCandidates,
    appliedFilterLabel: listFilterLabel(request.filter),
    unsupportedSources: request.source === "both" ? ["apple_contacts"] : undefined
  };
}

type MemoryGroup = {
  key: string;
  displayName: string;
  memories: RelationshipMemory[];
};

function groupMemoriesIndividually(memories: RelationshipMemory[]): MemoryGroup[] {
  return memories.map((memory) => ({
    key: memory.id,
    displayName: memory.displayName,
    memories: [memory]
  }));
}

function groupMemoriesByPerson(memories: RelationshipMemory[]): MemoryGroup[] {
  const groups = new Map<string, MemoryGroup>();

  for (const memory of memories) {
    const key = normalizedPersonName(memory.displayName);
    const existing = groups.get(key);
    if (existing) {
      existing.memories.push(memory);
      continue;
    }

    groups.set(key, {
      key,
      displayName: baseDisplayName(memory.displayName),
      memories: [memory]
    });
  }

  return [...groups.values()];
}

function buildDuplicateGroups(groups: MemoryGroup[], pendingCandidates: PendingCandidateSummary[]): DuplicateGroup[] {
  const duplicateGroups: DuplicateGroup[] = [];

  for (const group of groups) {
    const matchingPending = pendingCandidates.filter((candidate) => normalizedPersonName(candidate.displayName) === group.key);
    const displayNames = uniqueStrings([...group.memories.map((memory) => memory.displayName), ...matchingPending.map((candidate) => candidate.displayName)]);
    const hasMemoryDuplicate = group.memories.length > 1;
    const hasPendingDuplicate = matchingPending.length > 0 && group.memories.length > 0;
    if (!hasMemoryDuplicate && !hasPendingDuplicate) {
      continue;
    }

    duplicateGroups.push({
      duplicateGroupId: duplicateGroupId(group.key),
      reason: hasMemoryDuplicate ? (displayNames.length > 1 ? "similar_display_name" : "same_display_name") : "pending_matches_saved",
      displayNames,
      memoryIds: group.memories.map((memory) => memory.id),
      pendingCandidateIds: matchingPending.map((candidate) => candidate.candidateId)
    });
  }

  return duplicateGroups;
}

function memoryMatchesListFilter(memory: RelationshipMemory, filter: InternalListPeopleRequest["filter"]): boolean {
  const terms = meaningfulListTerms(filter);
  if (terms.length === 0) {
    return true;
  }

  const document = [
    memory.displayName,
    memory.eventTitle ?? "",
    memory.contextNote,
    ...(memory.tags ?? []),
    buildMemorySearchDocument(memory).text
  ]
    .join(" ")
    .toLowerCase();

  return terms.every((term) => document.includes(term));
}

function meaningfulListTerms(filter: InternalListPeopleRequest["filter"]): string[] {
  const rawTerms = [...(filter?.exactTerms ?? []), ...(filter?.tags ?? [])];
  const generic = new Set(["all", "bullet", "contacts", "contact", "list", "met", "people", "person"]);
  const seen = new Set<string>();

  return rawTerms
    .flatMap((term) => term.toLowerCase().split(/\s+/))
    .map((term) => term.replace(/[^a-z0-9-]/g, "").trim())
    .filter((term) => term.length > 0 && !generic.has(term))
    .filter((term) => {
      if (seen.has(term)) {
        return false;
      }
      seen.add(term);
      return true;
    });
}

function listFilterLabel(filter: InternalListPeopleRequest["filter"]): string | undefined {
  const terms = meaningfulListTerms(filter);
  return terms.length > 0 ? terms.join(" ") : undefined;
}

function summarizeListedMemory(memory: RelationshipMemory): string {
  const event = memory.eventTitle?.trim();
  const context = memory.contextNote
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  return context || event || "saved in Friendy memory";
}

function normalizedPersonName(displayName: string): string {
  return baseDisplayName(displayName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function baseDisplayName(displayName: string): string {
  return displayName.replace(/\s+from\s+.+$/i, "").trim();
}

function duplicateGroupId(key: string): string {
  const slug = key.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `duplicate_${slug || "person"}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
```

- [ ] **Step 3: Run tool tests and verify GREEN**

Run:

```bash
npm test -- src/relationship/tools.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit tool implementation**

```bash
git add src/relationship/tools.ts src/relationship/tools.test.ts
git commit -m "feat:add deterministic list people tool"
```

## Task 3: Add Structured List Response Composer

**Files:**
- Modify: `src/relationship/responseComposer.ts`
- Modify: `src/relationship/responseComposer.test.ts`

- [ ] **Step 1: Write response composer RED tests**

In `src/relationship/responseComposer.test.ts`, add `composeListPeopleReply` to the existing `./responseComposer` import list:

```ts
  composeListPeopleReply,
```

Replace:

```ts
import type { MemorySearchResult } from "./tools";
```

with:

```ts
import type { ListPeopleResult, MemorySearchResult } from "./tools";
```

Add these tests before `it("formats the foreground runtime startup message...")`:

```ts
  it("formats filtered people lists with bullets and duplicate groups", () => {
    const reply = composeListPeopleReply({
      result: listPeopleResult({
        appliedFilterLabel: "testing friendy",
        people: [
          { displayName: "Testing 12", memories: [{ memoryId: "memory_testing_12", summary: "Met them during testing Friendy" }] },
          { displayName: "Testing 1", memories: [{ memoryId: "memory_testing_1", summary: "Testing Friendy" }], duplicateGroupId: "duplicate_testing_1" }
        ],
        duplicateGroups: [
          {
            duplicateGroupId: "duplicate_testing_1",
            reason: "same_display_name",
            displayNames: ["Testing 1"],
            memoryIds: ["memory_testing_1", "memory_testing_1_retry"],
            pendingCandidateIds: []
          }
        ]
      }),
      preferBullets: true
    });

    expect(reply).toContain("I remember these people from testing friendy:");
    expect(reply).toContain("- Testing 12 - Met them during testing Friendy");
    expect(reply).toContain("- Testing 1 - Testing Friendy");
    expect(reply).toContain("I also see possible duplicates:");
    expect(reply).toContain("- Testing 1 appears twice");
    expectNoInternalLanguage(reply);
  });

  it("formats unsupported Apple Contacts source without pretending it checked contacts", () => {
    const reply = composeListPeopleReply({
      result: listPeopleResult({
        people: [],
        unsupportedSources: ["apple_contacts"]
      })
    });

    expect(reply).toBe("I can list people from Friendy memory right now. Apple Contacts listing is not connected yet.");
  });
```

Add this helper near other test helpers:

```ts
function listPeopleResult(overrides: Partial<ListPeopleResult>): ListPeopleResult {
  return {
    people: [],
    duplicateGroups: [],
    pendingCandidates: [],
    ...overrides
  };
}
```

- [ ] **Step 2: Run composer tests and verify RED**

Run:

```bash
npm test -- src/relationship/responseComposer.test.ts
```

Expected: FAIL because `composeListPeopleReply` still accepts search matches, not `{ result, preferBullets }`.

- [ ] **Step 3: Update composer input and implementation**

In `src/relationship/responseComposer.ts`, change imports:

```ts
import type { ListPeopleResult, MemorySearchResult } from "./tools";
```

Replace the existing `composeListPeopleReply` with:

```ts
type ListPeopleReplyInput = {
  result: ListPeopleResult;
  preferBullets?: boolean;
};

/** Formats structured people inventory results without using search diagnostics. */
export function composeListPeopleReply({ result, preferBullets = false }: ListPeopleReplyInput): string {
  if (result.unsupportedSources?.includes("apple_contacts") && result.people.length === 0) {
    return "I can list people from Friendy memory right now. Apple Contacts listing is not connected yet.";
  }

  if (result.people.length === 0) {
    return "I don't have any matching people in Friendy memory yet.";
  }

  const heading = result.appliedFilterLabel
    ? `I remember these people from ${result.appliedFilterLabel}:`
    : `I remember ${result.people.length === 1 ? "this person" : "these people"} in Friendy memory:`;
  const peopleLines = result.people.map((person) => formatListedPerson(person, preferBullets));
  const sections = [heading, "", ...peopleLines];

  const duplicateLines = result.duplicateGroups.map((group) => formatDuplicateGroup(group)).filter(Boolean);
  if (duplicateLines.length > 0) {
    sections.push("", "I also see possible duplicates:", "", ...duplicateLines);
  }

  if (result.unsupportedSources?.includes("apple_contacts")) {
    sections.push("", "Apple Contacts listing is not connected yet, so this is from Friendy memory only.");
  }

  return sections.join("\n");
}
```

Add these helpers below `composeListPeopleReply`:

```ts
function formatListedPerson(person: ListPeopleResult["people"][number], preferBullets: boolean): string {
  const summaries = person.memories.map((memory) => memory.summary).filter(Boolean);
  const summary = summaries.length > 0 ? ` - ${summaries.join("; ")}` : "";
  const prefix = preferBullets ? "- " : "";
  return `${prefix}${person.displayName}${summary}`;
}

function formatDuplicateGroup(group: ListPeopleResult["duplicateGroups"][number]): string {
  const prefix = "- ";
  if (group.displayNames.length === 1) {
    const count = group.memoryIds.length + group.pendingCandidateIds.length;
    return `${prefix}${group.displayNames[0]} appears ${count === 2 ? "twice" : `${count} times`}`;
  }

  return `${prefix}${group.displayNames.join(" / ")} may be the same person`;
}
```

- [ ] **Step 4: Run composer tests and verify GREEN**

Run:

```bash
npm test -- src/relationship/responseComposer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit composer implementation**

```bash
git add src/relationship/responseComposer.ts src/relationship/responseComposer.test.ts
git commit -m "feat:format structured list people replies"
```

## Task 4: Route `list_people` Through the Real Tool

**Files:**
- Modify: `src/relationship/interpretedAgent.ts`
- Modify: `src/relationship/interpretedAgent.test.ts`

- [ ] **Step 1: Write focused interpreted-agent RED test**

In `src/relationship/interpretedAgent.test.ts`, update the `fullInterpretation()` helper type so it can build a typed `list_people` route. Replace the `intent` union with:

```ts
  intent:
    | "capture_memory"
    | "search_memory"
    | "list_people"
    | "ignore_candidate"
    | "clarify"
    | "unknown"
    | "request_contact_edit";
```

Add this property to the `fullInterpretation()` overrides type:

```ts
  conversationRelation: "starts_new_relationship_task";
```

Replace the `search` override type with:

```ts
  search: {
    mode: "lookup_person" | "list_people" | "list_related_people" | "event_recall" | "semantic_recall";
    semanticQuery: string;
    exactTerms: string[];
    filters?: {
      tags?: string[];
      topic?: string;
      eventName?: string;
    };
    topK?: number;
  };
```

Then add this test near other interpreted routing tests:

```ts
  it("routes list_people to the list_people tool instead of search_memories", async () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      memories: [
        {
          ...memoryFixture("Testing 12", "Met them during testing Friendy"),
          id: "memory_testing_12",
          eventTitle: "testing Friendy",
          tags: ["testing", "friendy"]
        },
        {
          ...memoryFixture("Sarah Fan", "community lead at Photon Residency II"),
          id: "memory_sarah",
          eventTitle: "Photon Residency II",
          tags: ["photon", "residency"]
        }
      ]
    });
    const tools = createRelationshipTools(repo);
    const agent = createInterpretedRelationshipAgent({
      repo,
      tools,
      interpreter: modelInterpreter({
        intent: "list_people",
        domain: "relationship_memory",
        conversationRelation: "starts_new_relationship_task",
        confidence: 0.92,
        query: "testing friendy",
        search: {
          mode: "list_people",
          semanticQuery: "people I met testing Friendy",
          exactTerms: ["testing", "friendy"],
          filters: { tags: ["testing", "friendy"] },
          topK: 20
        }
      }),
      now: () => "2026-05-20T12:00:00.000Z",
      timezone: "America/Los_Angeles"
    });

    const result = await agent.handleMessage(inbound("List me in bullet of all people I met testing friendy"));

    expect(result.toolCalls).toEqual(["list_people"]);
    expect(result.trace).toMatchObject({
      route: {
        intent: "list_people",
        searchMode: "list_people",
        exactTerms: ["testing", "friendy"]
      },
      policyDecision: "allow",
      toolCalls: ["list_people"]
    });
    expect(result.outbound.text).toContain("- Testing 12 - Met them during testing Friendy");
    expect(result.outbound.text).not.toContain("Sarah Fan");
    expect(result.outbound.text).not.toContain("I still need context");
  });
```

- [ ] **Step 2: Run interpreted-agent test and verify RED**

Run:

```bash
npm test -- src/relationship/interpretedAgent.test.ts
```

Expected: FAIL because `list_people` still routes through `search_memories`.

- [ ] **Step 3: Update required tool routing**

In `src/relationship/interpretedAgent.ts`, change `requiredToolForInterpretation()`:

```ts
  if (interpretation.intent === "list_people") {
    return "list_people";
  }

  if (interpretation.intent === "search_memory") {
    return "search_memories";
  }
```

Replace the current combined condition:

```ts
  if (interpretation.intent === "search_memory" || interpretation.intent === "list_people") {
    return "search_memories";
  }
```

- [ ] **Step 4: Add `listPeople()` execution helper**

In `executeInterpretation()`, replace the current `list_people` block with:

```ts
  if (interpretation.intent === "list_people") {
    return listPeople(message, interpretation, tools, toolCalls);
  }
```

Add this helper near `searchMemories()`:

```ts
function listPeople(
  message: InboundAgentMessage,
  interpretation: MessageInterpretation,
  tools: RelationshipTools,
  toolCalls: AgentToolCall[]
): string {
  toolCalls.push("list_people");
  const result = tools.list_people(message.userId, {
    source: "friendy_memory",
    limit: interpretation.search?.topK ?? 20,
    dedupeByPerson: true,
    includePending: true,
    filter: {
      rawText: message.text,
      exactTerms: interpretation.search?.exactTerms ?? [],
      eventName: interpretation.search?.filters?.eventName,
      topic: interpretation.search?.filters?.topic,
      tags: interpretation.search?.filters?.tags ?? interpretation.tags
    }
  });

  return composeListPeopleReply({
    result,
    preferBullets: /\b(?:bullet|bullets|list)\b/i.test(message.text)
  });
}
```

- [ ] **Step 5: Suppress generic pending reminder for list responses**

In the post-`executeInterpretation()` section, find:

```ts
      if (shouldRemindPendingContact(interpretation, pendingState)) {
        outboundText = `${outboundText} ${composePendingContactReminder(pendingState.activeFrame.displayName)}`;
      }
```

Update `shouldRemindPendingContact()` so it returns `false` for `intent: "list_people"`:

```ts
  if (interpretation.intent === "list_people") {
    return false;
  }
```

- [ ] **Step 6: Run focused interpreted-agent test and verify GREEN**

Run:

```bash
npm test -- src/relationship/interpretedAgent.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit routing implementation**

```bash
git add src/relationship/interpretedAgent.ts src/relationship/interpretedAgent.test.ts
git commit -m "feat:route list people through dedicated tool"
```

## Task 5: Make Regression Eval Pass

**Files:**
- Modify: `src/relationship/evals/agentEvalRunner.ts`
- Test: `src/relationship/evals/agentEvalRunner.test.ts`

- [ ] **Step 1: Update regression case expectations to require `list_people`**

In `src/relationship/evals/agentEvalRunner.ts`, replace the first two assertions in `duplicate-pending-filtered-list-regression` with:

```ts
assertion("filtered bullet list uses list_people route", "intent", result.trace.route?.intent === "list_people"),
assertion("filtered bullet list does not use search fallback", "intent", result.toolCalls.includes("list_people") && !result.toolCalls.includes("search_memories")),
assertion("filtered bullet list respects bullet formatting", "searchRecall", hasBulletFormatting(result.outbound.text)),
assertion(
  "filtered bullet list suppresses stale pending reminder",
  "clarification",
  !includesStalePendingReminder(result.outbound.text, "Testing 3")
)
```

Add an assertion to exclude Sarah Fan if the case does not already assert it:

```ts
assertion("filtered bullet list excludes unrelated people", "hallucination", !result.outbound.text.includes("Sarah Fan"))
```

Also add that assertion name to the catalog entry:

```ts
"filtered bullet list excludes unrelated people"
```

- [ ] **Step 2: Run eval runner test**

Run:

```bash
npm test -- src/relationship/evals/agentEvalRunner.test.ts
```

Expected: FAIL with exactly four known regression-freeze cases still RED. The `duplicate-pending-filtered-list-regression` case should pass.

- [ ] **Step 3: Run eval CLI**

Run:

```bash
npm run eval:agent
```

Expected: 37/41 required cases pass. Remaining failures should be:

```text
duplicate-audit-in-scope-regression
conversation-repair-pending-vs-saved-regression
fuzzy-delete-memory-confirmation-regression
same-name-pending-contact-disambiguation-regression
```

- [ ] **Step 4: Commit eval update**

```bash
git add src/relationship/evals/agentEvalRunner.ts
git commit -m "test:update list people regression expectation"
```

## Task 6: Update Notes and Run Final Verification

**Files:**
- Modify: `implementation-notes.html`
- Modify: `docs/goals/EXPERIMENTS.md`
- Modify: `docs/goals/EXPERIMENT_NOTES.md`

- [ ] **Step 1: Update implementation notes**

Add this section near the top of `implementation-notes.html`:

```html
    <h2>Friendy List People Tool (2026-05-23)</h2>
    <ul>
      <li>Added a dedicated <code>list_people</code> tool for Friendy memory inventory/list requests, separate from <code>search_memories</code>.</li>
      <li>The tool returns structured people, memory summaries, duplicate groups, pending candidate summaries, filter labels, and unsupported Apple Contacts source metadata.</li>
      <li>List responses now format structured inventory results and suppress unrelated stale pending-contact reminders.</li>
      <li>Apple Contacts listing remains unsupported metadata in this PR; no Apple Contacts mutation or read adapter was added.</li>
    </ul>
```

- [ ] **Step 2: Update experiments**

Add this section near the top of `docs/goals/EXPERIMENTS.md`:

```md
# Friendy List People Tool

## GREEN

- Date: 2026-05-23
- Goal source: `docs/superpowers/specs/2026-05-23-friendy-list-people-tool-design.md`.
- Added a deterministic `list_people` tool and routed `intent: list_people` through it instead of `search_memories`.
- Focused checks:
  - `npm test -- src/relationship/tools.test.ts`
  - `npm test -- src/relationship/responseComposer.test.ts`
  - `npm test -- src/relationship/interpretedAgent.test.ts`
  - `npm test -- src/relationship/evals/agentEvalRunner.test.ts`
- Eval status after this PR: 37/41 expected, with four non-list regression-freeze cases still RED.
```

- [ ] **Step 3: Update experiment notes**

Add this section near the top of `docs/goals/EXPERIMENT_NOTES.md`:

```md
# Friendy List People Tool Notes

- 2026-05-23: `list_people` is Friendy-memory-first. `apple_contacts` and `both` mark Apple Contacts listing unsupported in this PR.
- 2026-05-23: List requests no longer call `search_memories`; this preserves the boundary between inventory/listing and clue-based recall.
- 2026-05-23: Duplicate grouping is conservative and non-destructive.
```

- [ ] **Step 4: Run final focused checks**

Run:

```bash
npm test -- src/relationship/tools.test.ts
npm test -- src/relationship/responseComposer.test.ts
npm test -- src/relationship/interpretedAgent.test.ts
npm test -- src/relationship/evals/agentEvalRunner.test.ts
npm run build
npm run eval:agent
git diff --check
```

Expected:

- Tool/composer/interpreted focused tests pass.
- Eval runner test fails only because four known regression-freeze cases remain RED.
- `npm run eval:agent` exits nonzero with 37/41 passing.
- `npm run build` passes.
- `git diff --check` passes.

- [ ] **Step 5: Commit docs**

```bash
git add implementation-notes.html docs/goals/EXPERIMENTS.md docs/goals/EXPERIMENT_NOTES.md
git commit -m "docs:record Friendy list people tool status"
```

## Completion Report

Final report must include:

```text
Implemented `list_people` as a real Friendy memory tool. List requests no longer route through `search_memories`.
```

Also report the intentional eval status:

```text
`npm run eval:agent` remains RED because four previously frozen non-list regression cases are still unfixed.
```

Do not claim the full suite is green in this PR. The four unrelated RED cases remain for later goals.
