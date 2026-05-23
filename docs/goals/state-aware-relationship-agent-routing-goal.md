# Goal: State-Aware Relationship Agent Routing

Read the Friendy repo and implement state-aware relationship-agent routing so active workflows, durable conversation state, and route policy determine behavior before brittle text-only scope gates.

## Objective

Make Friendy behave like a focused relationship-memory agent that understands the current conversation state. In particular, pending contact prompts, previous searches, recent saved contacts, manual memory creation, and contact-management requests must be routed by explicit state-aware intent, validated by deterministic policy, and executed through deterministic tools.

## Why This Matters

Friendy is not a general chatbot. Friendy helps the user remember people they know, find people they forgot, reconnect with their network, and manage relationship memory around friends, collaborators, mentors, family, people they met once, and people who may help them reach their goals.

The current agent still has text-only and process-local routing failure modes:

- a pending contact answer like `She is a community lead at Photon Residency II` can be stolen by previous-search follow-up logic;
- natural manual memory creates like `add Sarah Chen as the member of Photon Residency II` can be rejected before interpretation;
- event recall like `Who did I met at the Photon Residency?` can become list-all recall;
- generic fallback copy hides the real state instead of explaining the exact blocker.

## Non-Negotiables

- Use TDD for behavior changes.
- Commit incrementally with `<scope>:<message>`.
- Keep `implementation-notes.html` updated.
- Keep `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, and `docs/goals/EXPERIMENT_NOTES.md` updated.
- Do not commit secrets.
- Do not weaken lifecycle controls, consent boundaries, update/delete rules, unsafe-request rejection, or hallucination guards.
- Do not let the LLM directly write, delete, edit, or mutate anything.
- The model may only classify the latest turn into a validated structured route.
- Deterministic policy/tool code must validate and execute saves, searches, updates, deletes, contact-management requests, and clarifications.
- Do not add embeddings, vector search, multi-agent architecture, or Apple Contacts mutation as part of this goal.
- Apple Contacts create/edit/delete remains post-MVP or behind explicit tools; never write to Apple Contacts silently.
- Friendy memory remains the primary memory system.

## Product Voice

Friendy should be warm and conversational, but never invent facts.

Good examples:

- `Got it - I'll remember Sarah Fan is a community lead at Photon Residency II.`
- `Hmm, I think you mean Sarah. You told me you met her at Photon Residency II and that she's a community lead there.`
- `I found Sarah Fan and Sarah Chen. Which one do you mean?`
- `I can help edit that contact. Which field should I change?`

Avoid vague generic fallback copy such as:

```text
I am here to help with people you know, relationship memory, and follow-ups...
```

Instead Friendy must do one of:

- execute the correct action;
- ask a specific clarification;
- explain the exact blocker;
- show the current state in user-friendly language.

Fallback may exist as an internal trace state, but not as a generic user-facing response for recoverable ambiguity.

## Desired Architecture

Implement or evolve toward this flow:

```text
Inbound user message
-> load durable/reconstructable agent state
-> deterministic hard checks only
-> state-aware structured router
-> deterministic route policy validator
-> deterministic tools
-> grounded response composer
-> persist interaction/state updates
```

Do not route messages using only the latest text. Interpret the latest user message relative to:

- the last Friendy message;
- active pending contact prompt;
- pending contact queue;
- last memory search;
- recently saved contact;
- current user goal when represented in state;
- recent messages in this thread.

Keep the existing repository/runtime split. Do not build domain state from scratch.

## Routing Priority

When a pending contact prompt is open, the active prompt is the strongest context.

Route priority must be:

1. `start` / `pause` / `resume` lifecycle commands.
2. Explicit ignore / delete / unsafe / adversarial hard blocks.
3. Pending contact inquiry:
   - `who are you asking?`
   - `which person?`
   - `Testing 1 or Testing 2?`
4. Pending contact answer/context:
   - `she is...`
   - `he works at...`
   - `met at...`
   - `Sarah is...`
   - any useful relationship context.
5. Clear relationship recall/search/list.
6. Manual memory create/update.
7. Contact management create/edit/delete, with confirmation when needed.
8. Specific clarification.
9. Out-of-scope only when truly outside Friendy's purpose.

Follow-up search must not preempt a pending contact answer.

## Pending Contact Context Rule

When Friendy asks:

```text
I noticed you added Sarah Fan. Where did you meet them?
```

the literal wording is only friendly copy. Internally the expected input is:

```text
any useful relationship context about this person
```

Valid answers include:

- `She is a community lead at Photon Residency II.`
- `Met her through Photon.`
- `Need to follow up with her about community dinners.`
- `She knows Alex.`
- `She's also 2k5 like me.`
- `We talked about Friendy.`

If the pending contact target is unambiguous and the text is plausible relationship context, save directly.

## State Architecture

Friendy already has useful durable state:

- relationship memories;
- contact candidates;
- candidate lifecycle statuses: pending, prompted, confirmed, ignored, expired;
- prompt attempts;
- agent interactions;
- memory revisions;
- processed sensor events;
- runtime sensor state.

Conversation follow-up context is still process-local/prototype state. Promote conversation context to durable or reconstructable state.

Specifically:

- `conversationContexts` currently live in an in-memory `Map`;
- active event name, active date context, last search, active memory, and recent people can disappear on restart;
- onboarding/start/pause state is also too process-local;
- prompt correlation should be durable whenever a proactive contact prompt is sent.

Add or design durable conversation state, likely SQLite-backed and keyed by `userId + space/channel`, with TTL fields for temporary frames.

Conversation state should represent active frames such as:

```ts
type ConversationFrame =
  | PendingContactContextFrame
  | PendingContactQueueFrame
  | PreviousSearchFrame
  | RecentSavedContactFrame
  | ClarificationFrame
  | DraftingFrame;
```

A pending contact frame should include:

- `frameId`;
- `userId`;
- `spaceId` or channel id;
- `candidateId`;
- `displayName`;
- `openedAt`;
- `lastFriendyPrompt`;
- `expectedInput: "any_useful_relationship_context"`;
- `priority: "high"`;
- `status: "active" | "closed" | "expired"`.

Example active state:

```json
{
  "activeFrame": {
    "type": "pending_contact_context",
    "candidateId": "candidate_sarah",
    "displayName": "Sarah Fan",
    "lastFriendyPrompt": "I noticed you added Sarah Fan. Where did you meet them?",
    "expectedInput": "any_useful_relationship_context"
  },
  "pendingContactQueue": [
    { "candidateId": "candidate_sarah", "displayName": "Sarah Fan", "status": "asked" },
    { "candidateId": "candidate_testing_2", "displayName": "Testing 2", "status": "pending_context" }
  ],
  "lastSearch": {
    "query": "Photon Residency",
    "resultNames": ["Sarah Fan", "Sarah Chen"],
    "expiresAt": "..."
  },
  "recentSavedContact": {
    "displayName": "Sarah Fan",
    "memoryId": "...",
    "savedAt": "..."
  }
}
```

If full durable state is too large for one pass, implement the active pending-contact frame first and write the durable schema/design for the remaining frames.

## State-Aware Route Shape

Extend the current interpreter/router instead of creating an unrelated parallel system.

The route should include fields equivalent to:

```ts
type FriendyRoute = {
  domain:
    | "relationship_memory"
    | "relationship_drafting"
    | "contact_management"
    | "lifecycle_control"
    | "general_assistant"
    | "unsafe_or_adversarial";

  intent:
    | "capture_pending_contact_context"
    | "continue_recent_saved_contact"
    | "explain_pending_workflow"
    | "list_people"
    | "search_memory"
    | "manual_memory_create"
    | "update_memory"
    | "delete_memory"
    | "draft_message"
    | "request_contact_create"
    | "request_contact_edit"
    | "request_contact_delete"
    | "ignore_candidate"
    | "clarify"
    | "reject";

  conversationRelation:
    | "answers_open_workflow"
    | "asks_about_open_workflow"
    | "continues_recent_saved_contact"
    | "continues_previous_search"
    | "starts_new_relationship_task"
    | "starts_new_contact_management_task"
    | "starts_new_out_of_scope_task"
    | "unclear";

  target?: {
    frameId?: string;
    candidateId?: string;
    memoryId?: string;
    displayName?: string;
  };

  extractedContext?: string;

  search?: {
    mode:
      | "list_people"
      | "lookup_person"
      | "list_related_people"
      | "event_recall"
      | "semantic_recall";
    semanticQuery: string;
    exactTerms: string[];
    filters?: {
      personName?: string;
      eventName?: string;
      topic?: string;
      companyOrSchool?: string;
      dateText?: string;
      tags?: string[];
    };
    topK?: number;
  };

  requestedContactChange?: {
    operation:
      | "create_contact"
      | "update_name"
      | "add_phone"
      | "add_email"
      | "update_company"
      | "delete_contact";
    targetPersonName?: string;
    field?: string;
    newValue?: string;
    requiresUserConfirmation: boolean;
  };

  confidence: number;
  clarificationQuestion?: string;
  traceReason: string;
};
```

The exact TypeScript names can follow the existing codebase, but traces must expose equivalent route domain, intent, conversation relation, policy decision, target, and tool calls.

## Router Rules

The state-aware router must follow these rules:

1. If there is an active pending-contact context frame, treat any plausible note about that person as context for that contact.
2. Context can be anything useful about the person or the user's relationship to the person. It does not need to answer the literal phrase `where did you meet them?`.
3. Pronouns like `she`, `he`, `they`, `her`, `him`, and `them` should usually refer to the active pending contact when one exists.
4. If the user asks who Friendy is asking about, route to `explain_pending_workflow`.
5. If multiple contacts are pending, Friendy should know which one is active and which ones are queued next.
6. If the user asks a clear list/search question while a contact is pending, route to list/search memory and keep the pending contact open.
7. If the user says `also`, `and`, `forgot to add`, or gives a natural continuation shortly after saving a person, route to `continue_recent_saved_contact` when plausible.
8. If the user asks `Who did I meet at X?`, route to `search_memory` with mode `event_recall`, not `list_people`.
9. If the user asks `What people do I know so far?` or `Give me all people in my contacts so far`, route to `list_people`.
10. Do not treat list/search requests as context for an unnamed contact.
11. If the user says `add/save/remember [Person] as/is/from/at [context]`, route to `manual_memory_create`, unless an active pending candidate makes a different target clearly more likely.
12. If the message is logically incompatible with the active frame and is not a clear new relationship task, ask a specific clarification.
13. Never invent names, facts, contact info, or relationship context.
14. The model proposes a route only. Deterministic code validates and executes tools.

## Policy Validator

After routing, deterministic code must validate:

- Does the candidate id exist?
- Is it pending for this user and space?
- Is the target unambiguous?
- Is the context non-empty and plausible?
- Is the route allowed while the current frame is active?
- Does contact editing/deleting require explicit confirmation?
- Does memory deletion require explicit forget/delete wording?
- Is the model trying to mutate data without consent?

## Candidate Prompt Invariant

Any proactive candidate prompt sent over iMessage must persist candidate prompted state with:

- `promptInteractionId`;
- `promptSpaceId`;
- `promptedAt`;

before or atomically with send success.

## Required Behavior

Implement the following observable behavior.

### Pending Contact Context

Given an active prompt:

```text
I noticed you added Sarah Fan. Where did you meet them?
```

User:

```text
She is a community lead at Photon Residency II
```

Expected route equivalent:

```json
{
  "intent": "capture_pending_contact_context",
  "conversationRelation": "answers_open_workflow",
  "target": { "displayName": "Sarah Fan" },
  "extractedContext": "community lead at Photon Residency II"
}
```

Expected response:

```text
Got it - I'll remember Sarah Fan is a community lead at Photon Residency II.
```

The follow-up search handler must not fire.

### Clean Pending Contact Note

Given the same active prompt, user:

```text
Sarah Fan is a community lead at Photon Residency II
```

Expected:

- saves context for Sarah Fan;
- stored/user-facing context is clean, not `is a community lead...`;
- response is equivalent to `Got it - I'll remember Sarah Fan is a community lead at Photon Residency II.`

### Event Recall

User:

```text
Who did I met at the Photon Residency?
```

Expected route equivalent:

```json
{
  "intent": "search_memory",
  "search": {
    "mode": "event_recall",
    "semanticQuery": "people met at Photon Residency",
    "exactTerms": ["Photon", "Residency"]
  }
}
```

Expected:

- return people whose saved context/event/tags mention Photon Residency;
- do not list all people unless every listed person actually matches.

### Manual Memory Create

User:

```text
add Sarah Chen as the member of Photon Residency II
```

Expected route equivalent:

```json
{
  "intent": "manual_memory_create",
  "domain": "relationship_memory",
  "target": { "displayName": "Sarah Chen" },
  "extractedContext": "member of Photon Residency II"
}
```

Expected response:

```text
Got it - I'll remember Sarah Chen is a member of Photon Residency II.
```

### List People

User:

```text
Just give me all the people in my contact so far
```

Expected:

- route to `list_people`;
- list confirmed saved people;
- never save this sentence as context for `Unnamed Contact`.

### Pending Workflow Explanation

User:

```text
Who are you asking about?
```

Expected with one pending contact:

```text
I'm asking about Sarah Fan - what should I remember about her?
```

Expected with multiple pending contacts:

```text
I'm asking about Sarah Fan first. Testing 2 is next.
```

### Search Interrupts Pending Prompt

If a clear search/list request interrupts a pending contact prompt, answer it, then remind the user of the pending prompt.

Example:

```text
Friendy: I noticed you added Sarah Fan. What should I remember about her?
User: What people do I know so far?
Friendy: So far, I have Testing 1 and Testing 2 saved. I still need context for Sarah Fan - what should I remember about her?
```

## Test Cases

Add failing tests/evals first for all transcript cases:

- active Sarah Fan prompt + `She is a community lead at Photon Residency II` -> confirms Sarah Fan context, no follow-up-search response;
- active Sarah Fan prompt + `Sarah Fan is a community lead at Photon Residency II` -> confirms Sarah Fan with clean context;
- `Who did I met at the Photon Residency?` -> `search_memory` / `event_recall`, returns Photon matches only;
- `add Sarah Chen as the member of Photon Residency II` -> manual memory create, saves Sarah Chen;
- `Just give me all people in my contact so far` -> lists people, does not confirm pending candidate;
- `Who are you asking about?` with one pending contact -> explains active pending contact;
- `Who are you asking about?` with multiple pending contacts -> explains active contact and next queued contact;
- search/list interruption while pending prompt is open -> answers search/list and reminds about pending contact;
- unsafe/general requests still rejected or blocked specifically;
- existing update/delete/lifecycle tests still pass.

## Suggested Work Order

1. Add failing tests/evals for transcript cases.
2. Fix routing priority so pending contact context beats previous-search follow-up.
3. Add or extend state-aware route fields: domain, intent, conversationRelation, target, search mode, extractedContext.
4. Add context-note cleanup for pending contact confirmations.
5. Fix event recall vs `list_people` routing.
6. Add manual memory create phrasing.
7. Promote conversation context from process-local `Map` to durable or reconstructable SQLite-backed state, or at minimum design the durable schema and implement the active pending-contact frame needed for contact prompts.
8. Replace generic user-facing fallback with specific clarification/blocker responses.

## Verification Commands

Run before completion:

```bash
npm test
npm run build
npm run eval:agent
git diff --check
```

Also run any new targeted test file(s) during TDD red/green cycles.

## Completion Criteria

- All required transcript behaviors above are covered by automated tests or evals.
- `She is a community lead at Photon Residency II` answers the open Sarah Fan prompt.
- Follow-up search never preempts a pending contact answer.
- `Sarah Fan is a community lead...` saves a clean note.
- `Who did I meet at Photon Residency?` searches Photon Residency, not `list_people`.
- `add Sarah Chen as the member of Photon Residency II` is accepted as manual relationship memory creation.
- `Just give me all people in my contact so far` lists people and is never saved as `Unnamed Contact` context.
- Generic fallback is not used for recoverable ambiguity.
- If Friendy is unsure, it asks a concrete clarification.
- Interaction traces show route domain, intent, conversation relation, policy decision, target, and tool calls.
- Existing lifecycle controls, consent boundaries, update/delete rules, and unsafe-request rejections still pass.
- Conversation context is durable/reconstructable at least for active pending-contact frames, and remaining frames have a concrete schema/design if not fully implemented in this goal.
- `implementation-notes.html`, `docs/agent-handoff.md`, and goal tracking files are updated.
- Required verification commands pass with current evidence.
- Changes are committed incrementally.
- `main` is pushed when complete.

## Implementation Progress

- 2026-05-23: Added failing transcript coverage in `src/relationship/interpretedAgent.test.ts` and eval coverage in `src/relationship/evals/agentEvalRunner.ts`.
- 2026-05-23: Implemented reconstructable active pending-contact frames in `src/relationship/conversationState.ts` using durable candidate prompt fields (`promptSpaceId`, `promptedAt`, `promptInteractionId`).
- 2026-05-23: Pending-contact inquiry/context now runs before previous-search follow-up; pronoun facts like `She is...` confirm the active pending contact.
- 2026-05-23: Pending-contact note cleanup strips simple `She is a...` / `Sarah Fan is a...` wrappers before save.
- 2026-05-23: Event recall routing now treats `Who did I meet/met at X?` as `event_recall`, not `list_people`.
- 2026-05-23: Manual `add/save/remember Person as/is/from/at context` creates Friendy memory through deterministic tools and does not mutate Apple Contacts.
- 2026-05-23: Removed the old generic user-facing scope fallback and replaced it with specific blocker copy.
- 2026-05-23: Focused verification passed for interpreted agent, scope boundary, candidate intake, response composer, tools, OpenRouter interpreter, eval runner, runtime trace, behavior contract, and `npm run build`.
- 2026-05-23: Full verification passed: `npm test` 51 files/322 tests, `npm run build`, `npm run eval:agent` 35/35, and `git diff --check`.

## Durable Conversation State Design

The implemented slice reconstructs the active pending-contact frame from durable candidate fields. If/when the remaining frame types move out of the process-local `conversationContexts` map, use one SQLite table rather than separate tables per frame type:

```sql
create table conversation_frames (
  frame_id text primary key,
  user_id text not null,
  space_id text,
  type text not null,
  status text not null,
  priority integer not null default 0,
  opened_at text not null,
  expires_at text,
  payload_json text not null,
  created_at text not null,
  updated_at text not null
);

create index conversation_frames_active_idx
  on conversation_frames (user_id, space_id, status, priority, opened_at);
```

Frame payloads should stay type-specific JSON projections:

- `pending_contact_context`: `candidateId`, `displayName`, `lastFriendyPrompt`, `expectedInput`;
- `pending_contact_queue`: ordered candidate ids and display names;
- `previous_search`: original query, result memory ids, last question, expiry;
- `recent_saved_contact`: display name, memory id, saved timestamp;
- `clarification`: question, expected answer shape, target ids if any;
- `drafting`: target person/memory id and draft intent.

Temporary frames should have TTL-driven `expires_at`; durable relationship memory remains canonical in `memories`, not in frame payloads.
