# Photon Relationship Memory Agent Design

## Summary

Photon is a relationship memory agent that helps users remember and refind people they met by watching for new contacts during approved event windows and asking them to add context.

The first build should be a demo prototype, not the full native mobile product. It should simulate contact/calendar signals so the Photon agent loop can be tested quickly: calendar prompt, approved memory window, contact delta review, context capture, and later fuzzy recall.

## MVP Definition

The MVP is an agent-run event memory session:

1. Photon sees an upcoming event from a mocked calendar feed.
2. Photon asks whether to remember new people during that event.
3. The user approves the memory window.
4. A mocked contact delta appears after the event.
5. Photon asks the user to confirm which new contacts were actually met.
6. Photon asks for context about confirmed people.
7. The user can later ask vague memory queries and Photon returns likely matches with reasoning.

The demo should prove the product loop, not iOS background behavior. Native Contacts and Calendar access are a later sensor layer that can replace the mocked signal source without changing the agent behavior.

## Target User And Job

The first user is a Photon residency or event participant who meets several people in a short period, adds some of them to contacts, and later remembers fragments better than names.

The core job is recovery: “I remember the situation and context, but not the person’s name or how to contact them.”

Example recall query:

> Who was the girl playing piano at the event around 10pm five weeks ago?

Photon should answer with the likely person, explain why, and show the available contact route.

## Core Flow

### Before The Event

- Photon displays or sends a prompt for an upcoming calendar event: “You have Photon Residency Dinner tonight from 7-11 PM. Want me to remember new people you meet there?”
- If approved, the system creates a `MemorySession` for that event.
- In production, the companion app would snapshot contacts at this point. In the demo, this is represented by a mocked baseline.

### During And After The Event

- New contacts appear in a pending queue as `CandidateConnection` records.
- Photon does not save them as memories automatically.
- Photon asks the user to review candidates after the event window.

### Review

- The user can confirm, ignore, or assign a candidate to a different event.
- For confirmed candidates, Photon asks: “What should I remember about this person?”
- The user can add natural language context such as “played piano, AI recruiting founder, follow up about demo.”

### Later Recall

- The user asks a vague query through Photon chat.
- Photon searches confirmed relationship memories using name, event, time, context notes, contact metadata, and tags extracted from notes.
- Photon returns 1-3 likely matches with reasons and contact actions.

## Required Demo Behaviors

- Start a memory session for “Photon Residency Dinner.”
- Show at least one pending new contact candidate after the event.
- Confirm a candidate and add context through chat.
- Search with a vague natural language query and return the correct person.
- Show a clear “why this matched” explanation.
- Include a follow-up draft action as a visible post-MVP or optional demo action.

## Data Model

```ts
type User = {
  id: string;
  name: string;
  phoneNumber?: string;
  createdAt: string;
};

type CalendarEvent = {
  id: string;
  userId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  source: "mock_calendar" | "native_calendar";
};

type MemorySession = {
  id: string;
  userId: string;
  calendarEventId?: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "suggested" | "active" | "review_ready" | "completed" | "declined";
  createdAt: string;
};

type CandidateConnection = {
  id: string;
  userId: string;
  memorySessionId?: string;
  displayName: string;
  phoneNumber?: string;
  email?: string;
  source: "mock_contact_delta" | "native_contacts" | "shared_link" | "manual";
  detectedAt: string;
  status: "pending" | "confirmed" | "ignored";
};

type RelationshipMemory = {
  id: string;
  userId: string;
  candidateConnectionId: string;
  memorySessionId?: string;
  displayName: string;
  contactLabel: string;
  eventTitle?: string;
  contextNote: string;
  tags: string[];
  confirmedAt: string;
};

type AgentInteraction = {
  id: string;
  userId: string;
  kind: "event_prompt" | "candidate_review" | "context_capture" | "memory_search" | "follow_up_draft";
  input: string;
  response: string;
  createdAt: string;
};
```

## Agent Behavior

Photon should behave like the product, not like a database UI.

- Ask before starting a memory window.
- Ask before saving any person as a memory.
- Ask for context in plain language.
- Handle corrections like “not Photon dinner, that was AGI House.”
- When search confidence is low, return candidates instead of pretending certainty.
- Explain matches using event, timing, context notes, and contact details.

Example search response:

> Likely Maya Chen. You confirmed her after Photon Residency Dinner, and your note says “played piano, AI recruiting founder, follow up about demo.” Contact: phone.

## Search Strategy

V1 should use simple local matching for the demo:

- Normalize query, names, event titles, notes, and tags to lowercase tokens.
- Score matches by overlap across context note, tags, event title, display name, and approximate time words.
- Weight user-added context highest, event title second, then name/contact metadata.
- Return up to three matches with explanation strings.

Embeddings can be added later, but the first demo should not require vector infrastructure.

## Technical Architecture

The demo should be a local web prototype with mocked data:

- A chat-style Photon agent interface.
- A small in-memory or browser-local data store.
- A mocked calendar event and mocked contact delta.
- A candidate review view.
- A simple relationship memory search function.

Production architecture later:

- Native iOS companion app requests Contacts and Calendar permissions.
- Companion app snapshots contacts before approved event windows and reports deltas after.
- Backend stores candidate connections, sessions, memories, and interactions.
- Photon/Spectrum agent handles the conversational interface across messaging surfaces.

## Privacy And Consent Guardrails

- Photon must ask before starting a memory window.
- Photon must ask before saving a candidate as a relationship memory.
- The product must clearly say what signal created a candidate.
- User-added notes are private to the user.
- Users can ignore candidates and delete saved memories.
- V1 must not read iMessage, scrape social platforms, use face recognition, or auto-build an identity graph.

## Future Feature Ideas

- Voice input: user can tell Photon context after meeting someone.
- Image input: user can send a photo of a place, badge, table, or whiteboard for context; this must not start as face recognition.
- Shared profile links: user forwards an Instagram, LinkedIn, X, or website link to Photon.
- Follow-up drafting: Photon drafts a message using the saved event context.
- Native Contacts and Calendar companion: replaces mocked signal capture after the demo loop is proven.

## Assumptions

- The first implementation is a demo prototype, not production mobile software.
- Contact and calendar data are mocked in V1 to avoid being blocked by native app permissions and background execution.
- The agent conversation is the product surface; the companion app is only a later sensor layer.
- The MVP succeeds if a user can approve an event window, confirm a new contact, add context, and later recover that person from a vague query.
