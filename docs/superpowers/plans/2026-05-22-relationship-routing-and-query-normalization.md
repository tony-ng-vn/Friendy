# Relationship Routing and Query Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make broad natural relationship-memory queries route to `search_memories` and search useful normalized clues instead of filler words.

**Architecture:** Keep deterministic lifecycle/candidate/mutation paths in front, but stop broad regex scope rejection from blocking relationship-shaped recall. Add a `MemorySearchRequest` seam from interpretation to search, normalize broad recall filler terms, extend route/search fields, and add redacted route trace evidence.

**Tech Stack:** TypeScript, Vitest, Zod, existing OpenAI structured-output interpreter, existing in-memory and SQLite relationship repositories.

---

## File Structure

- Modify `src/relationship/scopeBoundary.ts`: narrow broad recall hotfix and conservative hard-block behavior.
- Modify `src/relationship/scopeBoundary.test.ts`: red/green coverage for broad related-contact phrasing and coding-looking memory queries.
- Modify `src/relationship/tools.ts`: export `normalizeMemorySearchQuery`, add `MemorySearchRequest` support, and use normalized/effective search queries.
- Modify `src/relationship/tools.test.ts`: normalization and seeded broad-recall search coverage.
- Modify `src/relationship/interpretation.ts`: add optional `domain` and `search` fields, `RouteDomain`, `SearchPlan`, and route-aware query builder.
- Modify `src/relationship/openAIInterpreter.ts`: populate route/search fields in rule-based fallback and include them in structured schema.
- Modify `src/relationship/interpretedAgent.ts`: build `MemorySearchRequest` from interpretation before calling search.
- Modify `src/relationship/interpretedAgent.test.ts`: integration coverage proving broad recall calls `search_memories` and returns seeded matches.
- Modify `src/relationship/runtime/runtimeTrace.ts`: add redacted route/policy/tool trace shape.
- Modify `src/relationship/evals/agentEvalRunner.ts`: add required broad relationship recall eval.
- Modify `src/relationship/evals/behavior-contract-cases.ts`: add the new eval case name.
- Modify `implementation-notes.html`: record implementation decisions and verification evidence.
- Modify `docs/agent-handoff.md`: update current follow-up status once Spec A implementation is complete.

## Task 1: Broad Recall Regression Tests

**Files:**
- Modify: `src/relationship/scopeBoundary.test.ts`

- [ ] **Step 1: Add failing scope tests for broad relationship recall**

Add this test to `src/relationship/scopeBoundary.test.ts` before the adversarial test:

```ts
  it("allows broad contact-related recall phrasing", () => {
    for (const text of [
      "Anyone in my contacts related to Friendy?",
      "Anyone in my contacts related to friendy?",
      "Who is connected to Friendy?",
      "Any contacts connected to Friendy?",
      "People related to Friendy?"
    ]) {
      expect(decideMessageScope({ text, hasPendingCandidate: false })).toMatchObject({
        scope: "in_scope",
        capability: "relationship_recall"
      });
    }
  });

  it("does not block coding-looking words inside memory recall", () => {
    expect(decideMessageScope({ text: "Who was from the Mac sensor debugging thing?", hasPendingCandidate: false })).toMatchObject({
      scope: "in_scope",
      capability: "relationship_recall"
    });
  });
```

- [ ] **Step 2: Run scope tests and verify they fail**

Run:

```bash
npm test -- src/relationship/scopeBoundary.test.ts
```

Expected: FAIL because broad `related` / `connected` phrasing still returns `out_of_scope`.

## Task 2: Narrow Routing Hotfix

**Files:**
- Modify: `src/relationship/scopeBoundary.ts`
- Test: `src/relationship/scopeBoundary.test.ts`

- [ ] **Step 1: Add broad recall helpers**

In `src/relationship/scopeBoundary.ts`, add helper functions near `isRelationshipRecall`:

```ts
function isBroadRelatedPeopleRecall(text: string): boolean {
  return (
    /\b(anyone|anybody|people|person|someone|somebody|contacts?)\b.*\b(related|connected|connection|about|from|at|met|know|saved)\b/.test(text) ||
    /\b(who|which)\b.*\b(related|connected|connection)\b/.test(text)
  );
}

function looksLikePeopleMemoryQuery(text: string): boolean {
  return isRelationshipRecall(text) || isBroadRelatedPeopleRecall(text);
}
```

- [ ] **Step 2: Wire broad recall into `isRelationshipRecall`**

Change `isRelationshipRecall` to include the new helper:

```ts
function isRelationshipRecall(text: string): boolean {
  return (
    /\b(who|where|when|what)\b.*\b(met|meet|know|relationship|remember|saved|contact|contacts)\b/.test(text) ||
    /\bdo i know\b/.test(text) ||
    /\bwho (likes|works|goes|is|was)\b/.test(text) ||
    /\b(who|find|show|list)\b.*\b(slept|sleep|bed|room|lead|founder|project|making|made|goes|school|class|from|at)\b/.test(
      text
    ) ||
    isBroadRelatedPeopleRecall(text)
  );
}
```

- [ ] **Step 3: Make coding hard-block conservative**

Change the non-pending coding branch:

```ts
  if (isCodingTask(lower) && !looksLikePeopleMemoryQuery(lower)) {
    return outOfScope("coding_task", CODING_REDIRECT);
  }
```

Change `isClearlyOffTopicWhilePending` to accept the original text and use the same conservative coding rule:

```ts
function isClearlyOffTopicWhilePending(text: string): boolean {
  return (
    isAdversarialGeneralAssistantRequest(text) ||
    (isCodingTask(text) && !looksLikePeopleMemoryQuery(text)) ||
    isMathTask(text) ||
    isGeneralKnowledgeTask(text) ||
    isGenericAdviceTask(text) ||
    isGenericRelationshipTheory(text)
  );
}
```

- [ ] **Step 4: Run routing tests**

Run:

```bash
npm test -- src/relationship/scopeBoundary.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit routing hotfix**

Run:

```bash
git add src/relationship/scopeBoundary.ts src/relationship/scopeBoundary.test.ts
git commit -m "fix:route broad relationship recall to search"
```

## Task 3: Query Normalization

**Files:**
- Modify: `src/relationship/tools.ts`
- Modify: `src/relationship/tools.test.ts`
- Modify: `src/relationship/interpretedAgent.test.ts`

- [ ] **Step 1: Add failing normalization and integration tests**

Add this test to `src/relationship/tools.test.ts`:

```ts
  it("normalizes broad relationship recall queries to useful clues", () => {
    expect(normalizeMemorySearchQuery("Anyone in my contacts related to friendy?")).toBe("friendy");
    expect(normalizeMemorySearchQuery("Who is connected to Friendy?")).toBe("friendy");
    expect(normalizeMemorySearchQuery("People related to Friendy?")).toBe("friendy");
    expect(normalizeMemorySearchQuery("Who was from the Mac sensor debugging thing?")).toBe("mac sensor debugging thing");
  });
```

Update the import at the top:

```ts
import { createRelationshipTools, normalizeMemorySearchQuery } from "./tools";
```

Add this test to `src/relationship/tools.test.ts`:


```ts
  it("searches saved memories from broad related-contact wording", () => {
    const tools = createToolsWithMemories([
      memory("Testing 1", "Testing Friendy", "Testing Friendy"),
      memory("Testing 12", "testing Friendy", "Met them during testing Friendy")
    ]);

    const results = tools.search_memories(fixtureUser.id, "Anyone in my contacts related to friendy?");

    expect(results.map((result) => result.memory.displayName)).toEqual(["Testing 1", "Testing 12"]);
  });
```

Add this test near the other search tests in `src/relationship/interpretedAgent.test.ts`:

```ts
  it("finds saved contacts from broad related-contact recall phrasing", async () => {
    const { agent } = createTestAgentWithMemories([
      memoryFixture("Testing 1", "Testing Friendy"),
      memoryFixture("Testing 12", "Met them during testing Friendy")
    ]);

    const result = await agent.handleMessage(inbound("Anyone in my contacts related to friendy?"));

    expect(result.toolCalls).toContain("search_memories");
    expect(result.outbound.text).toContain("Testing 1");
    expect(result.outbound.text).toContain("Testing 12");
    expect(result.outbound.text).not.toContain("people you know");
  });
```

- [ ] **Step 2: Run tools and interpreted tests and verify failure**

Run:

```bash
npm test -- src/relationship/tools.test.ts -t "broad relationship recall|broad related-contact"
npm test -- src/relationship/interpretedAgent.test.ts -t "broad related-contact"
```

Expected: FAIL because `normalizeMemorySearchQuery` does not exist and broad interpreted search returns no results from the noisy raw query.

- [ ] **Step 3: Implement normalizer**

In `src/relationship/tools.ts`, export the normalizer near `normalizeSearchText`:

```ts
const GENERIC_MEMORY_QUERY_TERMS = new Set([
  "anyone",
  "anybody",
  "any",
  "people",
  "person",
  "someone",
  "somebody",
  "contact",
  "contacts",
  "related",
  "connected",
  "connection",
  "about",
  "relevant",
  "my",
  "mine",
  "in",
  "to",
  "with",
  "from",
  "who",
  "which",
  "find",
  "show",
  "list",
  "was",
  "is",
  "the"
]);

export function normalizeMemorySearchQuery(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term) => !GENERIC_MEMORY_QUERY_TERMS.has(term))
    .join(" ");
}
```

- [ ] **Step 4: Use effective query before scoring**

Change `search_memories`:

```ts
    search_memories(userId: string, query: string): MemorySearchResult[] {
      const normalizedQuery = normalizeMemorySearchQuery(query);
      const effectiveQuery = normalizedQuery.length > 0 ? normalizedQuery : query;
      const queryAnalysis = analyzeSearchQuery(effectiveQuery);
```

- [ ] **Step 5: Run tools tests**

Run:

```bash
npm test -- src/relationship/tools.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run interpreted regression test**

Run:

```bash
npm test -- src/relationship/interpretedAgent.test.ts -t "broad related-contact"
```

Expected: PASS.

- [ ] **Step 7: Commit normalization**

Run:

```bash
git add src/relationship/tools.ts src/relationship/tools.test.ts src/relationship/interpretedAgent.test.ts
git commit -m "fix:normalize broad relationship recall search"
```

## Task 4: Route Fields and MemorySearchRequest Seam

**Files:**
- Modify: `src/relationship/interpretation.ts`
- Modify: `src/relationship/openAIInterpreter.ts`
- Modify: `src/relationship/interpretedAgent.ts`
- Modify: `src/relationship/interpretedAgent.test.ts`

- [ ] **Step 1: Add failing interpretation-schema test**

Add this test to `src/relationship/interpretation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSearchQueryFromInterpretation, validateMessageInterpretation } from "./interpretation";

describe("message interpretation route search fields", () => {
  it("accepts optional route domain and search plan", () => {
    const interpretation = validateMessageInterpretation({
      intent: "search_memory",
      confidence: 0.95,
      domain: "relationship_memory",
      search: {
        mode: "list_related_people",
        semanticQuery: "people or contacts related to Friendy",
        exactTerms: ["friendy"],
        filters: { tags: ["friendy"] },
        topK: 10
      },
      people: [],
      event: { name: "", dateText: "", location: "" },
      dateContext: null,
      contextNote: "",
      query: "Friendy",
      tags: ["friendy"],
      needsClarification: false,
      clarificationQuestion: ""
    });

    expect(interpretation.domain).toBe("relationship_memory");
    expect(interpretation.search?.mode).toBe("list_related_people");
    expect(buildSearchQueryFromInterpretation(interpretation)).toBe("friendy");
  });
});
```

- [ ] **Step 2: Run interpretation test and verify failure**

Run:

```bash
npm test -- src/relationship/interpretation.test.ts
```

Expected: FAIL because the schema currently rejects `domain` and `search`.

- [ ] **Step 3: Extend JSON schema and Zod schema**

In `src/relationship/interpretation.ts`, add:

```ts
const routeDomainSchema = z.enum([
  "relationship_memory",
  "relationship_drafting",
  "lifecycle_control",
  "general_assistant",
  "unsafe_or_adversarial"
]);

const searchPlanSchema = z
  .object({
    mode: z.enum(["lookup_person", "list_people", "list_related_people", "event_recall", "semantic_recall"]),
    semanticQuery: z.string().default(""),
    exactTerms: z.array(z.string()).default([]),
    filters: z
      .object({
        personName: z.string().optional(),
        eventName: z.string().optional(),
        topic: z.string().optional(),
        companyOrSchool: z.string().optional(),
        dateText: z.string().optional(),
        tags: z.array(z.string()).optional()
      })
      .optional(),
    topK: z.number().int().positive().max(20).optional()
  })
  .strict();
```

Add `domain` and `search` to `messageInterpretationSchema`, and add matching optional JSON schema properties.

- [ ] **Step 4: Route-aware search query builder**

Change `buildSearchQueryFromInterpretation` to prefer exact terms:

```ts
  return [
    ...(interpretation.search?.exactTerms ?? []),
    interpretation.query,
    interpretation.event.name,
    ...interpretation.tags
  ]
```

- [ ] **Step 5: Update rule-based fallback**

In `src/relationship/openAIInterpreter.ts`, update `baseInterpretation` to include:

```ts
    domain: "relationship_memory",
    search: undefined,
```

In the `looksLikeSearch` branch, return:

```ts
    domain: "relationship_memory",
    search: {
      mode: inferSearchMode(text),
      semanticQuery: text,
      exactTerms: inferTags(text).length > 0 ? inferTags(text).map((tag) => tag.toLowerCase()) : [],
      filters: { tags: inferTags(text) },
      topK: 10
    },
```

Add:

```ts
function inferSearchMode(text: string): NonNullable<MessageInterpretation["search"]>["mode"] {
  return /\b(anyone|anybody|people|contacts?)\b.*\b(related|connected|connection)\b/i.test(text)
    ? "list_related_people"
    : "semantic_recall";
}
```

- [ ] **Step 6: Build `MemorySearchRequest` internally**

In `src/relationship/interpretedAgent.ts`, add local type and helper:

```ts
type MemorySearchRequest = {
  userId: string;
  rawMessage: string;
  interpretedQuery?: string;
  normalizedQuery?: string;
  exactTerms: string[];
  semanticQuery?: string;
  mode?: NonNullable<MessageInterpretation["search"]>["mode"];
  filters?: NonNullable<MessageInterpretation["search"]>["filters"];
  topK: number;
};

function buildMemorySearchRequest(message: InboundAgentMessage, interpretation: MessageInterpretation): MemorySearchRequest {
  const query = buildSearchQueryFromInterpretation(interpretation) || message.text;
  const normalizedQuery = normalizeMemorySearchQuery(query);
  return {
    userId: message.userId,
    rawMessage: message.text,
    interpretedQuery: query,
    normalizedQuery,
    exactTerms: interpretation.search?.exactTerms ?? [],
    semanticQuery: interpretation.search?.semanticQuery,
    mode: interpretation.search?.mode,
    filters: interpretation.search?.filters,
    topK: interpretation.search?.topK ?? 10
  };
}
```

Import `normalizeMemorySearchQuery` from `./tools`.

- [ ] **Step 7: Use request in search execution**

Where `executeInterpretation` runs search, use:

```ts
const searchRequest = buildMemorySearchRequest(message, interpretation);
const query = searchRequest.normalizedQuery || searchRequest.interpretedQuery || searchRequest.rawMessage;
const matches = tools.search_memories(message.userId, query);
```

- [ ] **Step 8: Run targeted tests**

Run:

```bash
npm test -- src/relationship/interpretation.test.ts src/relationship/openAIInterpreter.test.ts src/relationship/interpretedAgent.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit route fields**

Run:

```bash
git add src/relationship/interpretation.ts src/relationship/interpretation.test.ts src/relationship/openAIInterpreter.ts src/relationship/interpretedAgent.ts src/relationship/interpretedAgent.test.ts
git commit -m "feat:add relationship route search plan"
```

## Task 5: Route Trace Shape

**Files:**
- Modify: `src/relationship/runtime/runtimeTrace.ts`
- Modify: `src/relationship/runtime/runtimeTrace.test.ts`
- Modify: `src/relationship/interpretedAgent.test.ts`

- [ ] **Step 1: Add failing trace test**

In `src/relationship/runtime/runtimeTrace.test.ts`, add:

```ts
  it("records redacted route policy and tool status", () => {
    const trace = buildRedactedInteractionTrace({
      inboundText: "Anyone in my contacts related to friendy?",
      interpretedIntentJson: {
        intent: "search_memory",
        confidence: 0.95,
        domain: "relationship_memory",
        search: {
          mode: "list_related_people",
          exactTerms: ["friendy"]
        },
        policyDecision: { decision: "allow" },
        normalizedQuery: "friendy"
      },
      toolCalls: ["search_memories"],
      outboundText: "I found Testing 1 and Testing 12.",
      now: "2026-05-22T12:00:00.000Z"
    });

    expect(trace.route).toMatchObject({
      domain: "relationship_memory",
      intent: "search_memory",
      confidence: 0.95,
      searchMode: "list_related_people",
      exactTerms: ["friendy"],
      normalizedQuery: "friendy"
    });
    expect(trace.policy).toEqual({ decision: "allow" });
    expect(trace.tools).toEqual([{ name: "search_memories", status: "called" }]);
  });
```

- [ ] **Step 2: Run trace test and verify failure**

Run:

```bash
npm test -- src/relationship/runtime/runtimeTrace.test.ts -t "route policy"
```

Expected: FAIL because `route`, `policy`, and `tools` are not on `AgentTrace`.

- [ ] **Step 3: Extend `AgentTrace`**

In `runtimeTrace.ts`, add:

```ts
  hardBlock?: { blocked: boolean; reason?: string };
  route?: {
    domain?: string;
    intent: string;
    confidence?: number;
    searchMode?: string;
    exactTerms?: string[];
    normalizedQuery?: string;
  };
  policy?: { decision: "allow" | "reject" | "clarify"; reason?: string };
  tools: Array<{ name: AgentToolCall; status: "called" | "skipped" | "failed" }>;
```

Keep existing `toolCalls` for compatibility while adding `tools`.

- [ ] **Step 4: Extract route/policy from interpreted JSON**

Add helper functions in `runtimeTrace.ts`:

```ts
function routeFromInterpretation(value: unknown): AgentTrace["route"] | undefined {
  if (typeof value !== "object" || value === null || !("intent" in value)) {
    return undefined;
  }
  const route = value as {
    intent?: unknown;
    confidence?: unknown;
    domain?: unknown;
    search?: { mode?: unknown; exactTerms?: unknown };
    normalizedQuery?: unknown;
  };
  return {
    domain: typeof route.domain === "string" ? route.domain : undefined,
    intent: String(route.intent ?? "unknown"),
    confidence: typeof route.confidence === "number" ? route.confidence : undefined,
    searchMode: typeof route.search?.mode === "string" ? route.search.mode : undefined,
    exactTerms: Array.isArray(route.search?.exactTerms) ? route.search.exactTerms.map(String) : undefined,
    normalizedQuery: typeof route.normalizedQuery === "string" ? route.normalizedQuery : undefined
  };
}

function policyFromInterpretation(value: unknown): AgentTrace["policy"] | undefined {
  if (typeof value !== "object" || value === null || !("policyDecision" in value)) {
    return undefined;
  }
  const policy = (value as { policyDecision?: unknown }).policyDecision;
  if (typeof policy !== "object" || policy === null || !("decision" in policy)) {
    return undefined;
  }
  const decision = String((policy as { decision: unknown }).decision);
  return decision === "allow" || decision === "reject" || decision === "clarify"
    ? { decision, reason: typeof (policy as { reason?: unknown }).reason === "string" ? (policy as { reason: string }).reason : undefined }
    : undefined;
}
```

- [ ] **Step 5: Run trace and interpreted tests**

Run:

```bash
npm test -- src/relationship/runtime/runtimeTrace.test.ts src/relationship/interpretedAgent.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit trace shape**

Run:

```bash
git add src/relationship/runtime/runtimeTrace.ts src/relationship/runtime/runtimeTrace.test.ts src/relationship/interpretedAgent.test.ts
git commit -m "feat:add route policy trace shape"
```

## Task 6: Required Eval Coverage

**Files:**
- Modify: `src/relationship/evals/agentEvalRunner.ts`
- Modify: `src/relationship/evals/behavior-contract-cases.ts`
- Test: `src/relationship/evals/agentEvalRunner.test.ts`

- [ ] **Step 1: Add eval catalog entry**

In `relationshipAgentEvalCases`, add before `friendy-doctor-setup-failure-copy`:

```ts
  evalCase("broad-related-contact-recall", "interpreted", [
    "broad related-contact recall calls search",
    "broad related-contact recall returns seeded contacts",
    "broad related-contact recall does not redirect"
  ]),
```

- [ ] **Step 2: Add executable eval case**

In `executableEvalCases`, add a matching run case:

```ts
  {
    ...relationshipAgentEvalCases.find((item) => item.id === "broad-related-contact-recall")!,
    async run({ interpreter, now }) {
      const repo = createRelationshipRepository({
        users: [fixtureUser],
        memories: [
          memory("memory_testing_1", "Testing 1", "Testing Friendy", "testing Friendy"),
          memory("memory_testing_12", "Testing 12", "Met them during testing Friendy", "testing Friendy")
        ]
      });
      const tools = createRelationshipTools(repo);
      const agent = createInterpretedRelationshipAgent({ repo, tools, interpreter, now, timezone });
      const result = await agent.handleMessage(inbound("Anyone in my contacts related to friendy?", "terminal"));

      return [
        assertion("broad related-contact recall calls search", "intent", result.toolCalls.includes("search_memories")),
        assertion(
          "broad related-contact recall returns seeded contacts",
          "searchRecall",
          result.outbound.text.includes("Testing 1") && result.outbound.text.includes("Testing 12")
        ),
        assertion(
          "broad related-contact recall does not redirect",
          "scopeBoundary",
          !result.outbound.text.includes("people you know")
        )
      ];
    }
  },
```

Use the existing eval helper for memory fixtures if one exists in the file; otherwise add a local helper near other eval helpers:

```ts
function memory(id: string, displayName: string, contextNote: string, eventTitle: string) {
  return {
    id,
    userId: fixtureUser.id,
    displayName,
    primaryContactLabel: "contact saved",
    eventTitle,
    contextNote,
    tags: contextNote.toLowerCase().split(/\s+/).filter(Boolean),
    confidence: 0.8,
    createdAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:00:00.000Z"
  };
}
```

- [ ] **Step 3: Update behavior contract names**

Add this to `behaviorContractCaseNames`:

```ts
  "broad related-contact recall reaches search"
```

- [ ] **Step 4: Run eval tests and eval CLI**

Run:

```bash
npm test -- src/relationship/evals/agentEvalRunner.test.ts
npm run eval:agent
```

Expected: both PASS, with required eval count increased by one.

- [ ] **Step 5: Commit eval coverage**

Run:

```bash
git add src/relationship/evals/agentEvalRunner.ts src/relationship/evals/behavior-contract-cases.ts src/relationship/evals/agentEvalRunner.test.ts
git commit -m "test:add broad relationship recall eval"
```

## Task 7: Documentation and Final Verification

**Files:**
- Modify: `implementation-notes.html`
- Modify: `docs/agent-handoff.md`

- [ ] **Step 1: Update implementation notes**

Add a bullet near the latest relationship recall note:

```html
<li><strong>Relationship routing Spec A implementation (2026-05-22).</strong> Broad contact-related recall such as <code>Anyone in my contacts related to friendy?</code> now routes to <code>search_memories</code>, normalizes filler words away from the query, and records redacted route/policy/tool trace shape. Verification passed with targeted routing/search tests, full tests, build, and agent eval.</li>
```

- [ ] **Step 2: Update handoff**

In `docs/agent-handoff.md`, replace the known follow-up saying broad recall can redirect with:

```md
- Broad relationship recall routing Spec A is implemented: “Anyone in my contacts related to Friendy?” should now route to `search_memories`. Later retrieval quality upgrades are scoped in Spec B at `docs/superpowers/specs/2026-05-22-relationship-hybrid-retrieval-design.md`.
```

- [ ] **Step 3: Run final verification**

Run:

```bash
npm test
npm run build
npm run eval:agent
git diff --check
```

Expected:

```text
npm test: all test files pass
npm run build: exit 0
npm run eval:agent: 0 required failures, 0 unsafe mutations, 0 hallucinations
git diff --check: no output
```

- [ ] **Step 4: Commit docs and final state**

Run:

```bash
git add implementation-notes.html docs/agent-handoff.md
git commit -m "docs:record relationship routing implementation"
```

## Plan Self-Review

- Spec A coverage: routing hotfix is covered by Tasks 1-2; query normalization by Task 3; route/search fields and `MemorySearchRequest` by Task 4; trace shape by Task 5; evals by Task 6; docs and verification by Task 7.
- Spec B exclusion: retrieval documents, FTS5, embeddings, and reranking are not implemented here.
- Type consistency: `RouteDomain`, `SearchPlan`, and `MemorySearchRequest` names match Spec A.
- Verification: every behavior-changing task has a red test step, a green step, and a targeted command.
