# Goal: Bi-Directional Apple Contacts Integration

Read the Friendy repo and implement native Apple Contacts support for reads and writes, with strict confirmation and context injection into the relationship-agent envelope.

## Objective

Enable Friendy to read and write Apple Contacts natively (while keeping Memory as a separate source), and inject official Apple Contact details into prompts before asking follow-up questions.

Expected final state:
The goal after this is that Friendy will be able to interact directly with contacts, not just the memory store. When a contact is already in Apple Contacts, Friendy should know the existing details before asking the user for missing information.

## Why This Matters

Friendy currently relies on user-provided context for contacts that already exist in macOS Contacts. This goal reduces redundant prompting, prevents accidental data drift, and makes relationship workflows use the same source of truth already maintained on device.

## Non-Negotiables

- Use TDD for behavior changes.
- Keep changes incremental and commit-ready in focused slices.
- Use a native Swift actuator with `Contacts` APIs (`CNContactStore`, `CNSaveRequest`), no AppleScript.
- Strict separation: Friendy Memory (SQLite/Memory DB) and Apple Contacts (macOS) remain independent.
- Identity-first: use `CNContact.identifier` for Apple Contacts and Friendy internal UUIDs for Memory.
- Never mutate Apple Contacts without explicit user confirmation.
- Keep implementation incremental, measurable, and aligned to Friendy goal tracking files.
- Keep `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, `docs/goals/EXPERIMENT_NOTES.md`, and `implementation-notes.html` updated.
- Keep `docs/agent-handoff.md` and `REFERENCE.md` consistent when the goal materially changes scope.
- Use `implementation-notes.html` for any implementation tradeoffs and assumptions.

## Phase 1: Swift Native Actuator (macOS)

Upgrade the Swift sensor to handle JSON commands via `stdin` or local HTTP.

1. Accept JSON command envelopes with `action` (`READ`, `CREATE`, `UPDATE`, `DELETE`).
2. **READ**: Use `CNContactFetchRequest`. Return a full JSON dump of the contact (names, organization, phones, emails, postal addresses, notes).
3. **CREATE**: Map JSON to `CNMutableContact`, save via `CNSaveRequest`, return the new `identifier`.
4. **UPDATE**: Fetch `CNContact` by ID, create `mutableCopy()`, apply JSON patch fields, and save.
5. **DELETE**: Fetch `CNContact` by ID, pass to `CNSaveRequest` delete method.
6. Ensure the macOS Contacts permission prompt is triggered on first run.

## Phase 2: Node.js Bridge & LLM Tools

Build the TypeScript adapter and expose tools to the LLM.

1. Create `src/relationship/contacts/macContactsAdapter.ts`.
2. Implement wrappers (`getAppleContact`, `createAppleContact`, `updateAppleContact`, `deleteAppleContact`) that spawn the Swift process, pass JSON commands, and parse results.
3. Add four tools to `src/relationship/tools.ts`:
   - `read_apple_contact(id | query)`
   - `add_apple_contact(fields)`
   - `update_apple_contact(id, patch)`
   - `delete_apple_contact(id)`
4. Update `openAIInterpreter.ts` system prompt to describe tools and require confirmation before mutation.

## Required Behavior

- Friendy can read Apple Contact records by identifier or query.
- Friendy can create Apple Contacts when user confirms.
- Friendy can update Apple Contacts when user confirms.
- Friendy can delete Apple Contacts when user confirms.
- Friendy surfaces Apple Contact metadata in prompt context for linked persons.
- No Apple Contact writes occur without explicit confirmation.

## Phase 3: Deep Context Sync

Friendy receives Apple context before asking follow-up questions.

1. Update the routing preparation step in `interpretedAgent.ts`.
2. When a user message is about a person, check whether the `personId` is linked to an Apple Contact `identifier`.
3. If linked, call `getAppleContact` and inject Apple metadata (job title, emails, notes, etc.) into `routerInputEnvelope`.
4. The LLM should use both Memory and Apple Contact context and skip questions for fields already present.

## Phase 4: Intent Parsing & Asynchronous Confirmation

Implement a confirmation state machine to prevent unauthorized mutations.

1. Update `interpretation.ts` with:
   - `request_apple_contact_create`
   - `request_apple_contact_update`
   - `request_apple_contact_delete`
2. When the router detects a mutation intent, do **not** execute the tool.
3. Write pending state to `conversation_sessions` (e.g., `activeWorkflow: "PENDING_APPLE_CONTACT_CREATE"` with `workflowPayload`).
4. Return a confirmation reply: `I can add Anna to your Apple Contacts with the number 415-555-1234. Reply "yes" to save.`
5. Add a routing interceptor: if active workflow is pending Apple Contact create/update/delete and user replies `yes`, execute the mutation and clear workflow state.
6. If confirmation is not explicit, do not mutate Apple Contacts.

## Required Files

- `swift/FriendyMacOSSensor/Sources/FriendyMacOSSensor/`
- `src/relationship/contacts/macContactsAdapter.ts`
- `src/relationship/tools.ts`
- `src/relationship/interpretation.ts`
- `src/relationship/openAIInterpreter.ts`
- `src/relationship/interpretedAgent.ts`
- `src/relationship/trace.ts`
- `src/relationship/conversationSession.ts`
- `src/relationship/conversationSessionStore.ts`
- `src/relationship/routerInputEnvelope.ts`
- `docs/goals/PLAN.md`
- `docs/goals/EXPERIMENTS.md`
- `docs/goals/EXPERIMENT_NOTES.md`
- `implementation-notes.html`
- `docs/agent-handoff.md`

## Test Cases

- Creation confirmation gate:
  - User asks to add a person contact.
  - Friendy returns confirmation text only.
  - No Apple Contact write before `yes`.
- Confirmed create:
  - User replies `yes`.
  - Swift actuator creates contact and returns identifier.
- Confirmed update/delete:
  - User confirms intent and replies `yes`.
  - Apple Contact update/delete executes and workflow clears.
- Context injection:
  - User asks about a person linked to Apple Contact.
  - Router envelope includes Apple metadata and prevents duplicate data prompts.
- Safety:
  - Missing/ambiguous IDs never trigger writes.
  - Mutation never uses display-name matching.

## Verification Commands

- `npm run test`
- `npm run build`
- `npm run eval:agent` (if available)
- Manual checks:
  - Mutation only after explicit `yes`.
  - `conversation_sessions` pending state persists and clears correctly.
  - Apple metadata appears in prompt context before follow-up questions.

## Completion Criteria

- Apple Contact actuator exists and supports `READ`, `CREATE`, `UPDATE`, `DELETE`.
- LLM tools are available for read/create/update/delete Apple contacts.
- Router can inject linked Apple metadata into the contact context envelope.
- All Apple mutations require explicit confirmation and are blocked otherwise.
- All required docs are updated through the run.
- Relevant tests/build checks pass and are reported.

Keep this outcome sentence as the completion check:

> The goal after this ran is that friendy will be able to interact directly with contact beside just the memory, which means whenever a new contact is saved from user contact Friendy will know all the info in their that user already put in before friendy asking for more info


## Execution Prompt

```text
/goal Read /Users/minhthiennguyen/Desktop/Friendy/docs/goals/apple-contacts-bidirectional-integration-goal.md and execute it exactly, keeping the goal in repo-native tracking (implementation-notes.html, docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md), using TDD for behavior changes and confirming no Apple Contact mutation occurs before explicit user approval.
```
