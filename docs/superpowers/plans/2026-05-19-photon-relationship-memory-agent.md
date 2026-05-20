# Photon Relationship Memory Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Photon Relationship Memory Agent product flow that shows the approved event-window memory loop with mocked calendar/contact data, confirmation, context capture, and vague recall search.

**Architecture:** Create a greenfield Vite + React + TypeScript app in `Friendy`. Keep product behavior in small pure modules: typed domain objects, seeded product flow data, an in-memory store, and a deterministic agent/search engine. The UI is a chat-style Photon surface plus compact panels for the event session, candidate queue, and saved memories.

**Tech Stack:** Vite, React, TypeScript, Vitest, Testing Library, local browser state.

---

## File Structure

- Create `Friendy/package.json`: scripts and dependencies.
- Create `Friendy/index.html`: Vite entry document.
- Create `Friendy/tsconfig.json`, `Friendy/tsconfig.node.json`, `Friendy/vite.config.ts`: TypeScript and Vite configuration.
- Create `Friendy/src/types.ts`: shared domain types from the spec.
- Create `Friendy/src/mockData.ts`: fixed product flow user, calendar event, baseline contacts, and contact delta.
- Create `Friendy/src/memoryStore.ts`: deterministic state transitions for sessions, candidates, memories, and interactions.
- Create `Friendy/src/agent.ts`: Photon-style message handling, confirmation flow, context capture, and search.
- Create `Friendy/src/App.tsx`: chat UI and product flow panels.
- Create `Friendy/src/main.tsx`: React app entry.
- Create `Friendy/src/styles.css`: responsive app styling.
- Create `Friendy/src/*.test.ts`: focused unit tests for store and agent behavior.
- Create `Friendy/implementation-notes.html`: running implementation notes required by `/home/thien/AGENTS.md`.

## Task 1: Scaffold Product Flow App

**Files:**
- Create: `Friendy/package.json`
- Create: `Friendy/index.html`
- Create: `Friendy/tsconfig.json`
- Create: `Friendy/tsconfig.node.json`
- Create: `Friendy/vite.config.ts`
- Create: `Friendy/src/main.tsx`
- Create: `Friendy/src/App.tsx`
- Create: `Friendy/src/styles.css`
- Create: `Friendy/implementation-notes.html`

- [ ] **Step 1: Create the project directory**

Run:

```bash
mkdir -p /home/thien/Friendy/src
```

Expected: command exits with status `0`.

- [ ] **Step 2: Create `package.json`**

Add:

```json
{
  "name": "Friendy",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^5.0.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "jsdom": "^26.0.0",
    "typescript": "^5.8.0",
    "vite": "^7.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Create Vite and TypeScript config**

Add `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vitest/globals"],
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

Add `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

Add `vite.config.ts`:

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: []
  }
});
```

- [ ] **Step 4: Create the HTML entry point**

Add `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Photon Relationship Memory Agent</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create a minimal React app**

Add `src/App.tsx`:

```tsx
import "./styles.css";

export function App() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Photon product flow</p>
        <h1>Relationship Memory Agent</h1>
        <p>
          Photon helps you remember and refind people you met during approved
          event windows.
        </p>
      </section>
    </main>
  );
}
```

Add `src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

Add `src/styles.css`:

```css
:root {
  color: #1b1f24;
  background: #f5f7fa;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

.shell {
  min-height: 100vh;
  padding: 40px 20px;
}

.hero {
  max-width: 760px;
  margin: 0 auto;
}

.eyebrow {
  color: #0f766e;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1 {
  margin: 8px 0 12px;
  font-size: 48px;
  line-height: 1.05;
}
```

- [ ] **Step 6: Create implementation notes**

Add `implementation-notes.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Photon Memory Product Flow Implementation Notes</title>
  </head>
  <body>
    <h1>Implementation Notes</h1>
    <ul>
      <li>Initial build target is a local web product flow with mocked contact and calendar signals.</li>
      <li>Native Contacts and Calendar integrations are intentionally deferred.</li>
    </ul>
  </body>
</html>
```

- [ ] **Step 7: Install dependencies**

Run:

```bash
cd /home/thien/Friendy
npm install
```

Expected: dependencies install successfully and `package-lock.json` is created.

- [ ] **Step 8: Run the build**

Run:

```bash
cd /home/thien/Friendy
npm run build
```

Expected: TypeScript and Vite build complete without errors.

- [ ] **Step 9: Commit**

Run:

```bash
cd /home/thien
git add Friendy docs/superpowers
git commit -m "chore: scaffold photon memory product flow"
```

Expected: commit succeeds if `/home/thien` is a Git repo. If it is not a Git repo, record that in `implementation-notes.html` and continue without committing.

## Task 2: Add Domain Types And Mock Data

**Files:**
- Create: `Friendy/src/types.ts`
- Create: `Friendy/src/mockData.ts`
- Create: `Friendy/src/mockData.test.ts`
- Modify: `Friendy/implementation-notes.html`

- [ ] **Step 1: Write failing mock data test**

Add `src/mockData.test.ts`:

```ts
import { fixtureCalendarEvent, fixtureContactDelta, fixtureUser } from "./mockData";

describe("mock data", () => {
  it("contains a Photon dinner and at least one new contact candidate", () => {
    expect(fixtureUser.name).toBe("Thien");
    expect(fixtureCalendarEvent.title).toBe("Photon Residency Dinner");
    expect(fixtureContactDelta).toHaveLength(3);
    expect(fixtureContactDelta[0].displayName).toBe("Maya Chen");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/thien/Friendy
npm test -- src/mockData.test.ts
```

Expected: fail because `src/mockData.ts` does not exist.

- [ ] **Step 3: Add domain types**

Add `src/types.ts`:

```ts
export type User = {
  id: string;
  name: string;
  phoneNumber?: string;
  createdAt: string;
};

export type CalendarEvent = {
  id: string;
  userId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  source: "mock_calendar" | "native_calendar";
};

export type MemorySession = {
  id: string;
  userId: string;
  calendarEventId?: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "suggested" | "active" | "review_ready" | "completed" | "declined";
  createdAt: string;
};

export type CandidateConnection = {
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

export type RelationshipMemory = {
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

export type AgentInteraction = {
  id: string;
  userId: string;
  kind: "event_prompt" | "candidate_review" | "context_capture" | "memory_search" | "follow_up_draft";
  input: string;
  response: string;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  createdAt: string;
};
```

- [ ] **Step 4: Add mock data**

Add `src/mockData.ts`:

```ts
import type { CalendarEvent, CandidateConnection, User } from "./types";

export const fixtureUser: User = {
  id: "user_thien",
  name: "Thien",
  phoneNumber: "+15550101010",
  createdAt: "2026-05-19T09:00:00.000Z"
};

export const fixtureCalendarEvent: CalendarEvent = {
  id: "event_photon_dinner",
  userId: fixtureUser.id,
  title: "Photon Residency Dinner",
  startsAt: "2026-05-15T19:00:00.000Z",
  endsAt: "2026-05-15T23:00:00.000Z",
  location: "San Francisco",
  source: "mock_calendar"
};

export const fixtureContactDelta: CandidateConnection[] = [
  {
    id: "candidate_maya",
    userId: fixtureUser.id,
    displayName: "Maya Chen",
    phoneNumber: "+15550101020",
    source: "mock_contact_delta",
    detectedAt: "2026-05-15T23:20:00.000Z",
    status: "pending"
  },
  {
    id: "candidate_alex",
    userId: fixtureUser.id,
    displayName: "Alex Rivera",
    phoneNumber: "+15550101021",
    source: "mock_contact_delta",
    detectedAt: "2026-05-15T23:25:00.000Z",
    status: "pending"
  },
  {
    id: "candidate_priya",
    userId: fixtureUser.id,
    displayName: "Priya Shah",
    email: "priya@example.com",
    source: "mock_contact_delta",
    detectedAt: "2026-05-15T23:31:00.000Z",
    status: "pending"
  }
];
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
cd /home/thien/Friendy
npm test -- src/mockData.test.ts
```

Expected: pass.

- [ ] **Step 6: Update implementation notes**

Append to `implementation-notes.html`:

```html
<h2>Mock Data Decision</h2>
<p>
  The product flow uses a fixed Photon Residency Dinner calendar event and three mocked
  contact deltas. This keeps the agent loop testable before native iOS signal
  capture exists.
</p>
```

- [ ] **Step 7: Commit**

Run:

```bash
cd /home/thien
git add Friendy docs/superpowers
git commit -m "feat: add photon memory product flow domain data"
```

Expected: commit succeeds if `/home/thien` is a Git repo. If it is not a Git repo, record that in `implementation-notes.html` and continue.

## Task 3: Implement Memory Store

**Files:**
- Create: `Friendy/src/memoryStore.ts`
- Create: `Friendy/src/memoryStore.test.ts`
- Modify: `Friendy/implementation-notes.html`

- [ ] **Step 1: Write failing store tests**

Add `src/memoryStore.test.ts`:

```ts
import { fixtureCalendarEvent, fixtureContactDelta, fixtureUser } from "./mockData";
import { createInitialState, approveSession, loadContactDelta, confirmCandidate, ignoreCandidate } from "./memoryStore";

describe("memory store", () => {
  it("approves a calendar-backed memory session", () => {
    const state = createInitialState(fixtureUser, fixtureCalendarEvent);
    const next = approveSession(state, fixtureCalendarEvent.id);

    expect(next.sessions[0].status).toBe("active");
    expect(next.sessions[0].title).toBe("Photon Residency Dinner");
  });

  it("loads contact deltas into the approved session", () => {
    const state = approveSession(createInitialState(fixtureUser, fixtureCalendarEvent), fixtureCalendarEvent.id);
    const next = loadContactDelta(state, fixtureContactDelta);

    expect(next.candidates).toHaveLength(3);
    expect(next.candidates.every((candidate) => candidate.memorySessionId === "session_event_photon_dinner")).toBe(true);
  });

  it("confirms a candidate into a relationship memory with extracted tags", () => {
    const state = loadContactDelta(
      approveSession(createInitialState(fixtureUser, fixtureCalendarEvent), fixtureCalendarEvent.id),
      fixtureContactDelta
    );

    const next = confirmCandidate(state, "candidate_maya", "played piano, AI recruiting founder, follow up about product flow");

    expect(next.candidates.find((candidate) => candidate.id === "candidate_maya")?.status).toBe("confirmed");
    expect(next.memories).toHaveLength(1);
    expect(next.memories[0].displayName).toBe("Maya Chen");
    expect(next.memories[0].tags).toEqual(["played", "piano", "ai", "recruiting", "founder", "follow", "product flow"]);
  });

  it("ignores a candidate without creating a memory", () => {
    const state = loadContactDelta(
      approveSession(createInitialState(fixtureUser, fixtureCalendarEvent), fixtureCalendarEvent.id),
      fixtureContactDelta
    );

    const next = ignoreCandidate(state, "candidate_alex");

    expect(next.candidates.find((candidate) => candidate.id === "candidate_alex")?.status).toBe("ignored");
    expect(next.memories).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /home/thien/Friendy
npm test -- src/memoryStore.test.ts
```

Expected: fail because `memoryStore.ts` does not exist.

- [ ] **Step 3: Implement store**

Add `src/memoryStore.ts`:

```ts
import type { CalendarEvent, CandidateConnection, MemorySession, RelationshipMemory, User } from "./types";

export type MemoryState = {
  user: User;
  calendarEvents: CalendarEvent[];
  sessions: MemorySession[];
  candidates: CandidateConnection[];
  memories: RelationshipMemory[];
};

const STOP_WORDS = new Set(["about", "with", "from", "that", "this", "there", "their", "should"]);

export function createInitialState(user: User, calendarEvent: CalendarEvent): MemoryState {
  return {
    user,
    calendarEvents: [calendarEvent],
    sessions: [
      {
        id: `session_${calendarEvent.id}`,
        userId: user.id,
        calendarEventId: calendarEvent.id,
        title: calendarEvent.title,
        startsAt: calendarEvent.startsAt,
        endsAt: calendarEvent.endsAt,
        status: "suggested",
        createdAt: "2026-05-19T09:00:00.000Z"
      }
    ],
    candidates: [],
    memories: []
  };
}

export function approveSession(state: MemoryState, calendarEventId: string): MemoryState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.calendarEventId === calendarEventId ? { ...session, status: "active" } : session
    )
  };
}

export function loadContactDelta(state: MemoryState, candidates: CandidateConnection[]): MemoryState {
  const activeSession = state.sessions.find((session) => session.status === "active");
  if (!activeSession) {
    return state;
  }

  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === activeSession.id ? { ...session, status: "review_ready" } : session
    ),
    candidates: candidates.map((candidate) => ({
      ...candidate,
      memorySessionId: activeSession.id,
      status: "pending"
    }))
  };
}

export function confirmCandidate(state: MemoryState, candidateId: string, contextNote: string): MemoryState {
  const candidate = state.candidates.find((item) => item.id === candidateId);
  if (!candidate) {
    return state;
  }

  const session = state.sessions.find((item) => item.id === candidate.memorySessionId);
  const contactLabel = candidate.phoneNumber ?? candidate.email ?? "contact saved";
  const memory: RelationshipMemory = {
    id: `memory_${candidate.id}`,
    userId: candidate.userId,
    candidateConnectionId: candidate.id,
    memorySessionId: candidate.memorySessionId,
    displayName: candidate.displayName,
    contactLabel,
    eventTitle: session?.title,
    contextNote,
    tags: extractTags(contextNote),
    confirmedAt: "2026-05-19T09:30:00.000Z"
  };

  return {
    ...state,
    candidates: state.candidates.map((item) =>
      item.id === candidateId ? { ...item, status: "confirmed" } : item
    ),
    memories: [...state.memories.filter((item) => item.candidateConnectionId !== candidateId), memory]
  };
}

export function ignoreCandidate(state: MemoryState, candidateId: string): MemoryState {
  return {
    ...state,
    candidates: state.candidates.map((candidate) =>
      candidate.id === candidateId ? { ...candidate, status: "ignored" } : candidate
    )
  };
}

export function extractTags(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

  return Array.from(new Set(tokens));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd /home/thien/Friendy
npm test -- src/memoryStore.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
cd /home/thien
git add Friendy
git commit -m "feat: add relationship memory store"
```

Expected: commit succeeds if `/home/thien` is a Git repo. If it is not a Git repo, record that in `implementation-notes.html` and continue.

## Task 4: Implement Photon Agent Logic

**Files:**
- Create: `Friendy/src/agent.ts`
- Create: `Friendy/src/agent.test.ts`
- Modify: `Friendy/implementation-notes.html`

- [ ] **Step 1: Write failing agent tests**

Add `src/agent.test.ts`:

```ts
import { fixtureCalendarEvent, fixtureContactDelta, fixtureUser } from "./mockData";
import { createInitialState } from "./memoryStore";
import { handleAgentMessage, searchMemories } from "./agent";

describe("Photon agent", () => {
  it("asks to start a memory session for the calendar event", () => {
    const state = createInitialState(fixtureUser, fixtureCalendarEvent);
    const result = handleAgentMessage(state, "start");

    expect(result.reply).toContain("Photon Residency Dinner");
    expect(result.reply).toContain("Want me to remember");
  });

  it("approves the session and loads the contact review queue", () => {
    const state = createInitialState(fixtureUser, fixtureCalendarEvent);
    const result = handleAgentMessage(state, "yes");

    expect(result.state.sessions[0].status).toBe("review_ready");
    expect(result.state.candidates).toHaveLength(3);
    expect(result.reply).toContain("I found 3 new contacts");
  });

  it("confirms Maya and captures context", () => {
    const approved = handleAgentMessage(createInitialState(fixtureUser, fixtureCalendarEvent), "yes").state;
    const result = handleAgentMessage(approved, "save Maya: played piano, AI recruiting founder");

    expect(result.state.memories[0].displayName).toBe("Maya Chen");
    expect(result.reply).toContain("Saved Maya Chen");
  });

  it("recalls Maya from a vague query", () => {
    const approved = handleAgentMessage(createInitialState(fixtureUser, fixtureCalendarEvent), "yes").state;
    const saved = handleAgentMessage(approved, "save Maya: played piano, AI recruiting founder").state;

    const matches = searchMemories(saved, "who was the girl playing piano at dinner");

    expect(matches[0].memory.displayName).toBe("Maya Chen");
    expect(matches[0].reason).toContain("played piano");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /home/thien/Friendy
npm test -- src/agent.test.ts
```

Expected: fail because `agent.ts` does not exist.

- [ ] **Step 3: Implement agent logic**

Add `src/agent.ts`:

```ts
import { fixtureContactDelta } from "./mockData";
import { approveSession, confirmCandidate, extractTags, loadContactDelta, type MemoryState } from "./memoryStore";
import type { RelationshipMemory } from "./types";

export type AgentResult = {
  state: MemoryState;
  reply: string;
};

export type MemoryMatch = {
  memory: RelationshipMemory;
  score: number;
  reason: string;
};

export function handleAgentMessage(state: MemoryState, rawInput: string): AgentResult {
  const input = rawInput.trim();
  const lower = input.toLowerCase();
  const suggestedSession = state.sessions.find((session) => session.status === "suggested");

  if (lower === "start" && suggestedSession) {
    return {
      state,
      reply: `You have ${suggestedSession.title} tonight from 7-11 PM. Want me to remember new people you meet there?`
    };
  }

  if ((lower === "yes" || lower.includes("start tracking")) && suggestedSession) {
    const approved = approveSession(state, suggestedSession.calendarEventId ?? "");
    const withDelta = loadContactDelta(approved, fixtureContactDelta);
    return {
      state: withDelta,
      reply: `I found ${withDelta.candidates.length} new contacts since ${suggestedSession.title} started: ${withDelta.candidates
        .map((candidate) => candidate.displayName)
        .join(", ")}. Reply like "save Maya: played piano, AI recruiting founder" or "ignore Alex".`
    };
  }

  if (lower.startsWith("save ")) {
    return saveCandidateFromMessage(state, input);
  }

  if (lower.startsWith("ignore ")) {
    const name = lower.replace("ignore ", "").trim();
    const candidate = state.candidates.find((item) => item.displayName.toLowerCase().includes(name));
    if (!candidate) {
      return { state, reply: `I could not find a pending candidate for "${name}".` };
    }

    return {
      state: {
        ...state,
        candidates: state.candidates.map((item) =>
          item.id === candidate.id ? { ...item, status: "ignored" } : item
        )
      },
      reply: `Ignored ${candidate.displayName}.`
    };
  }

  const matches = searchMemories(state, input);
  if (matches.length === 0) {
    return {
      state,
      reply: "I do not have a confident match yet. Try a name, event, time, or context like piano, recruiting, or dinner."
    };
  }

  const top = matches[0];
  return {
    state,
    reply: `Likely ${top.memory.displayName}. ${top.reason} Contact: ${top.memory.contactLabel}.`
  };
}

function saveCandidateFromMessage(state: MemoryState, input: string): AgentResult {
  const match = input.match(/^save\s+([^:]+):\s*(.+)$/i);
  if (!match) {
    return {
      state,
      reply: 'Use this format: "save Maya: played piano, AI recruiting founder".'
    };
  }

  const [, nameFragment, contextNote] = match;
  const candidate = state.candidates.find((item) =>
    item.displayName.toLowerCase().includes(nameFragment.trim().toLowerCase())
  );

  if (!candidate) {
    return {
      state,
      reply: `I could not find a pending candidate for "${nameFragment.trim()}".`
    };
  }

  const next = confirmCandidate(state, candidate.id, contextNote.trim());
  return {
    state: next,
    reply: `Saved ${candidate.displayName}. I will remember: ${contextNote.trim()}.`
  };
}

export function searchMemories(state: MemoryState, query: string): MemoryMatch[] {
  const queryTags = extractTags(query);

  return state.memories
    .map((memory) => {
      const haystack = [
        memory.displayName,
        memory.eventTitle ?? "",
        memory.contextNote,
        memory.tags.join(" ")
      ].join(" ").toLowerCase();

      const matchingTags = queryTags.filter((tag) => haystack.includes(tag));
      const eventBoost = memory.eventTitle && query.toLowerCase().includes("dinner") ? 2 : 0;
      const score = matchingTags.length * 3 + eventBoost;

      return {
        memory,
        score,
        reason:
          matchingTags.length > 0
            ? `Your saved note says "${memory.contextNote}" and matched: ${matchingTags.join(", ")}.`
            : `This was saved from ${memory.eventTitle ?? "an event"}.`
      };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd /home/thien/Friendy
npm test -- src/agent.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
cd /home/thien
git add Friendy
git commit -m "feat: add photon memory agent logic"
```

Expected: commit succeeds if `/home/thien` is a Git repo. If it is not a Git repo, record that in `implementation-notes.html` and continue.

## Task 5: Build Product Flow UI

**Files:**
- Modify: `Friendy/src/App.tsx`
- Modify: `Friendy/src/styles.css`
- Modify: `Friendy/implementation-notes.html`

- [ ] **Step 1: Replace `App.tsx` with the working product flow UI**

Use:

```tsx
import { useMemo, useState } from "react";
import { handleAgentMessage } from "./agent";
import { fixtureCalendarEvent, fixtureUser } from "./mockData";
import { createInitialState, type MemoryState } from "./memoryStore";
import "./styles.css";

type ChatMessage = {
  role: "user" | "agent";
  text: string;
};

export function App() {
  const initialState = useMemo(() => createInitialState(fixtureUser, fixtureCalendarEvent), []);
  const [state, setState] = useState<MemoryState>(initialState);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "agent",
      text: "You have Photon Residency Dinner tonight from 7-11 PM. Want me to remember new people you meet there?"
    }
  ]);

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const result = handleAgentMessage(state, trimmed);
    setState(result.state);
    setMessages((current) => [
      ...current,
      { role: "user", text: trimmed },
      { role: "agent", text: result.reply }
    ]);
    setInput("");
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Photon product flow</p>
        <h1>Relationship Memory Agent</h1>
        <p>
          Photon watches approved event windows, asks before saving new people,
          and helps you refind them from vague context later.
        </p>
      </section>

      <section className="layout">
        <div className="panel chat-panel">
          <div className="panel-heading">
            <h2>Photon Agent</h2>
            <span>{state.sessions[0].status.replace("_", " ")}</span>
          </div>

          <div className="messages" aria-live="polite">
            {messages.map((message, index) => (
              <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                {message.text}
              </div>
            ))}
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage(input);
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder='Try "yes", "save Maya: played piano, AI recruiting founder", or "who played piano at dinner?"'
            />
            <button type="submit">Send</button>
          </form>
        </div>

        <aside className="side-stack">
          <section className="panel">
            <h2>Event Window</h2>
            <p className="strong">{fixtureCalendarEvent.title}</p>
            <p className="muted">7-11 PM, San Francisco</p>
            <p className="muted">Source: mocked calendar</p>
          </section>

          <section className="panel">
            <h2>Candidate Queue</h2>
            {state.candidates.length === 0 ? (
              <p className="muted">Approve the event window to load mocked contact deltas.</p>
            ) : (
              <ul className="clean-list">
                {state.candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <span>{candidate.displayName}</span>
                    <small>{candidate.status}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>Saved Memories</h2>
            {state.memories.length === 0 ? (
              <p className="muted">No confirmed memories yet.</p>
            ) : (
              <ul className="clean-list">
                {state.memories.map((memory) => (
                  <li key={memory.id}>
                    <span>{memory.displayName}</span>
                    <small>{memory.contextNote}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Replace `styles.css` with final responsive styling**

Use:

```css
:root {
  color: #1b1f24;
  background: #f5f7fa;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

button,
input {
  font: inherit;
}

.shell {
  min-height: 100vh;
  padding: 32px 20px;
}

.hero {
  max-width: 1120px;
  margin: 0 auto 24px;
}

.eyebrow {
  color: #0f766e;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1 {
  max-width: 780px;
  margin: 8px 0 12px;
  font-size: 48px;
  line-height: 1.05;
}

h2 {
  margin: 0;
  font-size: 18px;
}

p {
  margin: 0;
}

.hero p:last-child {
  max-width: 760px;
  color: #667085;
  font-size: 18px;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.8fr);
  gap: 16px;
  max-width: 1120px;
  margin: 0 auto;
}

.panel {
  border: 1px solid #d8dde6;
  border-radius: 8px;
  background: white;
  box-shadow: 0 14px 34px rgba(16, 24, 40, 0.08);
  padding: 18px;
}

.panel-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 14px;
}

.panel-heading span {
  border-radius: 999px;
  background: #e4f5f2;
  color: #0f766e;
  padding: 4px 10px;
  font-size: 13px;
  font-weight: 700;
}

.chat-panel {
  display: flex;
  min-height: 620px;
  flex-direction: column;
}

.messages {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  padding: 6px 2px 16px;
}

.message {
  max-width: 82%;
  border-radius: 8px;
  padding: 12px 14px;
}

.message.agent {
  align-self: flex-start;
  background: #eef2f6;
}

.message.user {
  align-self: flex-end;
  background: #0f766e;
  color: white;
}

.composer {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  border-top: 1px solid #d8dde6;
  padding-top: 14px;
}

.composer input {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 12px;
}

.composer button {
  border: 0;
  border-radius: 8px;
  background: #1b1f24;
  color: white;
  cursor: pointer;
  font-weight: 800;
  padding: 0 18px;
}

.side-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.strong {
  margin-top: 12px;
  font-weight: 800;
}

.muted {
  color: #667085;
}

.clean-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
}

.clean-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px;
}

.clean-list span {
  font-weight: 800;
}

.clean-list small {
  color: #667085;
}

@media (max-width: 860px) {
  .layout {
    grid-template-columns: 1fr;
  }

  h1 {
    font-size: 36px;
  }

  .chat-panel {
    min-height: 560px;
  }
}
```

- [ ] **Step 3: Run build**

Run:

```bash
cd /home/thien/Friendy
npm run build
```

Expected: build passes.

- [ ] **Step 4: Manually test core product flow path**

Run:

```bash
cd /home/thien/Friendy
npm run dev
```

Expected: Vite prints a local URL.

In the browser:

1. Send `yes`.
2. Confirm the candidate queue shows Maya, Alex, and Priya.
3. Send `save Maya: played piano, AI recruiting founder`.
4. Confirm saved memories show Maya.
5. Send `who was playing piano at dinner`.
6. Confirm Photon returns Maya with a reason and contact label.

- [ ] **Step 5: Update implementation notes**

Append:

```html
<h2>Product Flow UI Decision</h2>
<p>
  The product flow uses a chat-first UI with side panels for event state, candidate
  queue, and saved memories. This makes Photon the primary product surface while
  still exposing enough state to understand the product flow.
</p>
```

- [ ] **Step 6: Commit**

Run:

```bash
cd /home/thien
git add Friendy
git commit -m "feat: build photon memory product flow UI"
```

Expected: commit succeeds if `/home/thien` is a Git repo. If it is not a Git repo, record that in `implementation-notes.html` and continue.

## Task 6: Final Verification And Product Flow Polish

**Files:**
- Modify: `Friendy/implementation-notes.html`

- [ ] **Step 1: Run all tests**

Run:

```bash
cd /home/thien/Friendy
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run production build**

Run:

```bash
cd /home/thien/Friendy
npm run build
```

Expected: build passes.

- [ ] **Step 3: Run dev server for user product flow**

Run:

```bash
cd /home/thien/Friendy
npm run dev
```

Expected: Vite prints a local URL, usually `http://localhost:5173/`.

- [ ] **Step 4: Capture final notes**

Append to `implementation-notes.html`:

```html
<h2>Verification</h2>
<ul>
  <li>Ran unit tests for mock data, memory store, and agent logic.</li>
  <li>Ran production build.</li>
  <li>Manually verified the product flow path: approve event, save Maya, search by piano/dinner context.</li>
</ul>
```

- [ ] **Step 5: Commit**

Run:

```bash
cd /home/thien
git add Friendy
git commit -m "test: verify photon memory product flow"
```

Expected: commit succeeds if `/home/thien` is a Git repo. If it is not a Git repo, record that in `implementation-notes.html` and continue.

## Self-Review

- Spec coverage: the plan implements event prompt, approved memory window, mocked contact delta, candidate review, context capture, vague recall search, match explanation, and implementation notes.
- Scope control: native Contacts/Calendar, social sync, iMessage monitoring, face recognition, and full CRM workflows are excluded from implementation.
- Placeholder scan: no red-flag placeholders or unassigned implementation steps remain.
- Type consistency: `User`, `CalendarEvent`, `MemorySession`, `CandidateConnection`, `RelationshipMemory`, and `AgentInteraction` match the design spec.
