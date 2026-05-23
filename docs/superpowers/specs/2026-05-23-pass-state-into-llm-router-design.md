# Pass State Into The LLM Router Design (PR 4)

## Summary

PR 4 changes Friendy's model-routing input from raw user text to a compact state-aware routing envelope. PR 3 made relationship-meta routes first-class (`explain_agent_state`, `conversation_repair`, `duplicate_audit`, memory-management requests), but the OpenRouter call still sends only `message.text` as the user content. That means the model cannot reliably know whether the user is answering an active pending prompt, complaining about a stale prompt, asking about duplicates, or repairing a previous answer.

This PR gives the router enough state to choose the right `FriendyIntent` without letting the model mutate memory directly.

## Assumptions

- PR 3's current `MessageInterpretation["intent"]` vocabulary is the canonical route vocabulary for this work. Do not introduce new intent strings in PR 4 unless the schema and policy validator are migrated in the same PR.
- `explain_agent_state` and `conversation_repair` remain first-class routes, not aliases for `clarify` or `unsupported`.
- The LLM router still returns validated structured JSON through `MessageInterpretation`; deterministic tools still execute all reads and mutations.
- State sent to OpenRouter must be compact and privacy-minimized. It may include display names and ids needed for routing, but not raw full contact payloads, phone numbers, emails, or unbounded message history.
- This spec covers the interpreted/OpenRouter path first. Production fallback remains disallowed in strict mode; the rule-based interpreter is only a test/local-fixture interpreter and should accept the new interpreter input shape without becoming a live routing fallback.

## Problem

The current OpenRouter request body is effectively:

```ts
messages: [
  { role: "system", content: systemPrompt },
  { role: "user", content: message.text }
]
```

For a transcript like:

```text
Friendy: What should I remember about Testing 3?
User: Why are you still asking for Testing 3 context when you already have it?
```

the model sees only the user text. It does not see:

- there is an active pending-contact confirmation workflow;
- the active candidate id and display name;
- the last Friendy prompt text;
- saved people or likely duplicates named Testing 3;
- recent list/search results;
- recent tool errors or stale-prompt evidence.

Without that state, the router can incorrectly classify the message as `answer_pending_contact_prompt` because it mentions Testing 3 and context. The correct route is `explain_agent_state` or `duplicate_audit`, depending on the known domain state.

## Objective

Build a compact state envelope for `MessageInterpreter.interpret(...)` so OpenRouter can route with conversation and domain context.

Success means the router can distinguish:

- "I met Testing 3 at the demo" as `answer_pending_contact_prompt`;
- "Why are you still asking about Testing 3?" as `explain_agent_state`;
- "You already know this" as `conversation_repair`;
- "Do you see duplicates?" as `duplicate_audit`;
- "Delete Unnamed Contact" as `delete_memory_request`;
- stale-prompt complaints from real context answers.

## Non-Goals

- Do not add new memory mutation tools.
- Do not let OpenRouter execute tools or decide final user-facing copy.
- Do not add embeddings, reranking, or hybrid retrieval.
- Do not send raw private contact methods, Apple Contacts payloads, phone numbers, emails, or full long transcript history to the model.
- Do not remove deterministic fast paths for lifecycle commands, clear pending-contact answers, clear ignore commands, or hard safety blocks.
- Do not use the state envelope as the persisted trace format; traces may reference the state summary but should stay separately redacted.

## Commands

Use these commands while implementing and verifying this spec:

```bash
npm test -- src/relationship/openRouterInterpreter.test.ts src/relationship/routerInputEnvelope.test.ts src/relationship/interpretedAgent.test.ts
npm run build
npm run eval:agent
git diff --check
```

## Project Structure

Expected source/test locations:

```text
src/relationship/routerInputEnvelope.ts       -> new compact state-envelope builder
src/relationship/routerInputEnvelope.test.ts  -> envelope construction, redaction, caps, ordering
src/relationship/openRouterInterpreter.ts     -> OpenRouter request serialization and interpreter input shape
src/relationship/openRouterInterpreter.test.ts -> request-body and schema tests
src/relationship/interpretedAgent.ts          -> passes conversation/domain state into interpreter
src/relationship/interpretedAgent.test.ts     -> state-aware routing behavior
src/relationship/interpretation.ts            -> route schema/prompt contract if PR 3 left compatibility aliases
src/relationship/behaviorContract.ts          -> prompt instructions for state-aware route selection
```

## Code Style

Prefer small typed builders with explicit caps and redaction at the boundary:

```ts
export function buildRouterInputEnvelope(input: BuildRouterInputEnvelopeInput): RouterInputEnvelope {
  return {
    userText: truncateForRouter(input.message.text),
    conversationState: buildRouterConversationState(input),
    domainStateSummary: buildRouterDomainStateSummary(input),
    availableTools: input.availableTools
  };
}
```

Keep the OpenRouter client boring: it should serialize the envelope and validate the model response, not inspect repository state itself.

## Target Input Envelope

Introduce a routing envelope that becomes the OpenRouter user message content.

```ts
type RouterInputEnvelope = {
  userText: string;
  conversationState: RouterConversationState;
  domainStateSummary: RouterDomainStateSummary;
  availableTools: AgentToolCall[];
  availableRouteCapabilities: RouterRouteCapability[];
};
```

### Conversation state

```ts
type RouterConversationState = {
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
  lastToolErrors: Array<{
    tool: string;
    code: string;
    shortMessage: string;
  }>;
};
```

### Domain state summary

```ts
type RouterDomainStateSummary = {
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
  knownPeopleNamed: Array<{
    queryName: string;
    memoryIds: string[];
    candidateIds: string[];
  }>;
};
```

### Available tools and route capabilities

`availableTools` must use the real deterministic tool names from `src/relationship/types.ts` (`AgentToolCall`). Do not list router intents or response composers as tools.

`availableRouteCapabilities` is advisory context for the model. It tells the model which route intents the current runtime can validate and execute or compose after validation.

```ts
type AgentToolCall =
  | "list_people"
  | "search_memories"
  | "find_duplicate_people"
  | "list_pending_candidates"
  | "list_candidate_event_matches"
  | "get_candidate"
  | "confirm_candidate"
  | "ignore_candidate"
  | "create_manual_memory"
  | "update_memory"
  | "delete_memory";

type RouterRouteCapability =
  | "answer_pending_contact_prompt"
  | "capture_pending_contact_context"
  | "ignore_candidate"
  | "list_people"
  | "search_memory"
  | "duplicate_audit"
  | "delete_memory_request"
  | "update_memory"
  | "explain_agent_state"
  | "explain_pending_workflow"
  | "conversation_repair"
  | "clarify"
  | "reject";
```

Both lists are advisory for route planning. The model may name an intent, but deterministic policy still decides whether a tool can run.

## Serialization For OpenRouter

Use one user message containing compact JSON plus a short instruction header.

```ts
{
  role: "user",
  content: [
    "Route this Friendy turn using the state envelope.",
    "Return only JSON matching the schema.",
    JSON.stringify(routerInputEnvelope)
  ].join("\n\n")
}
```

Do not put the state envelope into the system prompt. The system prompt should describe routing rules and schema behavior; the user message should carry per-turn state.

## State Builder Boundary

Add a dedicated builder instead of constructing the envelope inside `openRouterInterpreter.ts`.

Suggested module:

```text
src/relationship/routerInputEnvelope.ts
```

Responsibilities:

- convert `InboundAgentMessage`, `ConversationState`, recent interaction context, repository summaries, and available tool names into `RouterInputEnvelope`;
- redact or omit private fields;
- cap array sizes and text lengths;
- keep stable ordering so tests and traces are deterministic.

The OpenRouter interpreter should accept either:

```ts
interpret(input: MessageInterpreterInput): Promise<MessageInterpreterResult>
```

or:

```ts
interpret(message: InboundAgentMessage, context?: MessageInterpreterContext): Promise<MessageInterpreterResult>
```

Recommendation: use a single object argument to prevent optional-parameter drift.

```ts
type MessageInterpreterInput = {
  message: InboundAgentMessage;
  routerContext?: RouterContext;
};
```

`createRuleBasedInterpreter()` can ignore most context initially, but tests should prove it does not break when context is present.

Production strict mode must still reject fallback use. Updating the test/local fixture interpreter to accept the new input object is a compatibility task only, not permission to reintroduce live fallback routing.

## Context Sources

Use existing state first:

- `src/relationship/conversationState.ts`
  - active pending candidate frame;
  - pending contact queue.
- interpreted-agent interaction context
  - recent Friendy replies;
  - recent mentioned entities;
  - last list/search result ids if available.
- relationship repository/tools
  - pending candidates;
  - saved memories matching active display name;
  - deterministic duplicate audit summary when cheap.

If some fields do not exist yet, implement minimal placeholders with empty arrays and document the missing source. This is acceptable for `recentAgentMessages`, `recentEntityRefs`, `lastListResultIds`, and `lastToolErrors`.

Do not placeholder the core state required for this PR's main routing bug. When an active workflow exists or the user text contains a display name, `knownPeopleNamed` and the cheap bounded `possibleDuplicates` summary must include same-display-name saved memories and pending candidates for that name where they exist.

## Routing Rules Enabled By State

The model prompt and test cases should make these distinctions explicit.

| State | User text | Expected intent |
|-------|-----------|-----------------|
| Active pending Testing 3, no known memory | `met at the demo` | `answer_pending_contact_prompt` |
| Active pending Testing 3, known saved Testing 3 memory | `why are you still asking for Testing 3 context?` | `explain_agent_state` |
| Active pending Testing 3, known saved Testing 3 memory | `you already know this` | `conversation_repair` |
| Active pending Testing 3, possible duplicates Testing 3 | `do you see duplicate people?` | `duplicate_audit` |
| Active pending Testing 3 | `ignore this one` | `ignore_candidate` |
| Recent list returned memory ids | `delete the unnamed one` | `delete_memory_request` |
| No active workflow | `who did I meet at Photon?` | `search_memory` |
| No active workflow | `list everyone I know` | `list_people` |

## Prompt Requirements

Update the structured-output instructions so the model knows:

- If `activeWorkflow.kind === "pending_contact_confirmation"`, do not assume every message is an answer to the prompt.
- Questions about why Friendy asked something route to `explain_agent_state`.
- Complaints that Friendy already knows something route to `conversation_repair`.
- Duplicate questions route to `duplicate_audit`.
- Delete/update requests route to memory-management intents even if a pending candidate exists.
- `answer_pending_contact_prompt` requires useful relationship context, not merely the words "context", "already", "why", or a repeated name.
- Emit only intent strings accepted by `src/relationship/interpretation.ts` for this PR. Current accepted route strings include `answer_pending_contact_prompt`, `capture_pending_contact_context`, `explain_pending_workflow`, `explain_agent_state`, `conversation_repair`, `duplicate_audit`, `delete_memory_request`, `list_people`, `search_memory`, `manual_memory_create`, `update_memory`, `delete_memory`, `ignore_candidate`, `clarify`, `reject`, and `unknown`.
- `conversationRelation` is supporting route metadata for trace and policy validation. It must not override `intent`; deterministic policy should reject or clarify inconsistent combinations instead of treating relation as a second intent classifier.

## Privacy And Size Rules

The envelope must be bounded:

- max pending candidates: 5;
- max recent agent messages: 5;
- max recent entity refs: 10;
- max last list result ids: 10;
- max tool errors: 3;
- max prompt/message text per field: 240 chars;
- max serialized envelope content: 8 KB before JSON stringification into the OpenRouter message;
- no phone numbers, emails, raw Apple Contacts ids, `contactIdentifier`, raw contact method hashes, or full contact payload JSON.

If a value is redacted, omit it or use a neutral marker. Do not send `[REDACTED PHONE]` style strings that still reveal field existence unless routing needs that fact.

## Testing Strategy

Add RED tests before implementation:

- `openRouterInterpreter.test.ts`
  - OpenRouter request user content is the serialized envelope, not raw text only.
  - Envelope includes active workflow when router context is supplied.
  - Envelope omits phone/email/private contact payload fields.
  - Envelope exposes real `AgentToolCall` names separately from route capabilities.
  - Strict JSON schema response path still validates.
- `routerInputEnvelope.test.ts`
  - builds active pending workflow from conversation state;
  - caps arrays and truncates long text;
  - includes possible duplicate and known-name summaries;
  - active same-name saved/pending summaries are not placeholder-empty when matching state exists;
  - stable snapshots for deterministic ordering.
- `interpretedAgent.test.ts`
  - passes conversation/domain state into interpreter before route selection;
  - stale-prompt complaint with active pending + known memory routes to `explain_agent_state` or `conversation_repair`;
  - direct context answer still routes to `answer_pending_contact_prompt`.
- eval runner
  - add at least one model-router fixture assertion that state-aware routing beats pending-context capture for stale-prompt complaints.

Verification commands:

```bash
npm test -- src/relationship/openRouterInterpreter.test.ts src/relationship/routerInputEnvelope.test.ts src/relationship/interpretedAgent.test.ts
npm run build
npm run eval:agent
git diff --check
```

## Boundaries

- Always: build the envelope through a dedicated typed builder; cap arrays and text lengths; validate the OpenRouter response with the existing schema path; keep deterministic tools as the only mutation path.
- Ask first: adding a new persistence table, adding a new model provider, or expanding the envelope to include raw transcript history.
- Never: send phone numbers, emails, raw Apple Contacts payloads, unbounded message history, secrets, or live Spectrum credentials to OpenRouter.

## Success Criteria

- OpenRouter receives a compact routing envelope as the user content.
- The envelope includes active pending workflow state when present.
- The envelope includes domain summaries for pending candidates, duplicates, and known people names where available.
- The active same-name pending/saved conflict is represented in `possibleDuplicates` and `knownPeopleNamed`.
- The envelope never includes phone numbers, emails, raw contact payloads, or unbounded message history.
- `explain_agent_state` and `conversation_repair` route correctly for stale-prompt/meta complaints even when a pending candidate is active.
- Direct context answers still confirm pending candidates.
- Strict mode still fails loudly on missing API key, model failure, invalid schema, and fallback use.
- Test/local fixture fallback accepts the new input object without being used by production strict mode.
- Existing PR 3 route-policy behavior remains intact.

## Implementation Notes Requirement

While implementing this spec, keep `implementation-notes.html` updated with:

- any envelope fields cut or deferred;
- privacy redaction decisions;
- changes to interpreter interface shape;
- test cases where state changed the selected route;
- any tradeoff between deterministic fast paths and model routing.

## Implementation Defaults

These are intentionally decided for PR 4 to keep the implementation bounded:

1. `possibleDuplicates` should be a cheap bounded summary for names connected to the active workflow and current user text, not a full repo-wide duplicate scan every turn.
2. Recent agent messages should come from whichever context is already available in `interpretedAgent`; do not add a new persistence table.
3. `lastListResultIds` should use current conversation/session state only. It does not need to persist across process restarts.
