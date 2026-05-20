# Relationship Agent Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Friendy relationship agent core: simulated newly-added contact detection, deterministic calendar context mapping, bounded memory tools, agent review/search behavior, and Spectrum/iMessage transport scaffolding.

**Architecture:** Add a new `src/relationship/` module set instead of rewriting the current demo UI. The new modules expose domain types, fixtures, event mapping, an in-memory repository with a future database-shaped interface, bounded tools, one relationship agent core, and transport adapters. Spectrum is treated as a communication adapter; the agent core stays transport-agnostic.

**Tech Stack:** TypeScript, Vitest, existing Vite/React project, `spectrum-ts` for the first real messaging transport, `tsx` for a local terminal runner.

---

## File Structure

- Create `src/relationship/types.ts`: Iteration 2 domain model and agent message/result types.
- Create `src/relationship/fixtures.ts`: deterministic user, calendar events, detected contact, and optional ambiguous memories.
- Create `src/relationship/eventMapper.ts`: deterministic contact-to-calendar context matching.
- Create `src/relationship/repository.ts`: in-memory repository with DB-like operations.
- Create `src/relationship/tools.ts`: small bounded tool functions used by the agent.
- Create `src/relationship/agentCore.ts`: single relationship agent routing and response logic.
- Create `src/relationship/transports/terminalTransport.ts`: local text runner for testing without Spectrum credentials.
- Create `src/relationship/transports/spectrumTransport.ts`: Spectrum/iMessage adapter using the normalized agent core.
- Create tests beside modules:
  - `src/relationship/eventMapper.test.ts`
  - `src/relationship/repository.test.ts`
  - `src/relationship/tools.test.ts`
  - `src/relationship/agentCore.test.ts`
  - `src/relationship/transports/terminalTransport.test.ts`
- Modify `package.json`: add scripts and dependencies.
- Modify `tsconfig.json`: include Node types for terminal/Spectrum runtime files.
- Modify `implementation-notes.html`: record Iteration 2 implementation decisions and verification.
- Modify `README.md`: add relationship agent core commands and demo path.

## Task 1: Add Relationship Domain Types And Fixtures

**Files:**
- Create: `src/relationship/types.ts`
- Create: `src/relationship/fixtures.ts`
- Create: `src/relationship/types.test.ts`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Create the relationship directory**

Run:

```bash
mkdir -p src/relationship/transports
```

Expected: command exits with status `0`.

- [ ] **Step 2: Write failing fixture/type test**

Create `src/relationship/types.test.ts`:

```ts
import {
  demoDetectedContact,
  demoLongEvent,
  demoShortEvent,
  demoUser
} from "./fixtures";

describe("relationship fixtures", () => {
  it("models the Iteration 2 demo contact and overlapping calendar context", () => {
    expect(demoUser.phoneNumber).toBe("+14156056081");
    expect(demoDetectedContact.displayName).toBe("Maya Chen");
    expect(demoDetectedContact.source).toBe("simulated");
    expect(demoShortEvent.title).toBe("Photon Residency Dinner");
    expect(demoShortEvent.eventKind).toBe("short");
    expect(demoLongEvent.title).toBe("Photon Residency");
    expect(demoLongEvent.eventKind).toBe("long");
  });
});
```

- [ ] **Step 3: Run failing test**

Run:

```bash
npm test -- src/relationship/types.test.ts
```

Expected: FAIL because `src/relationship/fixtures.ts` does not exist.

- [ ] **Step 4: Create domain types**

Create `src/relationship/types.ts`:

```ts
export type ContactCandidateSource = "contacts_delta" | "manual" | "simulated";
export type ContactCandidateStatus = "pending" | "confirmed" | "ignored";
export type CalendarSource = "apple_calendar" | "google_calendar" | "simulated";
export type CalendarEventKind = "short" | "long" | "all_day";
export type AgentPlatform = "imessage" | "terminal" | "web";

export type User = {
  id: string;
  phoneNumber: string;
  displayName: string;
  createdAt: string;
};

export type ContactCandidateDetected = {
  userId: string;
  displayName: string;
  phoneNumbers: string[];
  emails: string[];
  detectedAt: string;
  source: "simulated" | "contacts_delta";
};

export type ContactCandidate = ContactCandidateDetected & {
  id: string;
  status: ContactCandidateStatus;
};

export type CalendarEvent = {
  id: string;
  userId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  location?: string;
  calendarSource: CalendarSource;
  eventKind: CalendarEventKind;
};

export type EventContextMatch = {
  id: string;
  candidateId: string;
  calendarEventId: string;
  eventTitle: string;
  confidence: number;
  reason: string;
  rank: number;
};

export type RelationshipMemory = {
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

export type AgentInteraction = {
  id: string;
  userId: string;
  platform: AgentPlatform;
  spaceId?: string;
  inboundText: string;
  outboundText: string;
  toolCalls: string[];
  createdAt: string;
};

export type InboundAgentMessage = {
  userId: string;
  platform: AgentPlatform;
  spaceId?: string;
  text: string;
  receivedAt: string;
};

export type OutboundAgentMessage = {
  userId: string;
  platform: AgentPlatform;
  spaceId?: string;
  text: string;
};

export type AgentToolCall =
  | "search_memories"
  | "list_pending_candidates"
  | "get_candidate"
  | "confirm_candidate"
  | "ignore_candidate"
  | "create_manual_memory";

export type AgentCoreResult = {
  outbound: OutboundAgentMessage;
  toolCalls: AgentToolCall[];
};
```

- [ ] **Step 5: Create deterministic fixtures**

Create `src/relationship/fixtures.ts`:

```ts
import type { CalendarEvent, ContactCandidateDetected, RelationshipMemory, User } from "./types";

export const demoUser: User = {
  id: "user_demo",
  phoneNumber: "+14156056081",
  displayName: "Friendy Demo User",
  createdAt: "2026-05-20T09:00:00.000Z"
};

export const demoDetectedContact: ContactCandidateDetected = {
  userId: demoUser.id,
  displayName: "Maya Chen",
  phoneNumbers: ["+15550101020"],
  emails: [],
  detectedAt: "2026-05-15T21:42:00-07:00",
  source: "simulated"
};

export const demoShortEvent: CalendarEvent = {
  id: "event_photon_residency_dinner",
  userId: demoUser.id,
  title: "Photon Residency Dinner",
  startsAt: "2026-05-15T19:00:00-07:00",
  endsAt: "2026-05-15T22:00:00-07:00",
  timezone: "America/Los_Angeles",
  location: "San Francisco",
  calendarSource: "simulated",
  eventKind: "short"
};

export const demoLongEvent: CalendarEvent = {
  id: "event_photon_residency",
  userId: demoUser.id,
  title: "Photon Residency",
  startsAt: "2026-05-11T16:00:00-07:00",
  endsAt: "2026-05-18T10:00:00-07:00",
  timezone: "America/Los_Angeles",
  location: "San Francisco",
  calendarSource: "simulated",
  eventKind: "long"
};

export const ambiguousDinnerMemory: RelationshipMemory = {
  id: "memory_sarah_founders_dinner",
  userId: demoUser.id,
  displayName: "Sarah Lee",
  primaryContactLabel: "+15550101030",
  eventId: "event_founders_dinner",
  eventTitle: "Founders Dinner",
  contextNote: "hardware founder, dinner table",
  tags: ["hardware", "founder", "dinner", "table"],
  confidence: 0.9,
  createdAt: "2026-05-14T23:00:00-07:00",
  updatedAt: "2026-05-14T23:00:00-07:00"
};
```

- [ ] **Step 6: Run fixture test**

Run:

```bash
npm test -- src/relationship/types.test.ts
```

Expected: PASS.

- [ ] **Step 7: Update implementation notes**

Add this list item under `Implementation Decisions` in `implementation-notes.html`:

```html
<li>Iteration 2 adds relationship-agent core modules under <code>src/relationship/</code> so the current UI demo remains stable while the agent architecture is built.</li>
```

- [ ] **Step 8: Commit**

Run:

```bash
git add src/relationship/types.ts src/relationship/fixtures.ts src/relationship/types.test.ts implementation-notes.html
git commit -m "feat:add relationship agent domain model"
```

Expected: commit succeeds.

## Task 2: Add Deterministic Event Context Mapper

**Files:**
- Create: `src/relationship/eventMapper.ts`
- Create: `src/relationship/eventMapper.test.ts`

- [ ] **Step 1: Write failing mapper tests**

Create `src/relationship/eventMapper.test.ts`:

```ts
import { demoDetectedContact, demoLongEvent, demoShortEvent } from "./fixtures";
import { createCandidateId, mapCandidateToEvents } from "./eventMapper";

describe("event mapper", () => {
  it("ranks a short overlapping event above a long background event", () => {
    const candidateId = createCandidateId(demoDetectedContact);
    const matches = mapCandidateToEvents(candidateId, demoDetectedContact, [demoLongEvent, demoShortEvent]);

    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({
      calendarEventId: demoShortEvent.id,
      eventTitle: "Photon Residency Dinner",
      rank: 1
    });
    expect(matches[0].confidence).toBeGreaterThan(matches[1].confidence);
    expect(matches[1]).toMatchObject({
      calendarEventId: demoLongEvent.id,
      eventTitle: "Photon Residency",
      rank: 2
    });
  });

  it("returns no matches when no event window contains the detection time", () => {
    const candidateId = createCandidateId({
      ...demoDetectedContact,
      detectedAt: "2026-06-01T12:00:00-07:00"
    });

    const matches = mapCandidateToEvents(
      candidateId,
      { ...demoDetectedContact, detectedAt: "2026-06-01T12:00:00-07:00" },
      [demoLongEvent, demoShortEvent]
    );

    expect(matches).toEqual([]);
  });
});
```

- [ ] **Step 2: Run failing mapper tests**

Run:

```bash
npm test -- src/relationship/eventMapper.test.ts
```

Expected: FAIL because `eventMapper.ts` does not exist.

- [ ] **Step 3: Implement mapper**

Create `src/relationship/eventMapper.ts`:

```ts
import type { CalendarEvent, ContactCandidateDetected, EventContextMatch } from "./types";

const EVENT_KIND_CONFIDENCE = {
  short: 0.92,
  long: 0.62,
  all_day: 0.42
} as const;

const EVENT_KIND_RANK = {
  short: 1,
  long: 2,
  all_day: 3
} as const;

export function createCandidateId(contact: Pick<ContactCandidateDetected, "displayName" | "detectedAt">): string {
  return `candidate_${slug(contact.displayName)}_${new Date(contact.detectedAt).getTime()}`;
}

export function mapCandidateToEvents(
  candidateId: string,
  contact: ContactCandidateDetected,
  events: CalendarEvent[]
): EventContextMatch[] {
  const detectedAt = new Date(contact.detectedAt).getTime();
  const overlapping = events.filter((event) => {
    const startsAt = new Date(event.startsAt).getTime();
    const endsAt = new Date(event.endsAt).getTime();
    return startsAt <= detectedAt && detectedAt <= endsAt;
  });

  return overlapping
    .map((event) => ({
      id: `match_${candidateId}_${event.id}`,
      candidateId,
      calendarEventId: event.id,
      eventTitle: event.title,
      confidence: EVENT_KIND_CONFIDENCE[event.eventKind],
      reason: buildReason(event),
      rank: EVENT_KIND_RANK[event.eventKind]
    }))
    .sort((a, b) => a.rank - b.rank || b.confidence - a.confidence)
    .map((match, index) => ({ ...match, rank: index + 1 }));
}

function buildReason(event: CalendarEvent): string {
  if (event.eventKind === "short") {
    return `Detected during the specific event "${event.title}".`;
  }

  if (event.eventKind === "long") {
    return `Detected inside the longer background event "${event.title}".`;
  }

  return `Detected during the all-day event "${event.title}".`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
```

- [ ] **Step 4: Run mapper tests**

Run:

```bash
npm test -- src/relationship/eventMapper.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/relationship/eventMapper.ts src/relationship/eventMapper.test.ts
git commit -m "feat:add event context mapper"
```

Expected: commit succeeds.

## Task 3: Add In-Memory Relationship Repository

**Files:**
- Create: `src/relationship/repository.ts`
- Create: `src/relationship/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `src/relationship/repository.test.ts`:

```ts
import { demoDetectedContact, demoLongEvent, demoShortEvent, demoUser } from "./fixtures";
import { createRelationshipRepository } from "./repository";

describe("relationship repository", () => {
  it("creates a pending contact candidate with event matches", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });

    const candidate = repo.createCandidateFromDetectedContact(demoDetectedContact);
    const matches = repo.listEventMatches(candidate.id);

    expect(candidate.status).toBe("pending");
    expect(candidate.displayName).toBe("Maya Chen");
    expect(matches[0].eventTitle).toBe("Photon Residency Dinner");
  });

  it("confirms a candidate into a relationship memory", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });

    const candidate = repo.createCandidateFromDetectedContact(demoDetectedContact);
    const memory = repo.confirmCandidate(candidate.id, "recruiting agents, played piano", demoShortEvent.id);

    expect(repo.getCandidate(candidate.id)?.status).toBe("confirmed");
    expect(memory.displayName).toBe("Maya Chen");
    expect(memory.eventTitle).toBe("Photon Residency Dinner");
    expect(memory.tags).toContain("piano");
  });

  it("ignores a candidate without creating a memory", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });

    const candidate = repo.createCandidateFromDetectedContact(demoDetectedContact);
    repo.ignoreCandidate(candidate.id);

    expect(repo.getCandidate(candidate.id)?.status).toBe("ignored");
    expect(repo.listMemories()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run failing repository tests**

Run:

```bash
npm test -- src/relationship/repository.test.ts
```

Expected: FAIL because `repository.ts` does not exist.

- [ ] **Step 3: Implement repository**

Create `src/relationship/repository.ts`:

```ts
import { createCandidateId, mapCandidateToEvents } from "./eventMapper";
import type {
  CalendarEvent,
  ContactCandidate,
  ContactCandidateDetected,
  EventContextMatch,
  RelationshipMemory,
  User
} from "./types";

type RepositorySeed = {
  users?: User[];
  calendarEvents?: CalendarEvent[];
  candidates?: ContactCandidate[];
  eventMatches?: EventContextMatch[];
  memories?: RelationshipMemory[];
};

export type RelationshipRepository = ReturnType<typeof createRelationshipRepository>;

export function createRelationshipRepository(seed: RepositorySeed = {}) {
  const users = [...(seed.users ?? [])];
  const calendarEvents = [...(seed.calendarEvents ?? [])];
  const candidates = [...(seed.candidates ?? [])];
  const eventMatches = [...(seed.eventMatches ?? [])];
  const memories = [...(seed.memories ?? [])];

  return {
    listCalendarEvents(userId: string) {
      return calendarEvents.filter((event) => event.userId === userId);
    },

    createCandidateFromDetectedContact(contact: ContactCandidateDetected): ContactCandidate {
      const candidate: ContactCandidate = {
        ...contact,
        id: createCandidateId(contact),
        status: "pending"
      };

      candidates.push(candidate);
      eventMatches.push(...mapCandidateToEvents(candidate.id, contact, calendarEvents));
      return candidate;
    },

    listPendingCandidates(userId: string): ContactCandidate[] {
      return candidates.filter((candidate) => candidate.userId === userId && candidate.status === "pending");
    },

    getCandidate(candidateId: string): ContactCandidate | undefined {
      return candidates.find((candidate) => candidate.id === candidateId);
    },

    listEventMatches(candidateId: string): EventContextMatch[] {
      return eventMatches
        .filter((match) => match.candidateId === candidateId)
        .sort((a, b) => a.rank - b.rank);
    },

    confirmCandidate(candidateId: string, contextNote: string, eventId?: string): RelationshipMemory {
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }

      candidate.status = "confirmed";
      const selectedMatch = selectEventMatch(eventMatches, candidateId, eventId);
      const memory: RelationshipMemory = {
        id: `memory_${candidate.id}`,
        userId: candidate.userId,
        candidateId: candidate.id,
        displayName: candidate.displayName,
        primaryContactLabel: candidate.phoneNumbers[0] ?? candidate.emails[0] ?? "contact saved",
        eventId: selectedMatch?.calendarEventId,
        eventTitle: selectedMatch?.eventTitle,
        contextNote,
        tags: extractTags(contextNote),
        confidence: selectedMatch?.confidence ?? 0.5,
        createdAt: "2026-05-20T12:00:00.000Z",
        updatedAt: "2026-05-20T12:00:00.000Z"
      };

      memories.push(memory);
      return memory;
    },

    ignoreCandidate(candidateId: string): void {
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      candidate.status = "ignored";
    },

    listMemories(userId?: string): RelationshipMemory[] {
      return userId ? memories.filter((memory) => memory.userId === userId) : [...memories];
    },

    addMemory(memory: RelationshipMemory): RelationshipMemory {
      memories.push(memory);
      return memory;
    }
  };
}

export function extractTags(text: string): string[] {
  const stopWords = new Set(["about", "with", "from", "that", "this", "there", "their", "should", "person"]);
  const tags = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !stopWords.has(token));

  return Array.from(new Set(tags));
}

function selectEventMatch(matches: EventContextMatch[], candidateId: string, eventId?: string) {
  const candidateMatches = matches.filter((match) => match.candidateId === candidateId);
  if (eventId) {
    return candidateMatches.find((match) => match.calendarEventId === eventId);
  }
  return candidateMatches.sort((a, b) => a.rank - b.rank)[0];
}
```

- [ ] **Step 4: Run repository tests**

Run:

```bash
npm test -- src/relationship/repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/relationship/repository.ts src/relationship/repository.test.ts
git commit -m "feat:add relationship memory repository"
```

Expected: commit succeeds.

## Task 4: Add Bounded Agent Tools

**Files:**
- Create: `src/relationship/tools.ts`
- Create: `src/relationship/tools.test.ts`

- [ ] **Step 1: Write failing tool tests**

Create `src/relationship/tools.test.ts`:

```ts
import { demoDetectedContact, demoLongEvent, demoShortEvent, demoUser } from "./fixtures";
import { createRelationshipRepository } from "./repository";
import { createRelationshipTools } from "./tools";

describe("relationship tools", () => {
  it("lists and confirms pending candidates through bounded tools", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(demoDetectedContact);

    expect(tools.list_pending_candidates(demoUser.id)).toHaveLength(1);

    const memory = tools.confirm_candidate(
      demoUser.id,
      candidate.id,
      "recruiting agents, played piano",
      demoShortEvent.id
    );

    expect(memory.eventTitle).toBe("Photon Residency Dinner");
    expect(tools.list_pending_candidates(demoUser.id)).toHaveLength(0);
  });

  it("searches memories by vague context", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(demoDetectedContact);
    tools.confirm_candidate(demoUser.id, candidate.id, "recruiting agents, played piano", demoShortEvent.id);

    const results = tools.search_memories(demoUser.id, "who was the piano person from dinner");

    expect(results[0].memory.displayName).toBe("Maya Chen");
    expect(results[0].reason).toContain("piano");
  });
});
```

- [ ] **Step 2: Run failing tool tests**

Run:

```bash
npm test -- src/relationship/tools.test.ts
```

Expected: FAIL because `tools.ts` does not exist.

- [ ] **Step 3: Implement tools**

Create `src/relationship/tools.ts`:

```ts
import { extractTags, type RelationshipRepository } from "./repository";
import type { ContactCandidateDetected, RelationshipMemory } from "./types";

export type MemorySearchResult = {
  memory: RelationshipMemory;
  score: number;
  reason: string;
};

export function createRelationshipTools(repo: RelationshipRepository) {
  return {
    create_contact_candidate(contact: ContactCandidateDetected) {
      return repo.createCandidateFromDetectedContact(contact);
    },

    search_memories(userId: string, query: string): MemorySearchResult[] {
      const queryTags = extractTags(query);

      return repo
        .listMemories(userId)
        .map((memory) => scoreMemory(memory, queryTags, query))
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    },

    list_pending_candidates(userId: string) {
      return repo.listPendingCandidates(userId);
    },

    get_candidate(_userId: string, candidateId: string) {
      return repo.getCandidate(candidateId);
    },

    confirm_candidate(userId: string, candidateId: string, contextNote: string, eventId?: string) {
      const candidate = repo.getCandidate(candidateId);
      if (!candidate || candidate.userId !== userId) {
        throw new Error(`Candidate not found for user: ${candidateId}`);
      }
      return repo.confirmCandidate(candidateId, contextNote, eventId);
    },

    ignore_candidate(userId: string, candidateId: string) {
      const candidate = repo.getCandidate(candidateId);
      if (!candidate || candidate.userId !== userId) {
        throw new Error(`Candidate not found for user: ${candidateId}`);
      }
      repo.ignoreCandidate(candidateId);
      return { ignored: true };
    },

    create_manual_memory(userId: string, name: string, contextNote: string, contactMethod = "manual contact") {
      const memory: RelationshipMemory = {
        id: `memory_manual_${Date.now()}`,
        userId,
        displayName: name,
        primaryContactLabel: contactMethod,
        contextNote,
        tags: extractTags(contextNote),
        confidence: 0.6,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      return repo.addMemory(memory);
    }
  };
}

function scoreMemory(memory: RelationshipMemory, queryTags: string[], rawQuery: string): MemorySearchResult {
  const haystack = [memory.displayName, memory.eventTitle ?? "", memory.contextNote, memory.tags.join(" ")]
    .join(" ")
    .toLowerCase();
  const matched = queryTags.filter((tag) => haystack.includes(tag));
  const eventBoost = memory.eventTitle && rawQuery.toLowerCase().includes("dinner") ? 2 : 0;
  const score = matched.length * 3 + eventBoost;

  return {
    memory,
    score,
    reason:
      matched.length > 0
        ? `Your saved note says "${memory.contextNote}" and matched: ${matched.join(", ")}.`
        : `This matched the event "${memory.eventTitle ?? "unknown"}".`
  };
}
```

- [ ] **Step 4: Run tool tests**

Run:

```bash
npm test -- src/relationship/tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/relationship/tools.ts src/relationship/tools.test.ts
git commit -m "feat:add relationship agent tools"
```

Expected: commit succeeds.

## Task 5: Add Relationship Agent Core

**Files:**
- Create: `src/relationship/agentCore.ts`
- Create: `src/relationship/agentCore.test.ts`

- [ ] **Step 1: Write failing agent core tests**

Create `src/relationship/agentCore.test.ts`:

```ts
import { ambiguousDinnerMemory, demoDetectedContact, demoLongEvent, demoShortEvent, demoUser } from "./fixtures";
import { createRelationshipAgent } from "./agentCore";
import { createRelationshipRepository } from "./repository";
import { createRelationshipTools } from "./tools";

describe("relationship agent core", () => {
  it("confirms a pending candidate from a natural yes reply", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(demoDetectedContact);
    const agent = createRelationshipAgent(tools);

    const result = agent.handleMessage({
      userId: demoUser.id,
      platform: "terminal",
      text: "yes, recruiting agents, played piano",
      receivedAt: "2026-05-20T12:00:00.000Z"
    });

    expect(result.toolCalls).toContain("list_pending_candidates");
    expect(result.toolCalls).toContain("confirm_candidate");
    expect(result.outbound.text).toContain("Saved");
    expect(result.outbound.text).toContain("Maya Chen");
    expect(repo.getCandidate(candidate.id)?.status).toBe("confirmed");
  });

  it("searches saved memories and returns a confident match", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(demoDetectedContact);
    tools.confirm_candidate(demoUser.id, candidate.id, "recruiting agents, played piano", demoShortEvent.id);
    const agent = createRelationshipAgent(tools);

    const result = agent.handleMessage({
      userId: demoUser.id,
      platform: "terminal",
      text: "who was the piano person from dinner",
      receivedAt: "2026-05-20T12:05:00.000Z"
    });

    expect(result.toolCalls).toContain("search_memories");
    expect(result.outbound.text).toContain("Likely Maya Chen");
    expect(result.outbound.text).toContain("played piano");
  });

  it("asks a clarification question when search confidence is close", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent],
      memories: [ambiguousDinnerMemory]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(demoDetectedContact);
    tools.confirm_candidate(demoUser.id, candidate.id, "recruiting agents, dinner table", demoShortEvent.id);
    const agent = createRelationshipAgent(tools);

    const result = agent.handleMessage({
      userId: demoUser.id,
      platform: "terminal",
      text: "who was the person from dinner",
      receivedAt: "2026-05-20T12:10:00.000Z"
    });

    expect(result.outbound.text).toContain("I found two");
    expect(result.outbound.text).toContain("Which dinner");
  });
});
```

- [ ] **Step 2: Run failing agent core tests**

Run:

```bash
npm test -- src/relationship/agentCore.test.ts
```

Expected: FAIL because `agentCore.ts` does not exist.

- [ ] **Step 3: Implement agent core**

Create `src/relationship/agentCore.ts`:

```ts
import type { AgentCoreResult, AgentToolCall, InboundAgentMessage } from "./types";
import type { MemorySearchResult, createRelationshipTools } from "./tools";

type RelationshipTools = ReturnType<typeof createRelationshipTools>;

export function createRelationshipAgent(tools: RelationshipTools) {
  return {
    handleMessage(message: InboundAgentMessage): AgentCoreResult {
      const normalized = message.text.trim();
      const lower = normalized.toLowerCase();
      const toolCalls: AgentToolCall[] = [];

      if (isConfirmationReply(lower)) {
        toolCalls.push("list_pending_candidates");
        const candidates = tools.list_pending_candidates(message.userId);
        const candidate = candidates[0];

        if (!candidate) {
          return reply(message, "I do not see a pending contact to confirm.", toolCalls);
        }

        const contextNote = cleanConfirmationNote(normalized);
        toolCalls.push("confirm_candidate");
        const memory = tools.confirm_candidate(message.userId, candidate.id, contextNote);

        return reply(
          message,
          `Saved. I'll remember ${memory.displayName} from ${memory.eventTitle ?? "that context"} as "${memory.contextNote}".`,
          toolCalls
        );
      }

      if (lower.startsWith("ignore")) {
        toolCalls.push("list_pending_candidates");
        const candidates = tools.list_pending_candidates(message.userId);
        const candidate = candidates[0];
        if (!candidate) {
          return reply(message, "I do not see a pending contact to ignore.", toolCalls);
        }

        toolCalls.push("ignore_candidate");
        tools.ignore_candidate(message.userId, candidate.id);
        return reply(message, `Ignored ${candidate.displayName}.`, toolCalls);
      }

      if (looksLikeManualMemory(lower)) {
        const parsed = parseManualMemory(normalized);
        toolCalls.push("create_manual_memory");
        const memory = tools.create_manual_memory(message.userId, parsed.name, parsed.contextNote, parsed.contactMethod);
        return reply(message, `Saved. I'll remember ${memory.displayName} as "${memory.contextNote}".`, toolCalls);
      }

      toolCalls.push("search_memories");
      const matches = tools.search_memories(message.userId, normalized);

      if (matches.length === 0) {
        return reply(
          message,
          "I do not have a confident match yet. Give me a name, event, date, or context you remember.",
          toolCalls
        );
      }

      if (isAmbiguous(matches)) {
        const names = matches.slice(0, 2).map((match) => `${match.memory.displayName} from ${match.memory.eventTitle}`);
        return reply(message, `I found two possible matches: ${names.join(" and ")}. Which dinner do you mean?`, toolCalls);
      }

      const top = matches[0];
      return reply(
        message,
        `Likely ${top.memory.displayName}. ${top.reason} Contact: ${top.memory.primaryContactLabel}.`,
        toolCalls
      );
    }
  };
}

export function buildCandidateReviewPrompt(name: string, eventTitle?: string): string {
  if (eventTitle) {
    return `I noticed you added ${name} during ${eventTitle}. Did you meet ${name} there?`;
  }

  return `I noticed you added ${name}. Where did you meet them?`;
}

function reply(message: InboundAgentMessage, text: string, toolCalls: AgentToolCall[]): AgentCoreResult {
  return {
    outbound: {
      userId: message.userId,
      platform: message.platform,
      spaceId: message.spaceId,
      text
    },
    toolCalls
  };
}

function isConfirmationReply(value: string): boolean {
  return value === "yes" || value.startsWith("yes,") || value.startsWith("yep") || value.startsWith("yeah");
}

function cleanConfirmationNote(value: string): string {
  return value.replace(/^(yes|yep|yeah)\s*,?\s*/i, "").trim() || "met at event";
}

function looksLikeManualMemory(value: string): boolean {
  return value.startsWith("met ") || value.startsWith("remember ");
}

function parseManualMemory(value: string) {
  const cleaned = value.replace(/^(met|remember)\s+/i, "");
  const [namePart, ...contextParts] = cleaned.split(",");
  return {
    name: namePart.trim(),
    contextNote: contextParts.join(",").trim() || "manual memory",
    contactMethod: undefined
  };
}

function isAmbiguous(matches: MemorySearchResult[]): boolean {
  if (matches.length < 2) {
    return false;
  }
  return matches[0].score - matches[1].score <= 2;
}
```

- [ ] **Step 4: Run agent core tests**

Run:

```bash
npm test -- src/relationship/agentCore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/relationship/agentCore.ts src/relationship/agentCore.test.ts
git commit -m "feat:add relationship agent core"
```

Expected: commit succeeds.

## Task 6: Add Terminal Transport And Demo Runner

**Files:**
- Create: `src/relationship/transports/terminalTransport.ts`
- Create: `src/relationship/transports/terminalTransport.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`

- [ ] **Step 1: Install terminal runtime dependencies**

Run:

```bash
npm install --save-dev tsx @types/node
```

Expected: `package.json` and `package-lock.json` update successfully.

- [ ] **Step 2: Add Node types to TypeScript config**

Modify `tsconfig.json` so `compilerOptions.types` includes both Vitest globals and Node:

```json
"types": ["vitest/globals", "node"]
```

- [ ] **Step 3: Write failing terminal transport test**

Create `src/relationship/transports/terminalTransport.test.ts`:

```ts
import { demoDetectedContact, demoLongEvent, demoShortEvent, demoUser } from "../fixtures";
import { createRelationshipAgent } from "../agentCore";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import { createTerminalHarness } from "./terminalTransport";

describe("terminal transport harness", () => {
  it("normalizes terminal text into agent messages", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });
    const tools = createRelationshipTools(repo);
    tools.create_contact_candidate(demoDetectedContact);
    const agent = createRelationshipAgent(tools);
    const harness = createTerminalHarness(agent, demoUser.id);

    const result = harness.send("yes, recruiting agents, played piano");

    expect(result.outbound.platform).toBe("terminal");
    expect(result.outbound.text).toContain("Saved");
  });
});
```

- [ ] **Step 4: Run failing terminal test**

Run:

```bash
npm test -- src/relationship/transports/terminalTransport.test.ts
```

Expected: FAIL because `terminalTransport.ts` does not exist.

- [ ] **Step 5: Implement terminal transport**

Create `src/relationship/transports/terminalTransport.ts`:

```ts
import { createRelationshipAgent } from "../agentCore";
import { demoDetectedContact, demoLongEvent, demoShortEvent, demoUser } from "../fixtures";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import type { AgentCoreResult } from "../types";

type RelationshipAgent = ReturnType<typeof createRelationshipAgent>;

export function createTerminalHarness(agent: RelationshipAgent, userId: string) {
  return {
    send(text: string): AgentCoreResult {
      return agent.handleMessage({
        userId,
        platform: "terminal",
        text,
        receivedAt: new Date().toISOString()
      });
    }
  };
}

export function createDemoTerminalHarness() {
  const repo = createRelationshipRepository({
    users: [demoUser],
    calendarEvents: [demoLongEvent, demoShortEvent]
  });
  const tools = createRelationshipTools(repo);
  const candidate = tools.create_contact_candidate(demoDetectedContact);
  const agent = createRelationshipAgent(tools);
  const harness = createTerminalHarness(agent, demoUser.id);

  return {
    repo,
    tools,
    candidate,
    firstPrompt: `I noticed you added ${candidate.displayName} during Photon Residency Dinner. Did you meet ${candidate.displayName} there?`,
    harness
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const demo = createDemoTerminalHarness();
  console.log(demo.firstPrompt);
  const input = process.argv.slice(2).join(" ") || "yes, recruiting agents, played piano";
  const result = demo.harness.send(input);
  console.log(result.outbound.text);
}
```

- [ ] **Step 6: Add package script**

Modify `package.json` scripts to include:

```json
"agent:terminal": "tsx src/relationship/transports/terminalTransport.ts"
```

The scripts block should still include existing `dev`, `build`, `test`, and `test:watch` scripts.

- [ ] **Step 7: Run terminal transport tests**

Run:

```bash
npm test -- src/relationship/transports/terminalTransport.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run terminal demo**

Run:

```bash
npm run agent:terminal -- "yes, recruiting agents, played piano"
```

Expected output includes:

```text
I noticed you added Maya Chen during Photon Residency Dinner. Did you meet Maya Chen there?
Saved. I'll remember Maya Chen from Photon Residency Dinner as "recruiting agents, played piano."
```

- [ ] **Step 9: Commit**

Run:

```bash
git add package.json package-lock.json tsconfig.json src/relationship/transports/terminalTransport.ts src/relationship/transports/terminalTransport.test.ts
git commit -m "feat:add terminal relationship agent transport"
```

Expected: commit succeeds.

## Task 7: Add Spectrum Transport Scaffold

**Files:**
- Create: `src/relationship/transports/spectrumTransport.ts`
- Create: `src/relationship/transports/spectrumTransport.test.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Install Spectrum SDK**

Run:

```bash
npm install spectrum-ts
```

Expected: `package.json` and `package-lock.json` update successfully.

- [ ] **Step 2: Add environment template**

Create `.env.example`:

```bash
SPECTRUM_PROJECT_ID=
SPECTRUM_PROJECT_SECRET=
FRIENDY_AGENT_NUMBER=+14156056081
```

- [ ] **Step 3: Write failing Spectrum adapter test**

Create `src/relationship/transports/spectrumTransport.test.ts`:

```ts
import { toInboundAgentMessage } from "./spectrumTransport";

describe("spectrum transport", () => {
  it("normalizes Spectrum message text into an inbound agent message", () => {
    const inbound = toInboundAgentMessage({
      userId: "user_demo",
      text: "who was the piano person",
      spaceId: "space_123",
      receivedAt: "2026-05-20T12:00:00.000Z"
    });

    expect(inbound).toEqual({
      userId: "user_demo",
      platform: "imessage",
      spaceId: "space_123",
      text: "who was the piano person",
      receivedAt: "2026-05-20T12:00:00.000Z"
    });
  });
});
```

- [ ] **Step 4: Run failing Spectrum adapter test**

Run:

```bash
npm test -- src/relationship/transports/spectrumTransport.test.ts
```

Expected: FAIL because `spectrumTransport.ts` does not exist.

- [ ] **Step 5: Implement Spectrum adapter scaffold**

Create `src/relationship/transports/spectrumTransport.ts`:

```ts
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { createRelationshipAgent } from "../agentCore";
import { demoLongEvent, demoShortEvent, demoUser } from "../fixtures";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import type { InboundAgentMessage } from "../types";

export type SpectrumInboundInput = {
  userId: string;
  text: string;
  spaceId?: string;
  receivedAt: string;
};

export function toInboundAgentMessage(input: SpectrumInboundInput): InboundAgentMessage {
  return {
    userId: input.userId,
    platform: "imessage",
    spaceId: input.spaceId,
    text: input.text,
    receivedAt: input.receivedAt
  };
}

export async function startSpectrumFriendyAgent() {
  const projectId = process.env.SPECTRUM_PROJECT_ID;
  const projectSecret = process.env.SPECTRUM_PROJECT_SECRET;

  if (!projectId || !projectSecret) {
    throw new Error("Missing SPECTRUM_PROJECT_ID or SPECTRUM_PROJECT_SECRET.");
  }

  const repo = createRelationshipRepository({
    users: [demoUser],
    calendarEvents: [demoLongEvent, demoShortEvent]
  });
  const tools = createRelationshipTools(repo);
  const agent = createRelationshipAgent(tools);

  const app = await Spectrum({
    projectId,
    projectSecret,
    providers: [imessage.config()]
  });

  for await (const [space, message] of app.messages) {
    await space.responding(async () => {
      const inbound = toInboundAgentMessage({
        userId: demoUser.id,
        text: message.text,
        spaceId: space.id,
        receivedAt: new Date().toISOString()
      });
      const result = agent.handleMessage(inbound);
      await message.reply(result.outbound.text);
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startSpectrumFriendyAgent().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
```

- [ ] **Step 6: Add package script**

Modify `package.json` scripts to include:

```json
"agent:spectrum": "tsx src/relationship/transports/spectrumTransport.ts"
```

- [ ] **Step 7: Run Spectrum adapter test**

Run:

```bash
npm test -- src/relationship/transports/spectrumTransport.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run build**

Run:

```bash
npm run build
```

Expected: PASS. If TypeScript fails because the Spectrum SDK exposes slightly different `space` or `message` field names, inspect the installed SDK types in `node_modules/spectrum-ts`, update only `spectrumTransport.ts`, and record the SDK-specific adjustment in `implementation-notes.html`.

- [ ] **Step 9: Update README**

Add:

````md
## Relationship Agent Core

Run the local terminal agent demo:

```bash
npm run agent:terminal -- "yes, recruiting agents, played piano"
```

Run the Spectrum/iMessage agent when Spectrum credentials are available:

```bash
cp .env.example .env
npm run agent:spectrum
```

The agent number for the first iMessage channel is `+14156056081`.
````

- [ ] **Step 10: Commit**

Run:

```bash
git add package.json package-lock.json .env.example README.md src/relationship/transports/spectrumTransport.ts src/relationship/transports/spectrumTransport.test.ts
git commit -m "feat:add spectrum relationship agent transport"
```

Expected: commit succeeds.

## Task 8: Add Candidate Review Prompt And Search Demo Coverage

**Files:**
- Modify: `src/relationship/agentCore.ts`
- Modify: `src/relationship/agentCore.test.ts`
- Modify: `src/relationship/transports/terminalTransport.ts`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Add failing proactive prompt test**

Append to `src/relationship/agentCore.test.ts`:

```ts
import { buildCandidateReviewPrompt } from "./agentCore";

describe("candidate review prompt", () => {
  it("builds the proactive candidate review prompt for the top event match", () => {
    const prompt = buildCandidateReviewPrompt("Maya Chen", "Photon Residency Dinner");

    expect(prompt).toBe("I noticed you added Maya Chen during Photon Residency Dinner. Did you meet Maya Chen there?");
  });
});
```

- [ ] **Step 2: Run prompt test**

Run:

```bash
npm test -- src/relationship/agentCore.test.ts
```

Expected: PASS if Task 5 already exported `buildCandidateReviewPrompt`; otherwise FAIL and update `agentCore.ts` with the exported function from Task 5.

- [ ] **Step 3: Update terminal demo to use prompt builder**

Modify `src/relationship/transports/terminalTransport.ts` import:

```ts
import { buildCandidateReviewPrompt, createRelationshipAgent } from "../agentCore";
```

Modify `firstPrompt` in `createDemoTerminalHarness`:

```ts
firstPrompt: buildCandidateReviewPrompt(candidate.displayName, "Photon Residency Dinner"),
```

- [ ] **Step 4: Update implementation notes**

Add this list item under `Implementation Decisions`:

```html
<li>The Spectrum adapter is a transport wrapper around the relationship agent core; the agent core remains usable through terminal tests without Spectrum credentials.</li>
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- src/relationship/agentCore.test.ts src/relationship/transports/terminalTransport.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/relationship/agentCore.ts src/relationship/agentCore.test.ts src/relationship/transports/terminalTransport.ts implementation-notes.html
git commit -m "test:add relationship agent demo coverage"
```

Expected: commit succeeds.

## Task 9: Full Verification And Documentation Update

**Files:**
- Modify: `README.md`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: all test files pass.

- [ ] **Step 2: Run the production build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite production build pass.

- [ ] **Step 3: Run terminal agent demo**

Run:

```bash
npm run agent:terminal -- "yes, recruiting agents, played piano"
```

Expected output includes:

```text
Saved. I'll remember Maya Chen from Photon Residency Dinner as "recruiting agents, played piano."
```

- [ ] **Step 4: Record verification in implementation notes**

Add a new `Verification` list item:

```html
<li>Ran <code>npm test</code>, <code>npm run build</code>, and <code>npm run agent:terminal</code> after adding the relationship agent core.</li>
```

- [ ] **Step 5: Commit verification docs**

Run:

```bash
git add README.md implementation-notes.html
git commit -m "docs:record relationship agent verification"
```

Expected: commit succeeds if either file changed. If neither file changed, skip this commit and record that no documentation changes were needed.

## Self-Review Checklist

- Spec coverage:
  - Newly-added contact candidates: Task 1, Task 3, Task 4.
  - Calendar context mapping: Task 2.
  - Short event ranked above long event: Task 2.
  - Candidate confirmation/ignore: Task 3, Task 4, Task 5.
  - Vague memory search: Task 4, Task 5.
  - Low-confidence clarification: Task 5.
  - One agent with multiple small tools: Task 4 and Task 5.
  - Spectrum as transport adapter: Task 7.
  - Terminal fallback: Task 6.
  - No native Contacts/Calendar, Gmail, Notion, Mem0, Membase, graph UI, or multiple agents: all tasks avoid these.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps.
- Type consistency:
  - `ContactCandidateDetected`, `CalendarEvent`, `EventContextMatch`, `RelationshipMemory`, `InboundAgentMessage`, and `AgentCoreResult` are defined in Task 1 and reused consistently.
  - Tool names match the approved spec.
  - `createRelationshipRepository`, `createRelationshipTools`, and `createRelationshipAgent` signatures are stable across tests and implementation tasks.
