# Friendy Regression Freeze Design

## Summary

Add regression coverage for the current live Friendy agent failures before making more routing or architecture changes. This spec is tests-only. It freezes the expected behavior for duplicate people, stale pending prompts, list formatting, conversation repair, fuzzy delete requests, and same-name pending contact ambiguity.

The goal is to make future implementation work fail loudly when Friendy regresses into generic fallback, stale pending reminders, broad search fallback, or accidental confirmation of the wrong candidate.

## Scope

This spec adds failing tests and eval cases only. It should not change runtime behavior, routing, tools, repository logic, Apple Contacts behavior, retrieval, or response composition.

The implementation task for this spec is complete when the failing tests are committed and clearly document the current gaps. The tests may remain failing until the follow-up implementation goal fixes the behavior.

## Non-Goals

- Do not implement duplicate detection yet.
- Do not implement `find_duplicate_people` yet.
- Do not implement fuzzy delete matching yet.
- Do not change pending-candidate resolution yet.
- Do not change response composition yet.
- Do not change list/search routing behavior yet.
- Do not add Apple Contacts create/edit/delete mutation.
- Do not add embeddings, FTS, reranking, or retrieval architecture changes.
- Do not weaken lifecycle, consent, update/delete, or unsafe-request guardrails.

## Regression Fixture State

Tests should create a realistic state matching the live logs:

- Confirmed memories include people related to testing Friendy.
- A confirmed `Testing 3` memory already exists.
- A pending contact candidate named `Testing 3` may also exist.
- A saved `Unnamed Contact` memory exists.
- At least one duplicate display-name situation exists, such as multiple `Testing 1` or `Testing 3` records.
- The agent may have a pending contact frame/reminder, but list/delete/repair requests must not blindly append stale reminders.

The fixture should be built through existing repository helpers and agent/eval utilities where possible. Avoid direct private DB mutation unless no public helper exists.

## Required Regression Cases

### Case 1: Filtered Bullet List Does Not Become Broad Search

User:

```text
List me in bullet of all people I met testing friendy
```

Expected route:

```json
{
  "domain": "relationship_memory",
  "intent": "list_people",
  "conversationRelation": "starts_new_relationship_task",
  "search": {
    "mode": "list_people",
    "semanticQuery": "people I met testing Friendy",
    "exactTerms": ["testing", "friendy"]
  }
}
```

Expected tool behavior:

- Calls a list/list-filter path, represented as `list_people` if that tool exists.
- Does not silently fall back to broad `search_memories` because the query contains "people".
- Does not return every saved person unless every returned person actually matches the testing Friendy clue.
- Does not append stale text such as `I still need context for Testing 3` when the pending reminder is unrelated or already satisfied.
- Respects the requested bullet/list formatting in the final response.

Assertions:

- Route intent is `list_people` or the closest explicit list intent.
- Tool call is `list_people` or equivalent explicit list/filter tool.
- `search_memories` is not used as a silent fallback.
- Response contains bullet/list formatting.
- Response excludes unrelated saved people.
- Response does not include stale pending context reminders.

### Case 2: Duplicate Audit Is In Scope

User:

```text
Do you see you are having duplicate people in your contacts?
```

Expected route:

```json
{
  "domain": "relationship_memory",
  "intent": "duplicate_audit",
  "conversationRelation": "starts_new_relationship_task"
}
```

Expected tool behavior:

- Calls `find_duplicate_people` or an equivalent duplicate-audit tool once that tool exists.
- Does not route to `out_of_scope`.
- Does not answer from the router without tool grounding.

Assertions:

- Scope/domain is relationship-memory related.
- Intent is `duplicate_audit` or `identity_duplicate_audit`.
- Expected tool is `find_duplicate_people`.
- Generic out-of-scope fallback is not used.

### Case 3: Conversation Repair Explains Pending Versus Saved Ambiguity

User:

```text
Why u still asking for testing 3 context when u already have it?
```

Expected route:

```json
{
  "domain": "relationship_memory",
  "intent": "explain_agent_state",
  "conversationRelation": "asks_about_open_workflow",
  "target": {
    "displayName": "Testing 3"
  }
}
```

Expected response behavior:

- Explains the exact state conflict in user-friendly language.
- Distinguishes saved memory from a pending contact candidate with the same or similar display name.
- Does not route to out-of-scope.
- Does not invent facts about Testing 3.
- Does not mutate memory or confirm/delete candidates.

Example acceptable response shape:

```text
I have a saved memory for Testing 3, but I also still see a pending Testing 3 contact prompt. I need to know whether that pending contact is the same person or a duplicate before I close it.
```

Assertions:

- Intent is `explain_agent_state` or `conversation_repair`.
- No memory mutation tools are called.
- Response mentions pending candidate and saved memory ambiguity.
- Generic fallback is not used.

### Case 4: Fuzzy Delete Request Asks Confirmation

User:

```text
Can you help me delete Unamed Contact from your memory?
```

Expected route:

```json
{
  "domain": "relationship_memory",
  "intent": "delete_memory_request",
  "conversationRelation": "starts_new_relationship_task",
  "target": {
    "displayName": "Unnamed Contact"
  }
}
```

Expected tool behavior:

- Fuzzy lookup maps `Unamed Contact` to `Unnamed Contact`.
- Does not delete immediately.
- Asks for explicit confirmation before deleting.
- Does not append stale pending reminders.
- Does not attempt Apple Contacts deletion.

Assertions:

- Intent is delete-memory related.
- Matched target is `Unnamed Contact`.
- Response asks for confirmation.
- `delete_memory` is not called until the user confirms.
- No stale pending reminder is appended.

### Case 5: Same-Name Pending Contact Requires Identity Clarification

User:

```text
I met during testing Friendy
```

State:

- An active pending contact candidate exists.
- A saved memory with the same display name as the active candidate already exists.

Expected route:

```json
{
  "domain": "relationship_memory",
  "intent": "capture_pending_contact_context",
  "conversationRelation": "answers_open_workflow",
  "extractedContext": "met during testing Friendy"
}
```

Expected policy behavior:

- If the active workflow points to a unique pending candidate and no same-name saved person exists, confirm that candidate.
- If a same-display-name saved person already exists, ask whether this is the same person or a different person before confirming.
- Do not attach the context to the wrong pending candidate.
- Do not save another duplicate memory silently.

Assertions:

- Active frame/candidate id is respected.
- Same-name saved memory triggers same/different clarification.
- `confirm_candidate` is not called until identity is resolved.
- Response names the ambiguity specifically.

## Trace Assertions

Each regression case should assert the strict trace envelope fields added by the strict-mode goal:

```ts
type ExpectedTraceAssertions = {
  strictMode: boolean;
  routeSource: "llm" | "deterministic" | "fallback";
  fallbackUsed: false;
  routeIntent: string;
  policyDecision: "allow" | "clarify" | "reject" | "unsupported";
  toolCalls: string[];
};
```

Tests should fail if:

- `fallbackUsed` is true;
- route intent is `unknown` for a supported relationship-memory request;
- the user-facing response is generic fallback copy;
- a stale pending reminder is appended to list, delete, or repair responses;
- a mutation tool runs before required identity/delete confirmation.

## Suggested Test Locations

Prefer adding coverage in the existing relationship-agent eval surface first, because these are conversation-level behavior failures:

- `src/relationship/evals/agentEvalRunner.test.ts`
- `src/relationship/evals/agentEvalRunner.ts`
- `src/relationship/interpretedAgent.test.ts` for lower-level route/tool assertions when needed.

If a route or tool does not exist yet, encode the expected future contract in a failing test with a clear name. The failure should say what is missing, not hide behind broad assertion text.

Suggested case names:

- `duplicate-pending-filtered-list-regression`
- `duplicate-audit-in-scope-regression`
- `conversation-repair-pending-vs-saved-regression`
- `fuzzy-delete-memory-confirmation-regression`
- `same-name-pending-contact-disambiguation-regression`

## Acceptance Criteria

- The spec is implemented as tests/evals only.
- The tests reproduce the exact live failure classes from the logs.
- The tests assert route, tool, trace, and response-shape expectations.
- The tests do not implement new behavior.
- The tests make it clear which follow-up implementation work is required.
- Existing passing behavior is not changed as part of this regression-freeze task.

## Follow-Up Implementation Work

After these tests exist, a separate implementation goal should fix the failures by adding:

- explicit list/filter tool routing;
- duplicate identity audit routing and tool support;
- conversation repair/state explanation routing;
- fuzzy memory lookup for delete confirmation;
- same-name pending candidate disambiguation;
- stale pending reminder suppression for unrelated list/delete/repair responses.
