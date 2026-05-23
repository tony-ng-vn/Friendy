# Pass State Into LLM Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a compact, privacy-bounded routing state envelope to OpenRouter so Friendy can distinguish stale-prompt complaints, duplicate audits, deletes, and real pending-contact answers.

**Architecture:** Add a pure `routerInputEnvelope` builder at the boundary between `interpretedAgent.ts` and `openRouterInterpreter.ts`. The agent gathers durable/reconstructable state, the builder redacts and caps it, OpenRouter serializes it as the user message, and deterministic policy/tools remain the only execution path.

**Tech Stack:** TypeScript, Vitest, Zod/JSON schema validation, OpenRouter chat completions, existing Friendy relationship-agent repository/tools.

---

## File Structure

- Create: `src/relationship/routerInputEnvelope.ts`
  - Owns `RouterInputEnvelope`, `RouterConversationState`, `RouterDomainStateSummary`, `RouterRouteCapability`, `MessageInterpreterInput`, and `buildRouterInputEnvelope`.
  - Redacts/caps route state before model serialization.
- Create: `src/relationship/routerInputEnvelope.test.ts`
  - Tests active workflow projection, duplicate summaries, privacy redaction, caps, stable ordering, and tool/capability separation.
- Modify: `src/relationship/openRouterInterpreter.ts`
  - Change `MessageInterpreter.interpret` to accept `MessageInterpreterInput`.
  - Serialize the envelope when present.
  - Keep production fallback disallowed in strict mode.
- Modify: `src/relationship/openRouterInterpreter.test.ts`
  - Assert OpenRouter user content contains the envelope, not only raw text.
  - Assert fallback/test interpreter accepts the input object.
- Modify: `src/relationship/interpretedAgent.ts`
  - Build `RouterInputEnvelope` after `pendingState` and `turnContext` are available and before interpreter routing.
  - Pass `{ message, routerContext }` to the interpreter.
- Modify: `src/relationship/behaviorContract.ts`
  - Update prompt instructions to route from the state envelope and use current `MessageInterpretation["intent"]` values.
- Modify: `src/relationship/interpretation.ts`
  - Only if tests expose drift between spec and schema. Do not add new intent strings unless policy is updated in the same task.
- Modify: `src/relationship/interpretedAgent.test.ts`
  - Assert state is passed to the interpreter and stale-prompt complaint can route to explain/repair.
- Modify: `src/relationship/evals/agentEvalRunner.ts`
  - Add one state-aware routing fixture if not already covered.
- Modify: `implementation-notes.html`
  - Record envelope fields, redaction choices, and any deferred context sources.

## Task 1: Add Router Envelope Contract Tests

**Files:**
- Create: `src/relationship/routerInputEnvelope.test.ts`
- Create: `src/relationship/routerInputEnvelope.ts`

- [ ] **Step 1: Write failing tests for active workflow, duplicates, and redaction**

Create `src/relationship/routerInputEnvelope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fixtureDetectedContact, fixtureUser } from "./fixtures";
import { buildConversationState } from "./conversationState";
import { createRelationshipRepository } from "./repository";
import { createRelationshipTools } from "./tools";
import { buildRouterInputEnvelope } from "./routerInputEnvelope";
import type { InboundAgentMessage } from "./types";

const inbound = (text: string): InboundAgentMessage => ({
  userId: fixtureUser.id,
  platform: "imessage",
  spaceId: "imessage_space_testing",
  text,
  receivedAt: "2026-05-20T12:00:00.000Z"
});

describe("router input envelope", () => {
  it("projects active pending workflow with lastFriendyPrompt and frame id", () => {
    const repo = createRelationshipRepository({ users: [fixtureUser] });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate({
      ...fixtureDetectedContact,
      displayName: "Testing 3",
      contactIdentifier: "contact_testing_3",
      phoneNumbers: ["+15550101003"],
      emails: ["testing3@example.com"]
    });
    repo.markCandidatePrompted(candidate.id, "interaction_prompt_testing_3", {
      spaceId: "imessage_space_testing",
      promptedAt: "2026-05-20T11:59:00.000Z"
    });
    const state = buildConversationState({
      userId: fixtureUser.id,
      spaceId: "imessage_space_testing",
      pendingCandidates: repo.listPendingCandidates(fixtureUser.id)
    });

    const envelope = buildRouterInputEnvelope({
      message: inbound("Why are you still asking for Testing 3 context when you already have it?"),
      conversationState: state,
      memories: [],
      availableTools: ["list_people", "search_memories", "find_duplicate_people", "confirm_candidate"],
      availableRouteCapabilities: ["explain_agent_state", "conversation_repair", "answer_pending_contact_prompt"]
    });

    expect(envelope.conversationState.activeWorkflow).toMatchObject({
      kind: "pending_contact_confirmation",
      frameId: `frame_pending_contact_${candidate.id}`,
      candidateId: candidate.id,
      displayName: "Testing 3",
      lastFriendyPrompt: "I noticed you added Testing 3. Where did you meet them?"
    });
    expect(JSON.stringify(envelope)).not.toContain("+15550101003");
    expect(JSON.stringify(envelope)).not.toContain("testing3@example.com");
    expect(JSON.stringify(envelope)).not.toContain("contact_testing_3");
  });

  it("includes same-name known people and possible duplicate summaries", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      memories: [
        {
          id: "memory_testing_3",
          userId: fixtureUser.id,
          candidateId: "candidate_saved_testing_3",
          displayName: "Testing 3",
          eventTitle: "testing Friendy",
          contextNote: "I met Testing 3 during testing Friendy",
          contactMethod: "contact saved",
          tags: ["testing", "friendy"],
          createdAt: "2026-05-20T10:00:00.000Z"
        }
      ]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate({
      ...fixtureDetectedContact,
      displayName: "Testing 3",
      contactIdentifier: "contact_pending_testing_3",
      phoneNumbers: [],
      emails: []
    });
    repo.markCandidatePrompted(candidate.id, "interaction_prompt_testing_3", {
      spaceId: "imessage_space_testing",
      promptedAt: "2026-05-20T11:59:00.000Z"
    });
    const state = buildConversationState({
      userId: fixtureUser.id,
      spaceId: "imessage_space_testing",
      pendingCandidates: repo.listPendingCandidates(fixtureUser.id)
    });

    const envelope = buildRouterInputEnvelope({
      message: inbound("Why are you still asking for Testing 3 context when you already have it?"),
      conversationState: state,
      memories: repo.listMemories(fixtureUser.id),
      availableTools: ["list_people", "search_memories", "find_duplicate_people", "confirm_candidate"],
      availableRouteCapabilities: ["explain_agent_state", "conversation_repair", "answer_pending_contact_prompt"]
    });

    expect(envelope.domainStateSummary.knownPeopleNamed).toContainEqual({
      queryName: "Testing 3",
      memoryIds: ["memory_testing_3"],
      candidateIds: [candidate.id]
    });
    expect(envelope.domainStateSummary.possibleDuplicates).toContainEqual({
      displayName: "Testing 3",
      memoryIds: ["memory_testing_3"],
      candidateIds: [candidate.id],
      reason: "same_display_name"
    });
  });
});
```

- [ ] **Step 2: Add a minimal stub so tests compile and fail on behavior**

Create `src/relationship/routerInputEnvelope.ts`:

```ts
import type { MessageInterpretation } from "./interpretation";
import type { ConversationState } from "./conversationState";
import type { AgentToolCall, InboundAgentMessage, RelationshipMemory } from "./types";

export type RouterRouteCapability = MessageInterpretation["intent"];

export type RouterInputEnvelope = {
  userText: string;
  conversationState: {
    activeWorkflow?: {
      kind: "pending_contact_confirmation";
      frameId: string;
      candidateId: string;
      displayName: string;
      lastFriendyPrompt: string;
      promptedAt?: string;
    };
    recentAgentMessages: Array<{
      text: string;
      createdAt?: string;
      relatedCandidateId?: string;
      relatedMemoryIds?: string[];
    }>;
    recentEntityRefs: Array<{
      kind: "candidate" | "memory" | "person" | "event";
      id?: string;
      displayName: string;
    }>;
    lastListResultIds: string[];
    lastToolErrors: Array<{ tool: string; code: string; shortMessage: string }>;
  };
  domainStateSummary: {
    pendingCandidates: Array<{
      candidateId: string;
      displayName: string;
      status: "pending" | "prompted";
      isActive: boolean;
      lastFriendyPrompt?: string;
      eventGuessNames?: string[];
    }>;
    possibleDuplicates: Array<{
      displayName: string;
      candidateIds: string[];
      memoryIds: string[];
      reason: "same_display_name" | "alias_overlap" | "same_contact_method_hash" | "unknown";
    }>;
    knownPeopleNamed: Array<{ queryName: string; memoryIds: string[]; candidateIds: string[] }>;
  };
  availableTools: AgentToolCall[];
  availableRouteCapabilities: RouterRouteCapability[];
};

export type MessageInterpreterInput = {
  message: InboundAgentMessage;
  routerContext?: RouterInputEnvelope;
};

export function buildRouterInputEnvelope(_input: {
  message: InboundAgentMessage;
  conversationState: ConversationState;
  memories: RelationshipMemory[];
  availableTools: AgentToolCall[];
  availableRouteCapabilities: RouterRouteCapability[];
}): RouterInputEnvelope {
  throw new Error("buildRouterInputEnvelope not implemented");
}
```

- [ ] **Step 3: Run RED test**

Run:

```bash
npm test -- src/relationship/routerInputEnvelope.test.ts
```

Expected: FAIL because `buildRouterInputEnvelope not implemented`.

- [ ] **Step 4: Commit RED tests**

```bash
git add src/relationship/routerInputEnvelope.ts src/relationship/routerInputEnvelope.test.ts
git commit -m "test:add router input envelope contract"
```

## Task 2: Implement The Envelope Builder

**Files:**
- Modify: `src/relationship/routerInputEnvelope.ts`
- Test: `src/relationship/routerInputEnvelope.test.ts`

- [ ] **Step 1: Implement capped and redacted builder**

Replace the throwing implementation in `routerInputEnvelope.ts` with:

```ts
const MAX_TEXT_FIELD_CHARS = 240;
const MAX_PENDING_CANDIDATES = 5;
const MAX_RECENT_AGENT_MESSAGES = 5;
const MAX_RECENT_ENTITY_REFS = 10;
const MAX_LAST_LIST_RESULT_IDS = 10;
const MAX_TOOL_ERRORS = 3;
const MAX_ENVELOPE_BYTES = 8 * 1024;

export function buildRouterInputEnvelope(input: {
  message: InboundAgentMessage;
  conversationState: ConversationState;
  memories: RelationshipMemory[];
  availableTools: AgentToolCall[];
  availableRouteCapabilities: RouterRouteCapability[];
  recentAgentMessages?: RouterInputEnvelope["conversationState"]["recentAgentMessages"];
  recentEntityRefs?: RouterInputEnvelope["conversationState"]["recentEntityRefs"];
  lastListResultIds?: string[];
  lastToolErrors?: RouterInputEnvelope["conversationState"]["lastToolErrors"];
}): RouterInputEnvelope {
  const active = input.conversationState.activeFrame;
  const pendingCandidates = input.conversationState.pendingContactQueue
    .slice(0, MAX_PENDING_CANDIDATES)
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      displayName: truncateForRouter(candidate.displayName),
      status: candidate.status === "prompted" ? "prompted" as const : "pending" as const,
      isActive: candidate.candidateId === active?.candidateId,
      lastFriendyPrompt: candidate.candidateId === active?.candidateId ? truncateForRouter(active.lastFriendyPrompt) : undefined,
      eventGuessNames: []
    }));
  const envelope: RouterInputEnvelope = {
    userText: truncateForRouter(input.message.text),
    conversationState: {
      activeWorkflow: active
        ? {
            kind: "pending_contact_confirmation",
            frameId: active.frameId,
            candidateId: active.candidateId,
            displayName: truncateForRouter(active.displayName),
            lastFriendyPrompt: truncateForRouter(active.lastFriendyPrompt),
            promptedAt: active.openedAt
          }
        : undefined,
      recentAgentMessages: (input.recentAgentMessages ?? []).slice(0, MAX_RECENT_AGENT_MESSAGES).map((message) => ({
        ...message,
        text: truncateForRouter(message.text)
      })),
      recentEntityRefs: (input.recentEntityRefs ?? []).slice(0, MAX_RECENT_ENTITY_REFS),
      lastListResultIds: (input.lastListResultIds ?? []).slice(0, MAX_LAST_LIST_RESULT_IDS),
      lastToolErrors: (input.lastToolErrors ?? []).slice(0, MAX_TOOL_ERRORS).map((error) => ({
        tool: error.tool,
        code: error.code,
        shortMessage: truncateForRouter(error.shortMessage)
      }))
    },
    domainStateSummary: {
      pendingCandidates,
      possibleDuplicates: buildPossibleDuplicates(input.memories, pendingCandidates, input.message.text),
      knownPeopleNamed: buildKnownPeopleNamed(input.memories, pendingCandidates, input.message.text)
    },
    availableTools: [...input.availableTools].sort(),
    availableRouteCapabilities: [...input.availableRouteCapabilities].sort()
  };
  return capEnvelopeBytes(envelope);
}

function truncateForRouter(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT_FIELD_CHARS);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function mentionedDisplayNames(text: string, memories: RelationshipMemory[], pending: Array<{ displayName: string }>): string[] {
  const normalizedText = normalizeName(text);
  const names = new Set<string>();
  for (const name of [...memories.map((memory) => memory.displayName), ...pending.map((candidate) => candidate.displayName)]) {
    if (normalizedText.includes(normalizeName(name))) {
      names.add(name);
    }
  }
  return [...names].sort();
}

function buildKnownPeopleNamed(
  memories: RelationshipMemory[],
  pending: Array<{ candidateId: string; displayName: string }>,
  text: string
): RouterInputEnvelope["domainStateSummary"]["knownPeopleNamed"] {
  return mentionedDisplayNames(text, memories, pending)
    .map((name) => ({
      queryName: name,
      memoryIds: memories.filter((memory) => normalizeName(memory.displayName) === normalizeName(name)).map((memory) => memory.id).sort(),
      candidateIds: pending
        .filter((candidate) => normalizeName(candidate.displayName) === normalizeName(name))
        .map((candidate) => candidate.candidateId)
        .sort()
    }))
    .filter((entry) => entry.memoryIds.length > 0 || entry.candidateIds.length > 0);
}

function buildPossibleDuplicates(
  memories: RelationshipMemory[],
  pending: Array<{ candidateId: string; displayName: string }>,
  text: string
): RouterInputEnvelope["domainStateSummary"]["possibleDuplicates"] {
  return buildKnownPeopleNamed(memories, pending, text)
    .filter((entry) => entry.memoryIds.length > 0 && entry.candidateIds.length > 0)
    .map((entry) => ({
      displayName: entry.queryName,
      memoryIds: entry.memoryIds,
      candidateIds: entry.candidateIds,
      reason: "same_display_name" as const
    }));
}

function capEnvelopeBytes(envelope: RouterInputEnvelope): RouterInputEnvelope {
  const encoded = JSON.stringify(envelope);
  if (Buffer.byteLength(encoded, "utf8") <= MAX_ENVELOPE_BYTES) {
    return envelope;
  }

  return {
    ...envelope,
    conversationState: {
      ...envelope.conversationState,
      recentAgentMessages: [],
      recentEntityRefs: [],
      lastListResultIds: [],
      lastToolErrors: []
    }
  };
}
```

- [ ] **Step 2: Run envelope tests**

Run:

```bash
npm test -- src/relationship/routerInputEnvelope.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit implementation**

```bash
git add src/relationship/routerInputEnvelope.ts src/relationship/routerInputEnvelope.test.ts
git commit -m "feat:add router input envelope builder"
```

## Task 3: Change Interpreter Input Shape

**Files:**
- Modify: `src/relationship/openRouterInterpreter.ts`
- Modify: `src/relationship/openRouterInterpreter.test.ts`
- Test: `src/relationship/openRouterInterpreter.test.ts`

- [ ] **Step 1: Write failing OpenRouter serialization test**

Add to `openRouterInterpreter.test.ts`:

```ts
it("serializes router envelope as the OpenRouter user message", async () => {
  let requestBody: unknown;
  const fetchImpl = async (_url: string, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "explain_agent_state",
                confidence: 0.94,
                domain: "relationship_memory",
                conversationRelation: "asks_about_open_workflow",
                target: { displayName: "Testing 3" },
                people: [],
                event: { name: "", dateText: "", location: "" },
                dateContext: null,
                contextNote: "",
                query: "",
                tags: [],
                needsClarification: false,
                clarificationQuestion: ""
              })
            }
          }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  const interpreter = createOpenRouterInterpreter({ apiKey: "test-key", model: "test-model", fetchImpl });

  await interpreter.interpret({
    message: inbound("Why are you still asking for Testing 3 context?"),
    routerContext: {
      userText: "Why are you still asking for Testing 3 context?",
      conversationState: {
        activeWorkflow: {
          kind: "pending_contact_confirmation",
          frameId: "frame_pending_contact_1",
          candidateId: "candidate_1",
          displayName: "Testing 3",
          lastFriendyPrompt: "I noticed you added Testing 3. Where did you meet them?"
        },
        recentAgentMessages: [],
        recentEntityRefs: [],
        lastListResultIds: [],
        lastToolErrors: []
      },
      domainStateSummary: {
        pendingCandidates: [],
        possibleDuplicates: [],
        knownPeopleNamed: []
      },
      availableTools: ["list_people", "search_memories"],
      availableRouteCapabilities: ["explain_agent_state", "conversation_repair"]
    }
  });

  const messages = (requestBody as { messages: Array<{ role: string; content: string }> }).messages;
  expect(messages[1].content).toContain("Route this Friendy turn using the state envelope.");
  expect(messages[1].content).toContain('"activeWorkflow"');
  expect(messages[1].content).toContain('"lastFriendyPrompt"');
  expect(messages[1].content).not.toBe("Why are you still asking for Testing 3 context?");
});
```

- [ ] **Step 2: Run RED test**

```bash
npm test -- src/relationship/openRouterInterpreter.test.ts
```

Expected: FAIL because `interpret` still accepts an inbound message and `callOpenRouter` serializes `message.text`.

- [ ] **Step 3: Update interpreter contract**

In `openRouterInterpreter.ts`, import the new type and change the contract:

```ts
import type { InboundAgentMessage } from "./types";
import type { MessageInterpreterInput } from "./routerInputEnvelope";

export type MessageInterpreter = {
  interpret(input: MessageInterpreterInput): Promise<MessageInterpreterResult>;
};
```

Update `createOpenRouterInterpreter`:

```ts
async interpret(input) {
  const { message } = input;
  // existing strict/fallback logic
  const interpretation = await callOpenRouter({ apiKey, model, fetchImpl, input });
}
```

Update fallback call sites:

```ts
const fallbackResult = await fallback.interpret(input);
```

Update `createRuleBasedInterpreter`:

```ts
export function createRuleBasedInterpreter(): MessageInterpreter {
  return {
    async interpret(input) {
      return {
        interpretation: validateMessageInterpretation(ruleBasedInterpret(input.message.text)),
        modelUsed: "rule-based-fallback",
        error: "",
        routeSource: "fallback",
        fallbackUsed: true,
        fallbackReason: "explicit_fallback"
      };
    }
  };
}
```

Change `callOpenRouter` to accept `input` and serialize:

```ts
function serializeRouterUserContent(input: MessageInterpreterInput): string {
  if (!input.routerContext) {
    return input.message.text;
  }

  return [
    "Route this Friendy turn using the state envelope.",
    "Return only JSON matching the schema.",
    JSON.stringify(input.routerContext)
  ].join("\n\n");
}
```

Use it in messages:

```ts
{ role: "user", content: serializeRouterUserContent(input) }
```

- [ ] **Step 4: Update tests/stubs for object input**

Replace test interpreter stubs shaped like:

```ts
async interpret(message) {
  // message.text
}
```

with:

```ts
async interpret(input) {
  // input.message.text
}
```

- [ ] **Step 5: Run OpenRouter tests**

```bash
npm test -- src/relationship/openRouterInterpreter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit interpreter input change**

```bash
git add src/relationship/openRouterInterpreter.ts src/relationship/openRouterInterpreter.test.ts
git commit -m "feat:send router envelope to OpenRouter"
```

## Task 4: Wire Envelope Construction In Interpreted Agent

**Files:**
- Modify: `src/relationship/interpretedAgent.ts`
- Modify: `src/relationship/interpretedAgent.test.ts`
- Test: `src/relationship/interpretedAgent.test.ts`

- [ ] **Step 1: Write failing test that interpreter receives state**

Add to `interpretedAgent.test.ts`:

```ts
it("passes active workflow and same-name state into the interpreter", async () => {
  const repo = createRelationshipRepository({
    users: [fixtureUser],
    memories: [
      {
        ...memoryFixture("Testing 3", "I met Testing 3 during testing Friendy"),
        id: "memory_testing_3"
      }
    ]
  });
  const tools = createRelationshipTools(repo);
  const candidate = tools.create_contact_candidate({
    ...fixtureDetectedContact,
    displayName: "Testing 3",
    contactIdentifier: "contact_pending_testing_3",
    phoneNumbers: [],
    emails: []
  });
  repo.markCandidatePrompted(candidate.id, "interaction_prompt_testing_3", {
    spaceId: "imessage_space_testing",
    promptedAt: "2026-05-20T11:59:00.000Z"
  });
  let capturedInput: unknown;
  const agent = createInterpretedRelationshipAgent({
    repo,
    tools,
    interpreter: {
      async interpret(input) {
        capturedInput = input;
        return modelInterpreter({
          intent: "explain_agent_state",
          domain: "relationship_memory",
          conversationRelation: "asks_about_open_workflow",
          confidence: 0.94,
          target: { displayName: "Testing 3" }
        }).interpret(input);
      }
    },
    now: () => "2026-05-20T12:00:00.000Z",
    timezone: "America/Los_Angeles"
  });

  const result = await agent.handleMessage(inbound("Why are you still asking for Testing 3 context when you already have it?"));

  expect(result.toolCalls).toEqual([]);
  expect(capturedInput).toMatchObject({
    message: { text: expect.stringContaining("Why are you still asking") },
    routerContext: {
      conversationState: {
        activeWorkflow: {
          candidateId: candidate.id,
          displayName: "Testing 3"
        }
      },
      domainStateSummary: {
        possibleDuplicates: [
          {
            displayName: "Testing 3",
            memoryIds: ["memory_testing_3"],
            candidateIds: [candidate.id]
          }
        ]
      }
    }
  });
});
```

- [ ] **Step 2: Run RED test**

```bash
npm test -- src/relationship/interpretedAgent.test.ts
```

Expected: FAIL because `interpreter.interpret(message)` is still called without router context.

- [ ] **Step 3: Build and pass router context**

In `interpretedAgent.ts`, import:

```ts
import { buildRouterInputEnvelope, type RouterRouteCapability } from "./routerInputEnvelope";
```

Before the interpreter call, add:

```ts
const routerContext = buildRouterInputEnvelope({
  message,
  conversationState: pendingState,
  memories: repo.listMemories(message.userId),
  availableTools: [
    "list_people",
    "find_duplicate_people",
    "search_memories",
    "list_pending_candidates",
    "list_candidate_event_matches",
    "get_candidate",
    "confirm_candidate",
    "ignore_candidate",
    "create_manual_memory",
    "update_memory",
    "delete_memory"
  ],
  availableRouteCapabilities: [
    "answer_pending_contact_prompt",
    "capture_pending_contact_context",
    "ignore_candidate",
    "list_people",
    "search_memory",
    "duplicate_audit",
    "delete_memory_request",
    "update_memory",
    "explain_agent_state",
    "explain_pending_workflow",
    "conversation_repair",
    "clarify",
    "reject"
  ] satisfies RouterRouteCapability[]
});

const interpreted = await interpreter.interpret({ message, routerContext });
```

- [ ] **Step 4: Update remaining interpreter test helpers**

Update `modelInterpreter(...)` helper signatures in `interpretedAgent.test.ts` to accept `MessageInterpreterInput`:

```ts
function modelInterpreter(route: Partial<MessageInterpretation>): MessageInterpreter {
  return {
    async interpret() {
      return {
        interpretation: validateMessageInterpretation({
          intent: route.intent ?? "search_memory",
          confidence: route.confidence ?? 0.9,
          people: route.people ?? [],
          event: route.event ?? { name: "", dateText: "", location: "" },
          dateContext: route.dateContext ?? null,
          contextNote: route.contextNote ?? "",
          query: route.query ?? "",
          tags: route.tags ?? [],
          needsClarification: route.needsClarification ?? false,
          clarificationQuestion: route.clarificationQuestion ?? "",
          ...route
        }),
        modelUsed: "test-model",
        error: "",
        routeSource: "llm",
        fallbackUsed: false
      };
    }
  };
}
```

- [ ] **Step 5: Run interpreted agent tests**

```bash
npm test -- src/relationship/interpretedAgent.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit agent wiring**

```bash
git add src/relationship/interpretedAgent.ts src/relationship/interpretedAgent.test.ts
git commit -m "feat:pass router state from interpreted agent"
```

## Task 5: Update Behavior Contract For State-Aware Routing

**Files:**
- Modify: `src/relationship/behaviorContract.ts`
- Modify: `src/relationship/openRouterInterpreter.test.ts`
- Test: `src/relationship/openRouterInterpreter.test.ts`

- [ ] **Step 1: Write failing prompt assertion**

Add or update a prompt test:

```ts
it("instructs the model to use state-aware route intents", () => {
  const prompt = buildInterpreterSystemPrompt();
  const instructions = buildStructuredOutputInstructions();

  expect(prompt).toContain("state envelope");
  expect(prompt).toContain("explain_agent_state");
  expect(prompt).toContain("conversation_repair");
  expect(prompt).toContain("duplicate_audit");
  expect(prompt).toContain("Do not assume every message is an answer to the pending contact prompt");
  expect(instructions).toContain("answer_pending_contact_prompt");
  expect(instructions).toContain("delete_memory_request");
});
```

- [ ] **Step 2: Run RED test**

```bash
npm test -- src/relationship/openRouterInterpreter.test.ts
```

Expected: FAIL because the prompt still lists legacy example intents only.

- [ ] **Step 3: Update prompt copy**

In `behaviorContract.ts`, update `buildInterpreterSystemPrompt()` with:

```ts
return [
  "You interpret Friendy relationship-memory turns into JSON only.",
  "The user message may contain a compact state envelope with userText, conversationState, domainStateSummary, availableTools, and availableRouteCapabilities.",
  "Use userText plus the state envelope to choose the route.",
  "Do not execute actions. Do not invent people, contacts, or memories.",
  "If an active pending contact prompt is present, useful relationship facts may answer it, but do not assume every message is an answer to the pending contact prompt.",
  "Questions about why Friendy asked something route to explain_agent_state.",
  "Complaints that Friendy already knows something route to conversation_repair.",
  "Duplicate questions route to duplicate_audit.",
  "Delete/remove/forget memory requests route to delete_memory_request.",
  "Route who-did-I-meet-at/during/from questions as event_recall search_memory, not list_people.",
  "Route list/inventory/bullet requests as list_people.",
  "Route add/save/remember Person as/is/from/at context as manual_memory_create.",
  "Stay scoped to relationship memory and people the user has met."
].join(" ");
```

Update `buildStructuredOutputInstructions()` with:

```ts
return [
  "Return JSON that matches the provided schema.",
  "Emit exactly one schema-supported intent.",
  "Supported current intents include answer_pending_contact_prompt, capture_pending_contact_context, explain_pending_workflow, explain_agent_state, conversation_repair, duplicate_audit, delete_memory_request, list_people, search_memory, manual_memory_create, update_memory, delete_memory, ignore_candidate, clarify, reject, and unknown.",
  "Do not include prose outside the JSON response."
].join(" ");
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/relationship/openRouterInterpreter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit prompt update**

```bash
git add src/relationship/behaviorContract.ts src/relationship/openRouterInterpreter.test.ts
git commit -m "fix:update router prompt for state envelope"
```

## Task 6: Add Evals For State-Aware Routing

**Files:**
- Modify: `src/relationship/evals/agentEvalRunner.ts`
- Modify: `src/relationship/evals/agentEvalRunner.test.ts`
- Test: `src/relationship/evals/agentEvalRunner.test.ts`

- [ ] **Step 1: Add eval catalog assertion**

Add a required case id such as:

```ts
evalCase("state-envelope-stale-prompt-complaint", "interpreted", [
  "state envelope routes stale prompt complaint to explain or repair",
  "state envelope includes same-name pending and saved memory",
  "stale prompt complaint does not confirm candidate"
]);
```

In the test catalog assertion:

```ts
expect(relationshipAgentEvalCases.map((evalCase) => evalCase.id)).toContain("state-envelope-stale-prompt-complaint");
```

- [ ] **Step 2: Implement eval with inspecting interpreter**

Add an executable eval that seeds saved Testing 3 plus pending Testing 3 and uses a test interpreter that inspects `input.routerContext`:

```ts
const stateEnvelopeStalePromptComplaint = async ({ now }: Required<Pick<RunOptions, "now">>) => {
  const repo = createRelationshipRepository({ users: [fixtureUser] });
  const tools = createRelationshipTools(repo);
  // seed saved memory and pending candidate through existing helpers in this file
  let sawDuplicateSummary = false;
  const interpreter: MessageInterpreter = {
    async interpret(input) {
      sawDuplicateSummary =
        input.routerContext?.domainStateSummary.possibleDuplicates.some((group) => group.displayName === "Testing 3") ?? false;
      return modelInterpreter({
        intent: "explain_agent_state",
        domain: "relationship_memory",
        conversationRelation: "asks_about_open_workflow",
        target: { displayName: "Testing 3" },
        confidence: 0.94
      }).interpret(input);
    }
  };
  const agent = createInterpretedRelationshipAgent({ repo, tools, interpreter, now, timezone });
  const result = await agent.handleMessage(message("Why u still asking for testing 3 context when u already have it?"));
  return [
    assertion(
      "state envelope routes stale prompt complaint to explain or repair",
      "intent",
      result.trace.route?.intent === "explain_agent_state" || result.trace.route?.intent === "conversation_repair"
    ),
    assertion("state envelope includes same-name pending and saved memory", "intent", sawDuplicateSummary),
    assertion("stale prompt complaint does not confirm candidate", "unsafeMutation", !result.toolCalls.includes("confirm_candidate"))
  ];
};
```

Use local helper names that already exist in `agentEvalRunner.ts`; do not create a second eval framework.

- [ ] **Step 3: Run eval runner tests**

```bash
npm test -- src/relationship/evals/agentEvalRunner.test.ts
```

Expected: PASS after updating total counts if the test currently asserts them.

- [ ] **Step 4: Commit eval**

```bash
git add src/relationship/evals/agentEvalRunner.ts src/relationship/evals/agentEvalRunner.test.ts
git commit -m "test:add state envelope routing eval"
```

## Task 7: Documentation And Final Verification

**Files:**
- Modify: `implementation-notes.html`
- Modify: `docs/agent-handoff.md`

- [ ] **Step 1: Update implementation notes**

Add an entry:

```html
<li><strong>State-aware router envelope (2026-05-23).</strong> OpenRouter now receives a compact redacted routing envelope with active pending workflow, bounded pending candidates, same-name saved/pending summaries, available deterministic tools, and route capabilities. Production strict mode still rejects fallback; the rule-based interpreter accepts the object input only for tests/local fixtures.</li>
```

- [ ] **Step 2: Update handoff**

In `docs/agent-handoff.md`, add current status bullets for PR 4:

```markdown
- PR 4 state-aware router envelope implemented: OpenRouter receives bounded `RouterInputEnvelope` instead of raw text only.
- Envelope redaction excludes phone numbers, emails, contact identifiers, raw contact hashes, raw Apple Contacts payloads, and unbounded message history.
- Strict production fallback remains disabled; fallback compatibility is for tests/local fixtures only.
```

- [ ] **Step 3: Run targeted verification**

```bash
npm test -- src/relationship/routerInputEnvelope.test.ts src/relationship/openRouterInterpreter.test.ts src/relationship/interpretedAgent.test.ts src/relationship/evals/agentEvalRunner.test.ts
npm run build
npm run eval:agent
git diff --check
```

Expected:
- all targeted tests pass;
- build passes;
- evals pass or fail only on unrelated already-frozen follow-up cases explicitly documented in `implementation-notes.html`;
- whitespace check passes.

- [ ] **Step 4: Commit docs**

```bash
git add implementation-notes.html docs/agent-handoff.md
git commit -m "docs:record state-aware router envelope"
```

## Self-Review Checklist

- [ ] The OpenRouter request user message contains the serialized envelope when `routerContext` exists.
- [ ] The fallback/test interpreter accepts `MessageInterpreterInput` but production strict mode still rejects fallback.
- [ ] The envelope separates `availableTools` (`AgentToolCall`) from `availableRouteCapabilities`.
- [ ] Same-name saved/pending conflicts are represented in `knownPeopleNamed` and `possibleDuplicates`.
- [ ] No phone numbers, emails, contact identifiers, raw contact hashes, raw Apple Contacts payloads, or unbounded history are sent to OpenRouter.
- [ ] `conversationRelation` stays route metadata; deterministic policy remains authoritative.
