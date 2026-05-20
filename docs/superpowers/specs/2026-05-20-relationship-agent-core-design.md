# Friendy Relationship Agent Core Design

## Summary

Friendy is a relationship memory agent that helps a user save and refind people they meet. The product is the agent and memory system; Photon/Spectrum is the first communication transport, with iMessage as the most convenient initial channel.

Iteration 2 should move away from UI polish and toward the core product loop:

1. Detect a newly added contact.
2. Map that contact to nearby calendar context.
3. Create a pending relationship candidate.
4. Let the Friendy agent confirm, enrich, and search memories through chat.

The first implementation may simulate Contacts and Calendar signals, but the interfaces should look like future native Contacts/Calendar events so native integration can replace the simulator later.

## Goals

- Build the relationship agent core before building more UI.
- Support newly added contact candidates first.
- Map new contacts to likely calendar events with deterministic backend logic.
- Let the user confirm or ignore pending candidates through the agent.
- Let the user search memories by vague human context.
- Use Photon/Spectrum as the first messaging transport, with iMessage through the agent number `+14156056081`.
- Keep the system agent-first and transport-agnostic.

## Non-Goals

- Do not build native iOS Contacts or Calendar integration in this iteration.
- Do not support changed existing contacts yet.
- Do not add Gmail.
- Do not add Notion sync.
- Do not add Mem0, Membase, or vector search.
- Do not build a connection graph UI.
- Do not build follow-up drafting.
- Do not build complex deduplication.
- Do not build multiple agents.
- Do not use an LLM to classify every calendar event.

## Product Framing

Friendy should not be described as a Spectrum app or an iMessage app. It should be described as:

> A relationship memory agent that helps you remember and refind people you met.

Spectrum is a communication adapter. iMessage is the first channel because it is where the user can naturally text the agent.

## System Architecture

```text
Contacts + Calendar Sensor
        ↓
Candidate + Event Mapper
        ↓
Canonical Memory Database
        ↓
Relationship Agent Core
        ↓
Transport Adapter
        ↓
Spectrum / iMessage
```

### Contacts + Calendar Sensor

In Iteration 2, this can be simulated with fixtures or a detector endpoint. The simulation should emit events shaped like future native data.

Required simulated event:

```ts
type ContactCandidateDetected = {
  userId: string;
  displayName: string;
  phoneNumbers: string[];
  emails: string[];
  detectedAt: string;
  source: "simulated" | "contacts_delta";
};
```

The future native sensor should be able to replace the simulation without changing the agent tools.

### Candidate + Event Mapper

The mapper is deterministic backend logic, not an LLM tool.

It receives a contact candidate and finds likely calendar context by comparing `detectedAt` to event windows.

Event context types:

- `short`: dinners, meetups, hackathon sessions, workshops.
- `long`: residencies, conferences, travel, multi-day programs.
- `all_day`: all-day calendar entries, weak context unless no stronger event exists.

Ranking rules:

- Prefer shorter, more specific overlapping events.
- Treat long events as background anchors.
- Keep all plausible matches when events overlap.
- If no event matches, create a candidate with no event context and let the agent ask.
- If multiple strong matches exist, mark the candidate ambiguous.

Example:

- Photon Residency runs Monday 4 PM to next Monday 10 AM.
- Photon Residency Dinner runs Thursday 7 PM to 10 PM.
- Maya Chen is detected Thursday at 9:42 PM.

The mapper should rank:

1. Photon Residency Dinner: high confidence.
2. Photon Residency: lower-confidence background context.

## Agent Architecture

Use one focused relationship agent with multiple small tools.

Do not use one giant `relationshipMemoryTool(action, payload)` function. Small tools are easier to test, log, secure, and reason about.

### Agent Role

Friendy is a relationship memory agent that helps the user save and refind people they met.

### Agent Rules

- Keep responses short enough for iMessage.
- Never pretend certainty.
- Never save a detected candidate as a confirmed memory without user confirmation.
- Ask clarifying questions when event or person matches are ambiguous.
- Explain why a search result matched.
- Treat Spectrum/iMessage as a transport, not the product identity.
- Respect ignored candidates and deleted memories.

### Iteration 2 Tools

Use at most these tools:

```ts
search_memories(userId: string, query: string)
list_pending_candidates(userId: string)
get_candidate(userId: string, candidateId: string)
confirm_candidate(userId: string, candidateId: string, contextNote: string, eventId?: string)
ignore_candidate(userId: string, candidateId: string)
create_manual_memory(userId: string, name: string, contextNote: string, contactMethod?: string)
```

The context mapper should run before the agent sees a candidate. The agent should not need a tool to classify events.

### Candidate Review Mode

Triggered when the system detects a newly added contact and creates a pending candidate.

Example outbound message:

> I noticed you added Maya Chen during Photon Residency Dinner. Did you meet Maya there?

Example user reply:

> yes, recruiting agents, played piano

Expected agent behavior:

- Confirm the candidate.
- Attach the highest-confidence event unless the user corrects it.
- Save the note.
- Extract simple tags.
- Reply:
  > Saved. I'll remember Maya Chen from Photon Residency Dinner as "recruiting agents, played piano."

If ambiguous:

> I found two possible contexts: Photon Residency Dinner and AI Founders Dinner. Which one was Maya from?

If the user says no:

> Got it. Where did you meet Maya, or should I ignore this contact?

### Search Mode

Triggered by user recall questions.

Example:

> who was the piano person from dinner?

Search over:

- display name
- context note
- extracted tags
- event title
- event date
- contact labels

If confident:

> Likely Maya Chen. You saved her from Photon Residency Dinner, and your note says "recruiting agents, played piano." Contact: phone.

If low confidence:

> I found two dinner memories: Maya Chen from Photon Residency Dinner and Sarah Lee from Founders Dinner. Which dinner do you mean?

## Memory Architecture

Use a canonical application database as the source of truth.

For the immediate prototype, SQLite, local structured JSON, or the current in-memory store are acceptable. The design should keep the interface compatible with Postgres/Supabase later.

Notion, Mem0, and Membase should not be required in Iteration 2.

- Notion can become a later admin/operator mirror.
- Mem0 can become a later managed semantic memory/search layer.
- Membase can become a later MCP/knowledge-graph-style memory layer.

### Data Model

```ts
type User = {
  id: string;
  phoneNumber: string;
  displayName: string;
  createdAt: string;
};

type ContactCandidate = {
  id: string;
  userId: string;
  displayName: string;
  phoneNumbers: string[];
  emails: string[];
  source: "contacts_delta" | "manual" | "simulated";
  detectedAt: string;
  status: "pending" | "confirmed" | "ignored";
};

type CalendarEvent = {
  id: string;
  userId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  location?: string;
  calendarSource: "apple_calendar" | "google_calendar" | "simulated";
  eventKind: "short" | "long" | "all_day";
};

type EventContextMatch = {
  id: string;
  candidateId: string;
  calendarEventId: string;
  confidence: number;
  reason: string;
  rank: number;
};

type RelationshipMemory = {
  id: string;
  userId: string;
  candidateId?: string;
  displayName: string;
  primaryContactLabel: string;
  eventId?: string;
  eventTitle?: string;
  contextNote: string;
  tags: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
};

type AgentInteraction = {
  id: string;
  userId: string;
  platform: "imessage" | "terminal" | "web";
  spaceId?: string;
  inboundText: string;
  outboundText: string;
  toolCalls: string[];
  createdAt: string;
};
```

## Transport Architecture

Spectrum should be implemented as a transport adapter around the agent core.

The agent core should not depend directly on iMessage-specific concepts. It should receive normalized inbound messages and return outbound messages plus tool actions.

```ts
type InboundAgentMessage = {
  userId: string;
  platform: "imessage" | "terminal" | "web";
  spaceId?: string;
  text: string;
  receivedAt: string;
};

type OutboundAgentMessage = {
  userId: string;
  platform: "imessage" | "terminal" | "web";
  spaceId?: string;
  text: string;
};
```

Spectrum/iMessage should be the first real transport. Terminal should remain as a fallback adapter for local tests.

## Demo Path

The Iteration 2 demo should prove the agent-core loop:

1. Simulate a new contact:
   - Maya Chen
   - phone number present
   - detected at 9:42 PM
2. Seed calendar:
   - Photon Residency Dinner, 7 PM to 10 PM
   - Photon Residency, week-long background event
3. Mapper creates event matches:
   - Photon Residency Dinner: high confidence
   - Photon Residency: lower background confidence
4. Friendy sends:
   > I noticed you added Maya Chen during Photon Residency Dinner. Did you meet Maya there?
5. User replies:
   > yes, recruiting agents, played piano
6. Agent calls `confirm_candidate`.
7. Agent replies:
   > Saved. I'll remember Maya Chen from Photon Residency Dinner as "recruiting agents, played piano."
8. Later, user asks:
   > who was the piano person from dinner?
9. Agent searches memories.
10. Agent returns Maya if confident or asks clarification if multiple dinner memories are close.

## Testing Requirements

Iteration 2 should include tests for:

- creating a new pending contact candidate
- mapping a candidate to overlapping short and long events
- ranking the short event above the long event
- confirming a candidate creates a relationship memory
- ignoring a candidate prevents saving
- searching by vague context returns a saved memory
- ambiguous search returns a clarification response
- agent behavior uses small tool calls rather than direct store mutation

## Open Technical Assumptions

- Photon/Spectrum credentials and runtime details are available separately from this spec.
- The agent number is `+14156056081`.
- The initial detector may be simulated.
- Native Contacts/Calendar integration will be designed in a later spec.
- The canonical database can start simple as long as the module boundaries can move to Postgres/Supabase later.
