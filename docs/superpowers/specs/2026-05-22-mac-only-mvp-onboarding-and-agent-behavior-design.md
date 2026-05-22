# Mac-Only MVP Onboarding And Agent Behavior Design

## Goal

Define the user-visible Mac-only MVP demo path for Friendy, from phone verification through native Mac setup, contact detection, confirmation, recall, correction, and setup failure handling.

The MVP should prove one product bet: Friendy helps a user recover the right person later from a vague human memory fragment, without saving anyone automatically.

## Scope

This spec covers the Mac-only demo experience:

- Placeholder landing page entry.
- Phone-number login and verification.
- Mac helper setup.
- Contacts and Calendar access.
- First Friendy message to the verified phone number.
- Contact candidate prompts.
- Natural confirmation and correction replies.
- Vague-memory search and follow-up narrowing.
- Agent behavior contract.
- Privacy, consent, and setup failure messaging.

This spec does not cover:

- iPhone app installation.
- App Store distribution.
- Production account management.
- Full dashboard UX.
- Social profile import.
- Reading iMessage history.
- LinkedIn, X, Instagram, or website scraping.

## User Journey

### Step 1: Landing Page To Phone Verification

The landing page can be a simple placeholder. Its primary action is:

```text
Log in with phone number
```

The user enters a phone number, receives a verification code, enters the code, and reaches a verified state.

Phone verification means:

```text
Friendy knows where to message the user.
```

Phone verification does not mean Friendy is fully ready. Friendy still needs the Mac helper and local permissions before it can notice contacts.

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

### Step 3: First Ready Conversation

After Mac setup succeeds, Friendy sends the first message to the verified phone number.

The message should explain the core behavior in chat-native language:

```text
Hi, I'm Friendy. I help you remember people you meet.

I notice new contacts on your Mac, use Calendar only to guess where you met them, and always ask before saving someone.

Want me to start?
```

If the user replies yes, Friendy confirms that the local relationship-memory loop is active.

### Step 4: New Contact Detection

When the user adds a new contact, Friendy creates a pending candidate, not a saved memory.

If Calendar has a strong event match, Friendy suggests it:

```text
I noticed you added Maya during Photon Residency Dinner. Did you meet them there?
```

If Calendar has no useful event match, Friendy asks openly:

```text
I noticed you added Maya. Where did you meet them?
```

Calendar context is helpful but not required. Friendy must still work when no event is present.

### Step 5: Confirmation Or User Correction

The user can confirm naturally:

```text
Yeah, that's her. She was building recruiting agents and played piano after dinner.
```

Friendy replies with natural saved-memory wording:

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

### Step 6: Later Search By Vague Memory

The user can later ask by context instead of name:

```text
Who was the person building recruiting agents?
```

Friendy returns the likely person, why it matched, and contact route if available and appropriate:

```text
That was Maya. You met her at Photon Residency Dinner, and you told me she was building recruiting agents and played piano after dinner. You have her number ending in 4567.
```

If contact route is unavailable, Friendy should omit it or say it does not have a contact link saved yet.

### Step 7: Ambiguity And Follow-Up Narrowing

If multiple people match, Friendy should show the top two or three and ask which one:

```text
I found a few possible matches:

Maya, from Photon Residency Dinner. You told me she was building recruiting agents.
Priya, from the coffee shop afterward. You told me she worked on recruiting automation.

Which one did you mean?
```

Follow-up clues should narrow the previous search, not start a totally new search.

Example:

```text
The one who played piano.
```

Friendy:

```text
That was Maya - you met her at Photon Residency Dinner. You told me she played piano after dinner, and you have her number ending in 4567.
```

If the new clue still leaves multiple matches, Friendy should ask one more clarifying question.

### Step 8: Correcting Or Updating Saved Memory

The user can correct a saved memory:

```text
Actually, Maya was working on hiring workflows, not recruiting agents.
```

If the correction clearly refers to the active person from recent conversation, Friendy updates that memory:

```text
Got it, updated Maya. I'll remember she was working on hiring workflows.
```

If unclear who the correction refers to, Friendy asks:

```text
Who should I update - Maya or Priya?
```

## Agent Behavior Contract

Friendy should not rely on a model prompt alone for product behavior. The product needs an Agent Behavior Contract enforced across deterministic logic, model interpretation, response wording, and evals.

Rules:

- Friendy is concise and conversational.
- Friendy sounds like a helpful texting agent, not a database.
- Friendy asks when uncertain.
- Friendy never guesses, invents, or saves unclear information.
- Friendy never saves from contact detection alone.
- Friendy saves only after user confirmation.
- Friendy trusts user corrections over Calendar guesses.
- Friendy lightly echoes saved memories so the user can catch mistakes.
- Friendy makes source clear: contact signal, Calendar guess, or user-provided note.
- Friendy narrows follow-up clues against previous search context.
- Friendy stays scoped to relationship memory and people the user has met.

Existing behavior-control layers:

- Interpreter prompt controls how user text becomes structured JSON.
- Response composer controls final user-facing wording.
- Prompt planner controls proactive contact prompts.

Missing central artifact:

```text
No single behavior contract exists yet for tone, safety, confirmation, ambiguity, and correction rules.
```

The implementation should introduce this contract as a durable source of truth and use it to guide code, prompts, and evals.

## Safety And Scope Rules

If a message is too vague to save, Friendy asks who and what to remember.

If a message is too vague to search, Friendy asks for one more clue.

If a message is unrelated, Friendy redirects gently:

```text
I'm mainly here to help you remember people you've met.
```

Friendy should never save, update, or answer with certainty when the message is unclear.

## Privacy And Consent

Friendy should make privacy obvious in the onboarding and the agent experience.

Rules:

- Friendy does not read iMessage.
- Friendy does not scrape social profiles.
- Friendy does not save people automatically.
- Friendy only saves after the user confirms.
- Friendy lets users ignore a candidate.
- Friendy lets users correct saved context.
- Friendy makes the source clear: contact, Calendar guess, or user-provided note.

Recommended onboarding copy:

```text
Friendy notices new contacts on your Mac and uses Calendar only to guess where you met them. It never reads your iMessages or scrapes social profiles, and it always asks before saving someone.
```

## Setup And Runtime Problems

User-facing setup errors should say:

```text
what is broken + what still works + what to do next
```

The tone should be calm, short, and actionable. Avoid scary technical language.

Examples:

Contacts missing:

```text
I need Contacts permission before I can notice new contacts. Open Friendy for Mac and allow Contacts access to finish setup.
```

Calendar missing:

```text
I can still notice new contacts, but I need Calendar permission to guess where you met them. Open Friendy for Mac and allow Calendar access when you're ready.
```

Mac helper down:

```text
Friendy's Mac helper is not connected, so contact memory is paused. Open Friendy for Mac to resume.
```

Prompt send failed:

```text
I noticed a new contact, but had trouble sending the prompt. I won't lose it - I'll try again or show it when Friendy reconnects.
```

## Tracing Decision

Do not add LangChain or LangSmith tracing for this MVP unless agent orchestration becomes more complex.

Friendy is currently mostly deterministic: interpretation, tool execution, response composition, and evals are separate and inspectable.

Preferred MVP trace:

- Inbound text.
- Scope decision.
- Interpreted intent JSON.
- Tool calls.
- Candidate and memory IDs touched.
- Search query.
- Top matches and ambiguity state.
- Outbound text.
- Model used or fallback used.
- Errors.

The existing `AgentInteraction` model partially supports this. The MVP should improve Friendy-native structured traces before adding a broader orchestration framework.

Add LangChain or LangSmith later only if Friendy adds multiple model calls per message, embeddings, rerankers, external tools, complex planning, or needs a hosted trace UI for production debugging.

## MVP Demo Acceptance Criteria

The Mac-only MVP demo succeeds when:

- User lands on the placeholder page.
- User verifies phone number.
- User installs or opens Friendy Mac helper.
- User grants Contacts and Calendar access.
- Friendy sends hello/setup-complete message.
- User adds a new contact on the Mac.
- Friendy notices the contact.
- If Calendar has context, Friendy suggests the event.
- If Calendar has no context, Friendy asks where the user met them.
- User confirms or corrects naturally.
- Friendy saves memory with natural confirmation wording.
- User later asks by vague clue.
- Friendy returns likely person, why it matched, and contact route if available.
- If ambiguous, Friendy asks a clarifying question.
- User gives a follow-up clue.
- Friendy narrows the previous search and answers.
- User can correct or update the saved memory.
- Friendy stays scoped, privacy-safe, and calm when setup issues happen.

Additional acceptance criteria:

- No silent failure: if setup, permissions, or message sending breaks, the user sees a clear next step.
- No unsafe save: Friendy never saves from contact detection alone.
- End-to-end recall works: a vague later query reliably finds the saved person or asks for clarification.

## Open Implementation Questions

These should be resolved in the implementation plan, not this design spec:

- Whether phone verification is mocked first or backed by a provider.
- Whether the landing page owns only verification or also setup status.
- How the Mac helper is packaged for the demo.
- Whether the behavior contract is a Markdown artifact, TypeScript constants, eval fixtures, or a combination.
- How saved-memory updates are represented in the repository.
- How long follow-up search context should persist.
