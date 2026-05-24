# Mac-Only MVP Onboarding And Agent Behavior Design

Status: Finished MVP design
Owner: Friendy
Last updated: 2026-05-22

## 1. Goal

Define the user-visible Mac-only MVP demo path for Friendy, from phone verification through native Mac setup, contact detection, confirmation, recall, correction, and setup failure handling.

The MVP should prove one product bet:

```text
Friendy helps a user recover the right person later from a vague human memory fragment, without saving anyone automatically.
```

The MVP is successful when a user can:

1. Verify their phone number.
2. Set up Friendy on their Mac.
3. Grant Contacts and Calendar access.
4. Add a new contact.
5. Receive a natural prompt from Friendy.
6. Confirm or correct where they met the person.
7. Later ask a vague question like "who was the recruiting agents person?"
8. Get the right person back, with a short explanation and contact route when available.

## 2. Product Principles

Friendy should feel like a helpful texting agent, not a CRM, not a database, and not a surveillance tool.

Core principles:

- Local-first for the Mac-only MVP.
- No automatic saved memories.
- Calendar is only a guess, never truth.
- The user is the source of truth.
- The agent is concise, calm, and conversational.
- Every saved memory should be understandable, correctable, and deletable.
- Setup and runtime failures should be visible and recoverable.
- Friendy should stay scoped to helping the user remember people they have met.

## 3. Scope

### In Scope

This spec covers the Mac-only demo experience:

- Placeholder landing page entry.
- Phone-number login and verification.
- Mac helper setup.
- Contacts and Calendar access.
- First Friendy message to the verified phone number.
- Contact candidate prompts.
- Natural confirmation and correction replies.
- Vague-memory search and follow-up narrowing.
- Saved-memory correction and update flows.
- Agent behavior contract.
- Privacy, consent, and setup failure messaging.
- MVP implementation decisions for the previously open questions.

### Out Of Scope

This spec does not cover:

- iPhone app installation.
- App Store distribution.
- Production account management.
- Full dashboard UX.
- Social profile import.
- Reading iMessage history.
- LinkedIn, X, Instagram, or website scraping.
- Face recognition.
- Automatic memory creation without confirmation.
- General assistant behavior outside relationship memory.

## 4. MVP Implementation Decisions

This section resolves the open questions from the draft.

### 4.1 Phone Verification

Decision:

```text
Use a provider interface with a mock provider as the default MVP path.
```

For the demo, phone verification can be mocked locally with a fixed or console-printed code. The code path should still look like a real provider integration so it can later be backed by Twilio, Verify, or another SMS provider.

Required interface:

```ts
type PhoneVerificationProvider = {
  sendCode(phoneNumber: string): Promise<{ verificationId: string }>;
  verifyCode(verificationId: string, code: string): Promise<{ verified: boolean }>;
};
```

MVP modes:

```text
FRIENDY_PHONE_VERIFICATION_MODE=mock
FRIENDY_PHONE_VERIFICATION_MODE=provider
```

Mock behavior:

- Accepts a configured code such as `123456`.
- Stores only the verified phone number and verification timestamp.
- Does not imply the Mac helper is ready.

### 4.2 Landing Page Ownership

Decision:

```text
The landing page owns phone verification and setup status only.
```

The MVP landing page is not a full dashboard. It only needs to guide the user through:

1. Phone verification.
2. Mac helper setup.
3. Permission readiness.
4. Active or degraded status.

The landing page should not expose full memory management yet. Memory interactions happen in chat for the MVP.

### 4.3 Mac Helper Packaging

Decision:

```text
For the MVP demo, the Mac helper may be an unsigned local helper started by a script or minimal wrapper.
```

The helper can be launched through:

```bash
npm run agent:friendy
```

A packaged `.app`, signed binary, or LaunchAgent is not required for the first demo, but the design should not block those later.

MVP setup copy should avoid pretending that Friendy is production-installed. It can say:

```text
Open Friendy for Mac to connect your Contacts and Calendar.
```

### 4.4 Behavior Contract Artifact

Decision:

```text
Create the behavior contract in three linked forms: Markdown, TypeScript constants, and eval fixtures.
```

Required artifacts:

```text
docs/agent-behavior-contract.md
src/relationship/behaviorContract.ts
src/relationship/__tests__/behaviorContract.test.ts
src/relationship/evals/behavior-contract-cases.ts
```

The Markdown artifact is human-readable product truth.

The TypeScript constants provide implementation truth for prompts, response composer rules, and deterministic guards.

The eval fixtures prove the behavior does not regress.

### 4.5 Saved-Memory Updates

Decision:

```text
Represent saved-memory updates as append-only revisions plus a current projection.
```

A memory should keep a stable `memoryId`. Updates create `MemoryRevision` records and update the current memory projection.

Reason:

- The user can correct mistakes.
- Friendy can explain what changed.
- Evals can verify that corrections overwrite old context.
- Future UI can show history if needed.

### 4.6 Follow-Up Search Context Lifetime

Decision:

```text
Keep follow-up search context for 15 minutes, or until a new unrelated task starts.
```

Follow-up context should also end when:

- The user says `nevermind`, `new search`, `start over`, or similar.
- A candidate-confirmation flow begins.
- A saved-memory update flow begins for a different person.
- The active conversation target changes unambiguously.

## 5. System Shape

The MVP has five visible or semi-visible pieces:

```text
Landing page
  -> phone verification
  -> setup status

Mac helper
  -> Contacts permission
  -> Calendar permission
  -> contact/calendar sensor
  -> local state

Friendy runtime
  -> candidate intake
  -> prompt planner
  -> message sender
  -> inbound reply handler
  -> memory tools

Chat channel
  -> first ready message
  -> candidate prompts
  -> confirmation/correction/search/update flows

Local repository
  -> verified phone
  -> helper state
  -> permission state
  -> pending candidates
  -> saved memories
  -> memory revisions
  -> search context
  -> traces
```

Data should remain local by default except for the minimum required to message the verified phone number and run the selected LLM interpreter when enabled.

## 6. User Journey

### Step 1: Landing Page To Phone Verification

The landing page can be simple. Its primary action is:

```text
Log in with phone number
```

The user enters a phone number, receives or sees a verification code, enters the code, and reaches a verified state.

Phone verification means:

```text
Friendy knows where to message the user.
```

Phone verification does not mean Friendy is fully ready. Friendy still needs the Mac helper and local permissions before it can notice contacts.

#### Landing Page Copy

Hero:

```text
Remember the people you meet.
```

Subcopy:

```text
Friendy notices new contacts on your Mac, asks where you met them, and helps you recall them later from vague clues.
```

Privacy line:

```text
Friendy does not read your iMessages, scrape social profiles, or save people automatically.
```

Primary CTA:

```text
Log in with phone number
```

#### Phone Entry Screen

Title:

```text
Where should Friendy text you?
```

Body:

```text
Friendy uses your verified phone number to send setup messages, contact prompts, and memory replies.
```

CTA:

```text
Send code
```

#### Code Verification Screen

Title:

```text
Enter your code
```

Body:

```text
Enter the 6-digit code to continue setting up Friendy for Mac.
```

CTA:

```text
Verify
```

Success state:

```text
Phone verified. Now set up Friendy for Mac so it can notice new contacts locally.
```

### Step 2: Mac-Only Helper Setup

After phone verification, the user sees a setup screen:

```text
Set up Friendy for Mac
```

The user downloads, opens, or starts the Friendy Mac helper. For the MVP demo, no iPhone app is required.

Demo assumption:

```text
The user adds contacts/calendar events on the same Mac, or their Contacts and Calendar sync to the Mac.
```

macOS asks for Contacts and Calendar access. The user grants access so Friendy can notice new contacts and use Calendar only to guess where the user met them.

#### Setup Screen Copy

Title:

```text
Set up Friendy for Mac
```

Body:

```text
Friendy runs on your Mac so it can notice new contacts locally. It uses Calendar only to guess where you may have met someone, and it always asks before saving.
```

Primary CTA:

```text
Open Friendy for Mac
```

Secondary note:

```text
No iPhone app is needed for this demo.
```

Permission checklist:

```text
Contacts: required to notice new contacts
Calendar: optional but recommended to guess where you met someone
Mac helper: required for contact memory
```

### Step 3: First Ready Conversation

After Mac setup succeeds, Friendy sends the first message to the verified phone number.

First message:

```text
Hi, I'm Friendy. I help you remember people you meet.

I notice new contacts on your Mac, use Calendar only to guess where you met them, and always ask before saving someone.

Want me to start?
```

If the user replies yes:

```text
Great. Friendy is on. Add a new contact on your Mac, and I'll ask before saving anything.
```

If the user replies no:

```text
No problem. I won't start contact memory yet. Reply "start" when you want to turn it on.
```

If the user asks what Friendy does:

```text
I help you remember people you've met. When you add a new contact, I can ask where you met them, save only after you confirm, and later help you find them from vague clues.
```

### Step 4: New Contact Detection

When the user adds a new contact, Friendy creates a pending candidate, not a saved memory.

Friendy should deduplicate signals before prompting. For example, if Contacts sync emits several updates for the same person, Friendy should create one pending candidate and avoid repeated prompts.

If Calendar has a strong event match:

```text
I noticed you added Maya during Photon Residency Dinner. Did you meet them there?
```

If Calendar has a weak event match:

```text
I noticed you added Maya. Was this from Photon Residency Dinner, or somewhere else?
```

If Calendar has no useful event match:

```text
I noticed you added Maya. Where did you meet them?
```

If the contact has no usable display name:

```text
I noticed you added a new contact ending in 4567. Where did you meet them?
```

Calendar context is helpful but not required. Friendy must still work when no event is present.

### Step 5: Confirmation Or User Correction

The user can confirm naturally:

```text
Yeah, that's her. She was building recruiting agents and played piano after dinner.
```

Friendy replies:

```text
Got it, saved Maya from Photon Residency Dinner. I'll remember she was building recruiting agents and played piano after dinner.
```

If Friendy guessed the wrong event, the user can correct it:

```text
Not at dinner actually. I met her at the coffee shop afterward. She works on recruiting agents.
```

Friendy trusts the correction:

```text
Got it, saved Maya from the coffee shop afterward. I'll remember she works on recruiting agents.
```

Rule:

```text
Calendar guess is only a suggestion. User correction is the source of truth.
```

If the user says only:

```text
yes
```

Friendy may save the event guess only if exactly one pending candidate is active and the candidate prompt had a specific event guess.

If the candidate prompt had no event guess, Friendy should ask for more context:

```text
Got it. Where did you meet Maya?
```

If multiple candidates are active, Friendy should ask which person the user meant:

```text
Which one did you mean - Maya or Priya?
```

### Step 6: Later Search By Vague Memory

The user can later ask by context instead of name:

```text
Who was the person building recruiting agents?
```

Friendy returns the likely person, why it matched, and contact route if available and appropriate:

```text
That was Maya. You met her at Photon Residency Dinner, and you told me she was building recruiting agents and played piano after dinner. You have her number ending in 4567.
```

If contact route is unavailable:

```text
That was Maya. You met her at Photon Residency Dinner, and you told me she was building recruiting agents and played piano after dinner.
```

If Friendy has no confident match:

```text
I don't have a clear match yet. Do you remember where you met them or anything else about them?
```

### Step 7: Ambiguity And Follow-Up Narrowing

If multiple people match, Friendy should show the top two or three and ask which one:

```text
I found a few possible matches:

Maya, from Photon Residency Dinner. You told me she was building recruiting agents.
Priya, from the coffee shop afterward. You told me she worked on recruiting automation.

Which one did you mean?
```

Follow-up clues should narrow the previous search, not start a totally new search.

User:

```text
The one who played piano.
```

Friendy:

```text
That was Maya. You met her at Photon Residency Dinner. You told me she played piano after dinner, and you have her number ending in 4567.
```

If the new clue still leaves multiple matches:

```text
I still have a couple possible matches. Was this from Photon Residency Dinner or the coffee shop afterward?
```

Friendy should ask at most one clarifying question at a time.

### Step 8: Correcting Or Updating Saved Memory

The user can correct a saved memory:

```text
Actually, Maya was working on hiring workflows, not recruiting agents.
```

If the correction clearly refers to the active person from recent conversation, Friendy updates that memory:

```text
Got it, updated Maya. I'll remember she was working on hiring workflows.
```

If unclear who the correction refers to:

```text
Who should I update - Maya or Priya?
```

If the user corrects the meeting context:

```text
Actually I met Maya at the afterparty, not dinner.
```

Friendy:

```text
Got it, updated Maya. I'll remember you met her at the afterparty, not dinner.
```

If the user wants to add a note:

```text
Also remember Maya is interested in evaluation tools.
```

Friendy:

```text
Got it, added that Maya is interested in evaluation tools.
```

If Friendy cannot identify the target:

```text
Who should I add that to?
```

### Step 9: Ignore, Pause, Resume, Delete

These controls are part of the MVP because they make consent visible.

Ignore a candidate:

```text
User: ignore Maya
Friendy: Got it. I won't save Maya.
```

Pause contact memory:

```text
User: pause Friendy
Friendy: Contact memory is paused. I won't prompt you about new contacts until you reply "resume".
```

Resume contact memory:

```text
User: resume
Friendy: Friendy is back on. I'll ask before saving any new contact memories.
```

Delete a saved memory:

```text
User: forget Maya
Friendy: Got it, deleted the saved memory for Maya.
```

If delete target is ambiguous:

```text
Which Maya should I forget - Maya from Photon Residency Dinner or Maya from the coffee shop?
```

## 7. Onboarding State Machine

Friendy onboarding should be represented as explicit states, not inferred only from UI or chat copy.

### States

```ts
type OnboardingState =
  | "unverified"
  | "verification_sent"
  | "phone_verified"
  | "mac_helper_not_connected"
  | "mac_helper_connected"
  | "permissions_pending"
  | "ready_pending_user_start"
  | "active"
  | "paused"
  | "degraded_contacts_missing"
  | "degraded_calendar_missing"
  | "helper_disconnected";
```

### Required Transitions

```text
unverified
  -> verification_sent
  -> phone_verified
  -> mac_helper_not_connected
  -> mac_helper_connected
  -> permissions_pending
  -> ready_pending_user_start
  -> active
```

Degraded transitions:

```text
active -> degraded_calendar_missing
active -> degraded_contacts_missing
active -> helper_disconnected
active -> paused
paused -> active
helper_disconnected -> active
```

### State Meanings

`unverified`:

- User has not verified phone number.
- No messages should be sent.

`phone_verified`:

- Friendy has a verified number.
- Friendy may send setup status messages.
- Friendy cannot detect contacts yet.

`mac_helper_connected`:

- Helper is reachable.
- Permission state may still be incomplete.

`ready_pending_user_start`:

- Helper and required permissions are ready.
- Friendy has sent the first hello message.
- Contact memory starts only after the user says yes/start.

`active`:

- Contact detection and prompting are enabled.
- No memory is saved without confirmation.

`paused`:

- Friendy does not prompt on new contact candidates.
- It may still answer searches over already saved memories.

`degraded_calendar_missing`:

- Contacts still work.
- Calendar event guesses do not work.

`degraded_contacts_missing`:

- Contact detection is blocked.
- Existing saved-memory search still works.

`helper_disconnected`:

- Contact detection is paused.
- Existing saved-memory search may still work if the messaging runtime is connected.

## 8. Candidate Lifecycle

A contact detection signal becomes a candidate before it can become a memory.

### Candidate States

```ts
type CandidateState =
  | "detected"
  | "deduped"
  | "prompt_pending"
  | "prompt_sent"
  | "awaiting_user"
  | "needs_clarification"
  | "confirmed"
  | "ignored"
  | "expired"
  | "send_failed";
```

### Lifecycle

```text
contact signal
  -> detected
  -> dedupe against recent candidates
  -> event guess scoring
  -> prompt_pending
  -> prompt_sent
  -> awaiting_user
  -> confirmed | ignored | needs_clarification | expired
```

### Candidate Creation Rules

Friendy creates a candidate when:

- A new contact appears.
- A previously blank contact gains a usable name, phone, or email.
- A contact that was recently added gains enough information to identify it.

Friendy should not create a new candidate when:

- A saved contact is edited long after creation.
- A synced contact receives metadata-only changes.
- A contact is imported in bulk and the event context is unreliable.
- A contact already produced an active candidate recently.

### Time Fields

Candidate time semantics should be explicit:

```ts
type CandidateTiming = {
  contactCreatedAt?: string;
  contactUpdatedAt?: string;
  observedAt: string;
  eventMatchAnchorAt: string;
  promptedAt?: string;
  confirmedAt?: string;
};
```

`observedAt` is when Friendy noticed the signal.

`contactUpdatedAt` is the timestamp from Contacts.

`eventMatchAnchorAt` is the time used to find a Calendar event. For the MVP, default it to `observedAt` unless the sensor has a more accurate created-at time.

### Event Guess Confidence

Friendy should classify Calendar guesses as:

```ts
type EventGuessStrength = "strong" | "weak" | "none";
```

Strong guess:

- Event overlaps the candidate anchor time or ended recently.
- Event has a human/social/work context.
- No competing event has similar score.

Weak guess:

- Event is nearby but does not clearly overlap.
- Multiple plausible events exist.
- Event title/location is generic.

None:

- No event in the time window.
- All events are private/system/non-human context.
- Calendar permission missing.

Prompt behavior:

```text
strong -> ask "Did you meet them there?"
weak -> ask "Was this from X, or somewhere else?"
none -> ask "Where did you meet them?"
```

## 9. Confirmation Target Policy

This policy must be deterministic and tested.

### Rule 1: Never Confirm From Contact Detection Alone

A candidate is not a memory until the user confirms or gives meeting context.

### Rule 2: Bare Confirmation Requires Exactly One Active Candidate

A reply like `yes`, `yeah`, `that's her`, or `correct` can confirm only when:

- Exactly one candidate is awaiting a reply in the active chat scope.
- The candidate prompt was sent recently.
- The candidate has either a strong event guess or the user reply adds enough context.

If there are multiple active candidates:

```text
Which one did you mean - Maya or Priya?
```

If there is no active candidate:

```text
Who should I save that for?
```

### Rule 3: User Correction Overrides Calendar

If the user says the guessed event is wrong, the saved memory uses the user-provided context.

Example:

```text
Prompt: I noticed you added Maya during Photon Residency Dinner. Did you meet them there?
User: No, coffee after.
Saved meeting context: coffee after
Calendar guess source: rejected
```

### Rule 4: Do Not Save Vague Or Unattached Notes

If the user says:

```text
remember she works on agents
```

and Friendy cannot identify `she`, Friendy asks:

```text
Who should I remember that for?
```

### Rule 5: Active Conversation Target Helps, But Does Not Override Ambiguity

If the previous message was about Maya and the user says:

```text
Actually she works on hiring workflows.
```

Friendy may update Maya.

If the previous message listed Maya and Priya as options, Friendy must ask:

```text
Who should I update - Maya or Priya?
```

## 10. Search And Follow-Up Policy

### Search Inputs

Friendy should search across:

- Contact display name.
- Event title.
- Event location.
- User-provided notes.
- Saved relationship context.
- Tags or extracted descriptors.
- Contact route metadata, such as phone/email presence but not full raw contact values in the answer.

### Scoring Priorities

Search should prioritize fields in this order:

1. User-provided notes and corrections.
2. Saved relationship context.
3. Event title and location.
4. Contact name.
5. Calendar guess metadata.
6. System-generated tags.

User-provided text should outrank Calendar guesses.

### Match Outcomes

```ts
type SearchOutcome =
  | { kind: "single_confident_match"; memoryId: string }
  | { kind: "ambiguous_matches"; memoryIds: string[] }
  | { kind: "no_confident_match" };
```

Friendy should answer directly only when there is a single confident match.

If the top result and second result are close, Friendy should ask a clarifying question.

### Ambiguity Display

Show at most three matches.

Each match should include:

- Name or safe label.
- Meeting context if available.
- One short reason it matched.

Example:

```text
I found a few possible matches:

Maya, from Photon Residency Dinner. You told me she was building recruiting agents.
Priya, from the coffee shop afterward. You told me she worked on recruiting automation.

Which one did you mean?
```

### Follow-Up Narrowing

When Friendy asks a clarifying question, it stores a `SearchContext`.

```ts
type SearchContext = {
  searchContextId: string;
  createdAt: string;
  expiresAt: string;
  originalQuery: string;
  candidateMemoryIds: string[];
  lastQuestion: string;
};
```

A follow-up clue should be applied only against `candidateMemoryIds`, not the whole memory database, unless the user clearly starts a new search.

Example:

```text
User: Who was the person building recruiting agents?
Friendy: I found Maya and Priya. Which one did you mean?
User: The one who played piano.
Friendy searches only Maya and Priya, then answers Maya.
```

### Search Failure

If no match is found:

```text
I don't have a clear match yet. Do you remember where you met them or anything else about them?
```

If the query is too broad:

```text
Can you give me one more clue, like where you met them or what they were working on?
```

## 11. Saved Memory Model

### Memory

```ts
type RelationshipMemory = {
  memoryId: string;
  contactId?: string;
  displayName: string;
  safeContactLabel?: string;
  meetingContext?: string;
  eventId?: string;
  eventTitle?: string;
  eventLocation?: string;
  userNotes: string[];
  tags: string[];
  source: {
    contactSignalId?: string;
    calendarGuessId?: string;
    confirmedByUser: true;
    userCorrectionApplied: boolean;
  };
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};
```

### Memory Revision

```ts
type MemoryRevision = {
  revisionId: string;
  memoryId: string;
  createdAt: string;
  reason: "created" | "user_correction" | "user_note_added" | "deleted";
  previousValue?: Partial<RelationshipMemory>;
  nextValue: Partial<RelationshipMemory>;
  userText?: string;
};
```

### Contact Route Display

Friendy may reveal a safe contact route only when available and appropriate.

Preferred display:

```text
number ending in 4567
email at example.com
```

Avoid showing full phone numbers or full email addresses by default in chat replies unless the user explicitly asks and the data belongs to their local address book.

## 12. Agent Behavior Contract

Friendy should not rely on a model prompt alone for product behavior. The product needs an Agent Behavior Contract enforced across deterministic logic, model interpretation, response wording, and evals.

### Contract Summary

Friendy must:

- Be concise and conversational.
- Sound like a helpful texting agent, not a database.
- Ask when uncertain.
- Never guess, invent, or save unclear information.
- Never save from contact detection alone.
- Save only after user confirmation or user-provided meeting context.
- Trust user corrections over Calendar guesses.
- Lightly echo saved memories so the user can catch mistakes.
- Make source clear: contact signal, Calendar guess, or user-provided note.
- Narrow follow-up clues against previous search context.
- Stay scoped to relationship memory and people the user has met.
- Avoid scary technical language in setup and runtime errors.

### Truth Hierarchy

When sources conflict, Friendy uses this order:

1. Explicit user correction.
2. Explicit user confirmation or note.
3. Existing saved memory.
4. Contact signal.
5. Calendar guess.
6. Model inference.

Model inference may structure or classify text, but it is never the source of truth for saving unsupported facts.

### Model Boundary

The model may:

- Classify intent.
- Extract candidate confirmation details.
- Extract meeting context from user text.
- Extract notes from user text.
- Detect whether the user is correcting a guess.
- Help phrase concise responses.

The model must not directly:

- Write a memory.
- Delete a memory.
- Choose among ambiguous candidates without deterministic support.
- Invent contact details.
- Invent event details.
- Claim certainty when the search result is ambiguous.

### Response Style

Friendy should usually respond in one to three short sentences.

Preferred style:

```text
Got it, saved Maya from Photon Residency Dinner. I'll remember she was building recruiting agents.
```

Avoid:

```text
Database updated successfully.
```

Avoid overexplaining:

```text
I have now persisted a relationship memory object with the following properties...
```

### Scope Redirect

If the user asks something unrelated:

```text
I'm mainly here to help you remember people you've met.
```

If the unrelated request is harmless and adjacent, Friendy can be slightly helpful while returning to scope:

```text
I can't help with that here, but I can help you remember who you met or update a saved memory.
```

## 13. Privacy And Consent

Friendy should make privacy obvious in onboarding and the agent experience.

Rules:

- Friendy does not read iMessage history.
- Friendy does not scrape social profiles.
- Friendy does not save people automatically.
- Friendy only saves after the user confirms or gives clear meeting context.
- Friendy lets users ignore a candidate.
- Friendy lets users correct saved context.
- Friendy lets users delete a saved memory.
- Friendy makes the source clear: contact, Calendar guess, or user-provided note.

Recommended onboarding copy:

```text
Friendy notices new contacts on your Mac and uses Calendar only to guess where you met them. It never reads your iMessages or scrapes social profiles, and it always asks before saving someone.
```

### Consent Moments

Consent should be visible at these points:

1. Before starting contact memory.
2. When macOS asks for Contacts access.
3. When macOS asks for Calendar access.
4. When Friendy prompts about a new contact.
5. When Friendy saves a memory.
6. When Friendy updates or deletes a memory.

### Data Source Labels

Friendy should use natural source labels:

```text
I noticed you added Maya.
```

```text
Calendar suggested Photon Residency Dinner.
```

```text
You told me she was building recruiting agents.
```

Avoid saying:

```text
My model inferred that Maya was at Photon Residency Dinner.
```

## 14. Setup And Runtime Problems

User-facing setup errors should say:

```text
what is broken + what still works + what to do next
```

The tone should be calm, short, and actionable. Avoid scary technical language.

### Contacts Missing

```text
I need Contacts permission before I can notice new contacts. Open Friendy for Mac and allow Contacts access to finish setup.
```

System behavior:

- Do not create new candidates.
- Allow saved-memory search if the chat runtime is connected.
- Show setup status on the landing page.

### Calendar Missing

```text
I can still notice new contacts, but I need Calendar permission to guess where you met them. Open Friendy for Mac and allow Calendar access when you're ready.
```

System behavior:

- Continue contact detection.
- Prompt without event guesses.
- Mark event guess strength as `none` with reason `calendar_permission_missing`.

### Mac Helper Down

```text
Friendy's Mac helper is not connected, so contact memory is paused. Open Friendy for Mac to resume.
```

System behavior:

- Stop contact detection.
- Do not lose already pending candidates.
- Continue saved-memory search only if the chat runtime has local repository access.

### Prompt Send Failed

```text
I noticed a new contact, but had trouble sending the prompt. I won't lose it - I'll try again or show it when Friendy reconnects.
```

System behavior:

- Candidate enters `send_failed`.
- Retry with backoff.
- Do not create duplicate prompts.
- Preserve candidate for later review.

### Model Interpreter Failed

```text
I had trouble understanding that. Can you say it another way?
```

System behavior:

- Use deterministic fallback where possible.
- Do not save, update, or delete if interpretation is unsafe.
- Record trace with `modelUsed=false` or `fallbackUsed=true`.

### Phone Verification Failed

```text
That code did not work. Try again or send a new code.
```

System behavior:

- Do not mark phone as verified.
- Do not send Friendy setup messages.

## 15. Tracing Decision

Do not add LangChain or LangSmith tracing for this MVP unless agent orchestration becomes more complex.

Friendy is currently mostly deterministic: interpretation, tool execution, response composition, and evals are separate and inspectable.

Preferred MVP trace:

```ts
type AgentTrace = {
  traceId: string;
  createdAt: string;
  inboundText?: string;
  inboundTextRedacted?: string;
  scopeDecision: string;
  interpretedIntent?: unknown;
  toolCalls: Array<{
    name: string;
    argsRedacted?: unknown;
    result: "success" | "error" | "blocked";
  }>;
  candidateIdsTouched: string[];
  memoryIdsTouched: string[];
  search?: {
    query: string;
    queryRedacted?: string;
    topMatches: Array<{ memoryId: string; score: number; reasons: string[] }>;
    outcome: "single" | "ambiguous" | "none";
  };
  outboundText?: string;
  model: {
    used: boolean;
    provider?: string;
    modelName?: string;
    fallbackUsed: boolean;
  };
  errors: string[];
};
```

Trace storage rules:

- Store full traces locally in development only.
- Redact phone numbers and emails by default.
- Never export traces without explicit developer action.
- Include IDs touched so bugs can be reproduced.

Add LangChain, LangSmith, or another hosted trace UI later only if Friendy adds multiple model calls per message, embeddings, rerankers, external tools, complex planning, or needs production debugging.

## 16. Landing Page And Setup Status UX

The MVP setup page should show a simple checklist.

### Verified But Helper Missing

```text
Phone verified

Next: Open Friendy for Mac

Friendy needs the Mac helper to notice new contacts locally.
```

CTA:

```text
Open Friendy for Mac
```

### Helper Connected But Permissions Missing

```text
Friendy for Mac is connected

Finish setup:
- Allow Contacts access
- Allow Calendar access
```

### Calendar Missing But Contacts Ready

```text
Friendy can notice new contacts now.

Calendar access is still missing, so Friendy will ask where you met someone instead of guessing from your calendar.
```

CTA:

```text
Continue without Calendar
```

### Fully Ready

```text
Friendy is ready.

Check your messages to start contact memory.
```

### Active

```text
Friendy is on.

Add a new contact on your Mac to try the demo.
```

### Paused

```text
Friendy is paused.

Reply "resume" to turn contact memory back on.
```

## 17. Chat Copy Library

### Start

```text
Great. Friendy is on. Add a new contact on your Mac, and I'll ask before saving anything.
```

### Candidate With Strong Event Guess

```text
I noticed you added Maya during Photon Residency Dinner. Did you meet them there?
```

### Candidate With Weak Event Guess

```text
I noticed you added Maya. Was this from Photon Residency Dinner, or somewhere else?
```

### Candidate Without Event Guess

```text
I noticed you added Maya. Where did you meet them?
```

### Saved With Confirmed Guess

```text
Got it, saved Maya from Photon Residency Dinner. I'll remember she was building recruiting agents.
```

### Saved With Corrected Context

```text
Got it, saved Maya from the coffee shop afterward. I'll remember she works on recruiting agents.
```

### Ignored Candidate

```text
Got it. I won't save Maya.
```

### Search Single Match

```text
That was Maya. You met her at Photon Residency Dinner, and you told me she was building recruiting agents. You have her number ending in 4567.
```

### Search Ambiguous

```text
I found a few possible matches:

Maya, from Photon Residency Dinner. You told me she was building recruiting agents.
Priya, from the coffee shop afterward. You told me she worked on recruiting automation.

Which one did you mean?
```

### Search No Match

```text
I don't have a clear match yet. Do you remember where you met them or anything else about them?
```

### Update Saved Memory

```text
Got it, updated Maya. I'll remember she was working on hiring workflows.
```

### Delete Saved Memory

```text
Got it, deleted the saved memory for Maya.
```

### Scope Redirect

```text
I'm mainly here to help you remember people you've met.
```

## 18. Required Evals

The MVP should ship with deterministic evals for the behavior contract.

### Onboarding Evals

- Phone verified does not imply helper ready.
- Helper connected but Contacts missing blocks contact detection.
- Calendar missing still allows contact prompts without event guesses.
- First hello message is sent only after helper readiness.
- User must opt in before active contact memory begins.

### Candidate Evals

- New contact creates pending candidate, not memory.
- Strong Calendar match prompts with event guess.
- Missing Calendar prompts with open question.
- User confirmation saves memory.
- User correction overrides Calendar guess.
- Bare `yes` confirms only one active candidate.
- Bare `yes` with multiple candidates asks which one.
- Ignore candidate does not create memory.
- Prompt send failure keeps candidate for retry.

### Search Evals

- Vague clue returns correct saved person.
- User notes outrank Calendar metadata.
- Multiple close matches produce clarification.
- Follow-up clue narrows previous search context.
- Follow-up context expires after configured TTL.
- No match asks for one more clue.

### Update/Delete Evals

- Clear correction updates active memory.
- Ambiguous correction asks who to update.
- Adding a note updates the right memory.
- Delete removes memory from search results.
- Correction revision is recorded.

### Safety Evals

- Contact detection alone never saves.
- Model extraction alone never saves unsupported facts.
- Friendy does not invent a contact route.
- Friendy does not claim certainty on ambiguous search.
- Unrelated messages get scoped redirect.
- Friendy does not say it reads iMessage history.

## 19. MVP Demo Acceptance Criteria

The Mac-only MVP demo succeeds when:

- User lands on the placeholder page.
- User verifies phone number.
- User installs, opens, or starts Friendy Mac helper.
- User grants Contacts access.
- User grants Calendar access or explicitly continues without it.
- Friendy sends hello/setup-complete message.
- User opts in with yes/start.
- User adds a new contact on the Mac.
- Friendy notices the contact.
- If Calendar has strong context, Friendy suggests the event.
- If Calendar has weak context, Friendy asks whether it was that event or somewhere else.
- If Calendar has no context, Friendy asks where the user met them.
- User confirms or corrects naturally.
- Friendy saves memory with natural confirmation wording.
- User later asks by vague clue.
- Friendy returns likely person, why it matched, and contact route if available.
- If ambiguous, Friendy asks a clarifying question.
- User gives a follow-up clue.
- Friendy narrows the previous search and answers.
- User can correct, update, ignore, pause, resume, or delete memory.
- Friendy stays scoped, privacy-safe, and calm when setup issues happen.

Additional acceptance criteria:

- No silent failure: if setup, permissions, or message sending breaks, the user sees a clear next step.
- No unsafe save: Friendy never saves from contact detection alone.
- End-to-end recall works: a vague later query reliably finds the saved person or asks for clarification.
- Every saved memory has a user-confirmed source.
- Every answer that includes a match has at least one reason.

## 20. Implementation Plan

### Phase 0: Behavior Contract

Deliverables:

```text
docs/agent-behavior-contract.md
src/relationship/behaviorContract.ts
src/relationship/evals/behavior-contract-cases.ts
```

Work:

- Move the contract rules into a durable artifact.
- Add response wording templates.
- Add deterministic guard constants.
- Add eval cases for unsafe save, ambiguity, correction, and scope redirect.

### Phase 1: Onboarding And Runtime State

Deliverables:

```text
phone verification provider interface
mock verification provider
onboarding state model
setup status API or local status endpoint
first ready message flow
```

Work:

- Implement phone verification mock mode.
- Track helper connection state.
- Track Contacts and Calendar permission state.
- Send first ready message only after required readiness.
- Require user opt-in before active contact memory.

### Phase 2: Candidate Intake

Deliverables:

```text
candidate lifecycle state machine
event guess strength classifier
candidate dedupe policy
prompt planner updates
send failure retry state
```

Work:

- Create pending candidates from contact signals.
- Separate observed time, contact updated time, and event match anchor time.
- Classify Calendar guesses as strong, weak, or none.
- Generate correct prompt wording.
- Ensure no memory can be created without user confirmation.

### Phase 3: Confirmation, Correction, Update, Delete

Deliverables:

```text
confirmation target policy
memory revision model
update memory tool
delete memory tool
ignore candidate tool
pause/resume tool
```

Work:

- Implement deterministic target selection.
- Handle bare yes safely.
- Apply user correction over Calendar guesses.
- Store append-only revisions.
- Add chat-native update/delete/ignore controls.

### Phase 4: Search And Follow-Up Narrowing

Deliverables:

```text
memory search scoring
ambiguity detection
search context store
follow-up narrowing policy
safe contact route display
```

Work:

- Search saved memories by vague clues.
- Rank user notes above Calendar guesses.
- Return reasons with matches.
- Ask clarifying questions for ambiguous results.
- Narrow follow-up clues against previous result set.

### Phase 5: Setup Failure Handling And Traces

Deliverables:

```text
runtime problem messages
structured local AgentTrace
redaction helpers
no-silent-failure tests
```

Work:

- Add setup and runtime failure messages.
- Persist structured traces for inbound, interpretation, tools, search, and outbound.
- Redact contact routes in logs.
- Add tests for helper down, permission missing, prompt send failure, and model fallback.

## 21. Non-Goals For This MVP

Do not build these before the Mac-only MVP demo is reliable:

- Full web dashboard.
- Mobile app.
- Social profile enrichment.
- LinkedIn/X/Instagram import.
- Reading iMessage history.
- Face recognition.
- Background LaunchAgent polish.
- Hosted LangSmith/LangChain tracing.
- Multi-user production account management.
- Automated memory creation without confirmation.

## 22. Final Demo Script

This is the canonical demo path.

### Setup

1. User opens landing page.
2. User clicks `Log in with phone number`.
3. User enters phone number.
4. User enters verification code.
5. Page says phone is verified and asks user to open Friendy for Mac.
6. User starts the Mac helper.
7. User grants Contacts and Calendar access.
8. Friendy texts the user:

```text
Hi, I'm Friendy. I help you remember people you meet.

I notice new contacts on your Mac, use Calendar only to guess where you met them, and always ask before saving someone.

Want me to start?
```

9. User replies:

```text
yes
```

10. Friendy replies:

```text
Great. Friendy is on. Add a new contact on your Mac, and I'll ask before saving anything.
```

### Contact Capture

11. User adds Maya as a contact.
12. Calendar has `Photon Residency Dinner` nearby.
13. Friendy texts:

```text
I noticed you added Maya during Photon Residency Dinner. Did you meet them there?
```

14. User replies:

```text
Yeah, that's her. She was building recruiting agents and played piano after dinner.
```

15. Friendy replies:

```text
Got it, saved Maya from Photon Residency Dinner. I'll remember she was building recruiting agents and played piano after dinner.
```

### Recall

16. Later, user asks:

```text
Who was the person building recruiting agents?
```

17. Friendy replies:

```text
That was Maya. You met her at Photon Residency Dinner, and you told me she was building recruiting agents and played piano after dinner. You have her number ending in 4567.
```

### Correction

18. User says:

```text
Actually, Maya was working on hiring workflows, not recruiting agents.
```

19. Friendy replies:

```text
Got it, updated Maya. I'll remember she was working on hiring workflows.
```

20. User asks:

```text
Who was working on hiring workflows?
```

21. Friendy replies:

```text
That was Maya. You met her at Photon Residency Dinner, and you told me she was working on hiring workflows and played piano after dinner. You have her number ending in 4567.
```

## 23. Definition Of Done

The design is done when implementation can proceed without product ambiguity around:

- What phone verification means.
- What the landing page owns.
- How the Mac helper fits into the demo.
- When Friendy is allowed to start contact memory.
- When Friendy may save a memory.
- How Calendar guesses are treated.
- How user corrections are applied.
- How vague search and follow-up narrowing work.
- How setup and runtime failures are communicated.
- What evals are required to protect the behavior.

The MVP is not done until the full demo script works end to end with no unsafe save, no silent failure, and reliable vague-memory recall.
