# Durable Runtime Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a SQLite-backed Friendy runtime repository so the local contact/calendar checker and Spectrum/iMessage runtime can share pending candidates, confirmations, ignored candidates, memories, and interaction logs across process lifetimes.

**Architecture:** Keep the existing in-memory repository as the fast fixture/test implementation, but make `RelationshipRepository` an explicit interface. Add a `node:sqlite` adapter behind the same interface, then add a runtime repository factory used by local checker and Spectrum when `FRIENDY_RUNTIME_STORE=sqlite`.

**Tech Stack:** TypeScript, Vitest, Node 24 `node:sqlite` `DatabaseSync`, existing Friendy relationship tools and ingestion pipeline.

---

## File Map

- Modify: `src/relationship/repository.ts`
  - Make `RepositorySeed`, `ConfirmCandidateOptions`, and `RelationshipRepository` explicit exported types.
  - Keep `createRelationshipRepository` behavior unchanged.
- Create: `src/relationship/sqliteRepository.ts`
  - Open SQLite, create schema, and implement `RelationshipRepository`.
- Create: `src/relationship/sqliteRepository.test.ts`
  - Prove same-tool behavior and cross-instance persistence.
- Create: `src/relationship/runtimeRepository.ts`
  - Choose SQLite or in-memory repository from environment.
- Create: `src/relationship/runtimeRepository.test.ts`
  - Prove runtime factory selection and fail-fast behavior.
- Modify: `src/relationship/ingestion/localCheck.ts`
  - Allow a repository to be injected so local checker can write to persistent state.
- Modify: `src/relationship/ingestion/localCheckCli.ts`
  - Use runtime repository factory when configured.
- Modify: `src/relationship/ingestion/localCheck.test.ts`
  - Prove local checker writes a pending candidate into a repository another agent instance can read.
- Modify: `src/relationship/transports/spectrumTransport.ts`
  - Use runtime repository factory by default.
- Modify: `src/relationship/transports/spectrumTransport.test.ts`
  - Prove configured SQLite runtime persists across runtime instances.
- Modify: `README.md`
  - Add local durable runtime env notes.
- Modify: `docs/ai-system-architecture.md`
  - Update current limitations and architecture flow to mention optional SQLite runtime store.
- Modify: `implementation-notes.html`
  - Record decisions, tradeoffs, and verification.

## Task 1: Make The Repository Interface Explicit

**Files:**
- Modify: `src/relationship/repository.ts`
- Test: `src/relationship/repository.test.ts`

- [ ] **Step 1: Add a type-level test by running existing repository tests first**

Run:

```bash
npm test -- src/relationship/repository.test.ts
```

Expected: PASS before the refactor. This gives the baseline for behavior-preserving interface extraction.

- [ ] **Step 2: Export explicit repository types**

In `src/relationship/repository.ts`, change the private type aliases and `RelationshipRepository` export to this shape:

```ts
export type RepositorySeed = {
  users?: User[];
  calendarEvents?: CalendarEvent[];
  candidates?: ContactCandidate[];
  eventMatches?: EventContextMatch[];
  memories?: RelationshipMemory[];
  interactions?: AgentInteraction[];
};

export type ConfirmCandidateOptions = {
  eventTitle?: string;
  relationshipContext?: string;
};

export type RelationshipRepository = {
  listCalendarEvents(userId: string): CalendarEvent[];
  addCalendarEvents(events: CalendarEvent[]): CalendarEvent[];
  createCandidateFromDetectedContact(contact: ContactCandidateDetected): ContactCandidate;
  listPendingCandidates(userId: string): ContactCandidate[];
  getCandidate(candidateId: string): ContactCandidate | undefined;
  listEventMatches(candidateId: string): EventContextMatch[];
  confirmCandidate(
    candidateId: string,
    contextNote: string,
    eventId?: string,
    options?: ConfirmCandidateOptions
  ): RelationshipMemory;
  ignoreCandidate(candidateId: string): void;
  listMemories(userId?: string): RelationshipMemory[];
  addMemory(memory: RelationshipMemory): RelationshipMemory;
  addInteraction(interaction: AgentInteraction): AgentInteraction;
  listInteractions(userId?: string): AgentInteraction[];
};
```

Then update the function signature:

```ts
export function createRelationshipRepository(seed: RepositorySeed = {}): RelationshipRepository {
```

No behavior should change in this task.

- [ ] **Step 3: Verify interface extraction**

Run:

```bash
npm test -- src/relationship/repository.test.ts src/relationship/tools.test.ts
```

Expected: PASS. If TypeScript complains about the return type, fix the repository object to satisfy the explicit interface without changing behavior.

- [ ] **Step 4: Commit**

```bash
git add src/relationship/repository.ts
git commit -m "refactor:define relationship repository interface"
```

## Task 2: Add Red SQLite Repository Tests

**Files:**
- Create: `src/relationship/sqliteRepository.test.ts`

- [ ] **Step 1: Write failing SQLite repository tests**

Create `src/relationship/sqliteRepository.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent, fixtureUser } from "./fixtures";
import { createSqliteRelationshipRepository } from "./sqliteRepository";
import { createRelationshipTools } from "./tools";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("sqlite relationship repository", () => {
  it("persists candidates, event matches, memories, and interactions across repository instances", () => {
    const dbPath = tempDatabasePath();
    const firstRepo = createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      }
    });
    const firstTools = createRelationshipTools(firstRepo);

    const candidate = firstTools.create_contact_candidate(fixtureDetectedContact);
    expect(firstTools.list_candidate_event_matches(fixtureUser.id, candidate.id)[0].eventTitle).toBe(
      "Photon Residency Dinner"
    );

    const secondRepo = createSqliteRelationshipRepository({ path: dbPath });
    const secondTools = createRelationshipTools(secondRepo);

    expect(secondTools.list_pending_candidates(fixtureUser.id).map((item) => item.displayName)).toEqual(["Maya Chen"]);

    const memory = secondTools.confirm_candidate(
      fixtureUser.id,
      candidate.id,
      "recruiting agents, played piano",
      fixtureShortEvent.id
    );
    expect(memory.eventTitle).toBe("Photon Residency Dinner");

    secondRepo.addInteraction({
      id: "interaction_sqlite_1",
      userId: fixtureUser.id,
      platform: "imessage",
      spaceId: "space_sqlite",
      inboundText: "yes, recruiting agents",
      interpretedIntentJson: { intent: "capture_memory" },
      outboundText: "Saved Maya Chen.",
      toolCalls: ["confirm_candidate"],
      modelUsed: "rule-based-fallback",
      confidence: 1,
      latencyMs: 3,
      createdAt: "2026-05-21T00:00:00.000Z"
    });

    const thirdRepo = createSqliteRelationshipRepository({ path: dbPath });
    const thirdTools = createRelationshipTools(thirdRepo);

    expect(thirdTools.list_pending_candidates(fixtureUser.id)).toEqual([]);
    expect(thirdTools.search_memories(fixtureUser.id, "who was playing piano?")[0].memory.displayName).toBe(
      "Maya Chen"
    );
    expect(thirdRepo.listInteractions(fixtureUser.id)[0]).toMatchObject({
      id: "interaction_sqlite_1",
      inboundText: "yes, recruiting agents",
      toolCalls: ["confirm_candidate"]
    });
  });

  it("keeps ignored candidates out of later pending queues without creating memory", () => {
    const dbPath = tempDatabasePath();
    const repo = createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      }
    });

    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
    repo.ignoreCandidate(candidate.id);

    const reopened = createSqliteRelationshipRepository({ path: dbPath });
    expect(reopened.listPendingCandidates(fixtureUser.id)).toEqual([]);
    expect(reopened.getCandidate(candidate.id)?.status).toBe("ignored");
    expect(reopened.listMemories(fixtureUser.id)).toEqual([]);
  });
});

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-sqlite-"));
  tempDirs.push(dir);
  return join(dir, "friendy.sqlite");
}
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/sqliteRepository.test.ts
```

Expected: FAIL with an import/module error for `./sqliteRepository`.

- [ ] **Step 3: Commit red tests**

```bash
git add src/relationship/sqliteRepository.test.ts
git commit -m "test:add sqlite repository persistence coverage"
```

## Task 3: Implement SQLite Repository

**Files:**
- Create: `src/relationship/sqliteRepository.ts`
- Test: `src/relationship/sqliteRepository.test.ts`

- [ ] **Step 1: Create the SQLite repository module**

Create `src/relationship/sqliteRepository.ts` with this structure:

```ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCandidateId, mapCandidateToEvents } from "./eventMapper";
import { extractTags, type ConfirmCandidateOptions, type RelationshipRepository, type RepositorySeed } from "./repository";
import type {
  AgentInteraction,
  CalendarEvent,
  ContactCandidate,
  ContactCandidateDetected,
  EventContextMatch,
  RelationshipMemory
} from "./types";

export type SqliteRelationshipRepositoryOptions = {
  path: string;
  seed?: RepositorySeed;
};

export function createSqliteRelationshipRepository({
  path,
  seed
}: SqliteRelationshipRepositoryOptions): RelationshipRepository {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SQLITE_SCHEMA);

  if (seed) {
    seedSqliteRepository(db, seed);
  }

  const repo: RelationshipRepository = {
    listCalendarEvents(userId) {
      return selectJsonRows<CalendarEvent>(db, "calendar_events", "user_id = ?", [userId]);
    },

    addCalendarEvents(events) {
      for (const event of events) {
        upsertJsonRow(db, "calendar_events", event.id, event.userId, {
          title: event.title,
          starts_at: event.startsAt,
          ends_at: event.endsAt,
          raw_json: event
        });
      }
      return events;
    },

    createCandidateFromDetectedContact(contact) {
      const candidate: ContactCandidate = {
        ...contact,
        id: createCandidateId(contact),
        status: "pending"
      };

      upsertJsonRow(db, "contact_candidates", candidate.id, candidate.userId, {
        display_name: candidate.displayName,
        detected_at: candidate.detectedAt,
        source: candidate.source,
        status: candidate.status,
        raw_json: candidate
      });

      const matches = mapCandidateToEvents(candidate.id, contact, repo.listCalendarEvents(contact.userId));
      for (const match of matches) {
        insertEventMatch(db, match);
      }
      return candidate;
    },

    listPendingCandidates(userId) {
      return selectJsonRows<ContactCandidate>(db, "contact_candidates", "user_id = ? AND status = ?", [
        userId,
        "pending"
      ]);
    },

    getCandidate(candidateId) {
      return selectJsonRow<ContactCandidate>(db, "contact_candidates", "id = ?", [candidateId]);
    },

    listEventMatches(candidateId) {
      return selectJsonRows<EventContextMatch>(db, "candidate_event_matches", "candidate_id = ?", [candidateId]).sort(
        (a, b) => a.rank - b.rank
      );
    },

    confirmCandidate(candidateId, contextNote, eventId, options: ConfirmCandidateOptions = {}) {
      const candidate = repo.getCandidate(candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }

      const selectedMatch =
        options.eventTitle && !eventId ? undefined : selectEventMatch(repo.listEventMatches(candidateId), eventId);
      const memory: RelationshipMemory = {
        id: `memory_${candidate.id}`,
        userId: candidate.userId,
        candidateId: candidate.id,
        displayName: candidate.displayName,
        primaryContactLabel: candidate.phoneNumbers[0] ?? candidate.emails[0] ?? "contact saved",
        eventId: selectedMatch?.calendarEventId,
        eventTitle: options.eventTitle ?? selectedMatch?.eventTitle,
        contextNote,
        relationshipContext: options.relationshipContext,
        tags: extractTags(contextNote),
        confidence: selectedMatch?.confidence ?? 0.5,
        createdAt: "2026-05-20T12:00:00.000Z",
        updatedAt: "2026-05-20T12:00:00.000Z"
      };

      updateCandidateStatus(db, candidate, "confirmed");
      repo.addMemory(memory);
      return memory;
    },

    ignoreCandidate(candidateId) {
      const candidate = repo.getCandidate(candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      updateCandidateStatus(db, candidate, "ignored");
    },

    listMemories(userId) {
      return userId
        ? selectJsonRows<RelationshipMemory>(db, "relationship_memories", "user_id = ?", [userId])
        : selectJsonRows<RelationshipMemory>(db, "relationship_memories");
    },

    addMemory(memory) {
      upsertJsonRow(db, "relationship_memories", memory.id, memory.userId, {
        display_name: memory.displayName,
        event_id: memory.eventId,
        event_title: memory.eventTitle,
        context_note: memory.contextNote,
        relationship_context: memory.relationshipContext,
        contact_method_json: { primaryContactLabel: memory.primaryContactLabel },
        tags_json: memory.tags,
        detected_at: memory.dateContext?.startsAt,
        confirmed_at: memory.createdAt,
        raw_json: memory
      });
      return memory;
    },

    addInteraction(interaction) {
      upsertJsonRow(db, "agent_interactions", interaction.id, interaction.userId, {
        platform: interaction.platform,
        space_id: interaction.spaceId,
        inbound_text: interaction.inboundText,
        interpretation_json: interaction.interpretedIntentJson,
        tool_calls_json: interaction.toolCalls,
        outbound_text: interaction.outboundText,
        created_at: interaction.createdAt,
        raw_json: interaction
      });
      return interaction;
    },

    listInteractions(userId) {
      return userId
        ? selectJsonRows<AgentInteraction>(db, "agent_interactions", "user_id = ?", [userId])
        : selectJsonRows<AgentInteraction>(db, "agent_interactions");
    }
  };

  return repo;
}
```

- [ ] **Step 2: Add schema and helpers in the same file**

Add these helpers below `createSqliteRelationshipRepository`:

```ts
const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  phone_number TEXT,
  timezone TEXT,
  created_at TEXT,
  updated_at TEXT,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  starts_at TEXT,
  ends_at TEXT,
  location TEXT,
  source TEXT,
  created_at TEXT,
  updated_at TEXT,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_candidates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  display_name TEXT,
  detected_at TEXT,
  source TEXT,
  status TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidate_event_matches (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  confidence REAL NOT NULL,
  reason TEXT,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS relationship_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  display_name TEXT,
  event_id TEXT,
  event_title TEXT,
  context_note TEXT,
  relationship_context TEXT,
  contact_method_json TEXT,
  tags_json TEXT,
  detected_at TEXT,
  confirmed_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_interactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT,
  space_id TEXT,
  inbound_text TEXT,
  interpretation_json TEXT,
  tool_calls_json TEXT,
  outbound_text TEXT,
  created_at TEXT,
  raw_json TEXT NOT NULL
);
`;

function seedSqliteRepository(db: DatabaseSync, seed: RepositorySeed): void {
  for (const user of seed.users ?? []) {
    upsertJsonRow(db, "users", user.id, user.id, {
      display_name: user.displayName,
      phone_number: user.phoneNumber,
      created_at: user.createdAt,
      updated_at: user.createdAt,
      raw_json: user
    });
  }
  for (const event of seed.calendarEvents ?? []) {
    upsertJsonRow(db, "calendar_events", event.id, event.userId, {
      title: event.title,
      starts_at: event.startsAt,
      ends_at: event.endsAt,
      location: event.location,
      source: event.calendarSource,
      raw_json: event
    });
  }
  for (const candidate of seed.candidates ?? []) {
    upsertJsonRow(db, "contact_candidates", candidate.id, candidate.userId, {
      display_name: candidate.displayName,
      detected_at: candidate.detectedAt,
      source: candidate.source,
      status: candidate.status,
      raw_json: candidate
    });
  }
  for (const match of seed.eventMatches ?? []) {
    insertEventMatch(db, match);
  }
  for (const memory of seed.memories ?? []) {
    upsertJsonRow(db, "relationship_memories", memory.id, memory.userId, {
      display_name: memory.displayName,
      event_id: memory.eventId,
      event_title: memory.eventTitle,
      context_note: memory.contextNote,
      relationship_context: memory.relationshipContext,
      contact_method_json: { primaryContactLabel: memory.primaryContactLabel },
      tags_json: memory.tags,
      raw_json: memory
    });
  }
  for (const interaction of seed.interactions ?? []) {
    upsertJsonRow(db, "agent_interactions", interaction.id, interaction.userId, {
      platform: interaction.platform,
      space_id: interaction.spaceId,
      inbound_text: interaction.inboundText,
      interpretation_json: interaction.interpretedIntentJson,
      tool_calls_json: interaction.toolCalls,
      outbound_text: interaction.outboundText,
      created_at: interaction.createdAt,
      raw_json: interaction
    });
  }
}

function upsertJsonRow(
  db: DatabaseSync,
  table: string,
  id: string,
  userId: string,
  values: Record<string, unknown>
): void {
  const now = new Date().toISOString();
  const row = {
    ...values,
    id,
    user_id: userId,
    created_at: typeof values.created_at === "string" ? values.created_at : now,
    updated_at: now,
    raw_json: JSON.stringify(values.raw_json)
  };
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  const updates = columns
    .filter((column) => column !== "id")
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");

  db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`
  ).run(...columns.map((column) => serializeCell(row[column])));
}

function insertEventMatch(db: DatabaseSync, match: EventContextMatch): void {
  upsertJsonRow(db, "candidate_event_matches", match.id, match.candidateId, {
    candidate_id: match.candidateId,
    event_id: match.calendarEventId,
    rank: match.rank,
    confidence: match.confidence,
    reason: match.reason,
    raw_json: match
  });
}

function updateCandidateStatus(
  db: DatabaseSync,
  candidate: ContactCandidate,
  status: ContactCandidate["status"]
): void {
  const updated = { ...candidate, status };
  upsertJsonRow(db, "contact_candidates", updated.id, updated.userId, {
    display_name: updated.displayName,
    detected_at: updated.detectedAt,
    source: updated.source,
    status: updated.status,
    raw_json: updated
  });
}

function selectJsonRows<T>(db: DatabaseSync, table: string, where?: string, params: unknown[] = []): T[] {
  const sql = `SELECT raw_json FROM ${table}${where ? ` WHERE ${where}` : ""}`;
  return db
    .prepare(sql)
    .all(...params)
    .map((row) => JSON.parse(String((row as { raw_json: string }).raw_json)) as T);
}

function selectJsonRow<T>(db: DatabaseSync, table: string, where: string, params: unknown[]): T | undefined {
  const row = db.prepare(`SELECT raw_json FROM ${table} WHERE ${where}`).get(...params) as
    | { raw_json: string }
    | undefined;
  return row ? (JSON.parse(row.raw_json) as T) : undefined;
}

function selectEventMatch(matches: EventContextMatch[], eventId?: string): EventContextMatch | undefined {
  if (eventId) {
    return matches.find((match) => match.calendarEventId === eventId);
  }
  return [...matches].sort((a, b) => a.rank - b.rank)[0];
}

function serializeCell(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return value;
}
```

- [ ] **Step 3: Run focused SQLite tests**

Run:

```bash
npm test -- src/relationship/sqliteRepository.test.ts
```

Expected: PASS with 2 tests.

- [ ] **Step 4: Run adjacent repository/tool tests**

Run:

```bash
npm test -- src/relationship/repository.test.ts src/relationship/tools.test.ts src/relationship/sqliteRepository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/relationship/sqliteRepository.ts src/relationship/sqliteRepository.test.ts
git commit -m "feat:add sqlite relationship repository"
```

## Task 4: Add Runtime Repository Factory

**Files:**
- Create: `src/relationship/runtimeRepository.ts`
- Create: `src/relationship/runtimeRepository.test.ts`

- [ ] **Step 1: Write failing runtime factory tests**

Create `src/relationship/runtimeRepository.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent, fixtureUser } from "./fixtures";
import { createRuntimeRelationshipRepository } from "./runtimeRepository";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime relationship repository factory", () => {
  it("uses in-memory repository when persistent runtime store is not configured", () => {
    const first = createRuntimeRelationshipRepository({
      env: {},
      seed: { users: [fixtureUser], calendarEvents: [fixtureLongEvent, fixtureShortEvent] }
    });
    const candidate = first.createCandidateFromDetectedContact(fixtureDetectedContact);

    const second = createRuntimeRelationshipRepository({ env: {} });

    expect(first.getCandidate(candidate.id)?.displayName).toBe("Maya Chen");
    expect(second.getCandidate(candidate.id)).toBeUndefined();
  });

  it("uses sqlite when FRIENDY_RUNTIME_STORE=sqlite and shares state across instances", () => {
    const dbPath = tempDatabasePath();
    const env = {
      FRIENDY_RUNTIME_STORE: "sqlite",
      FRIENDY_SQLITE_PATH: dbPath
    };
    const first = createRuntimeRelationshipRepository({
      env,
      seed: { users: [fixtureUser], calendarEvents: [fixtureLongEvent, fixtureShortEvent] }
    });
    const candidate = first.createCandidateFromDetectedContact(fixtureDetectedContact);

    const second = createRuntimeRelationshipRepository({ env });

    expect(second.getCandidate(candidate.id)?.displayName).toBe("Maya Chen");
  });

  it("fails clearly when sqlite is selected without FRIENDY_SQLITE_PATH", () => {
    expect(() => createRuntimeRelationshipRepository({ env: { FRIENDY_RUNTIME_STORE: "sqlite" } })).toThrow(
      "FRIENDY_RUNTIME_STORE=sqlite requires FRIENDY_SQLITE_PATH"
    );
  });
});

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-runtime-"));
  tempDirs.push(dir);
  return join(dir, "friendy.sqlite");
}
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/runtimeRepository.test.ts
```

Expected: FAIL with an import/module error for `./runtimeRepository`.

- [ ] **Step 3: Implement runtime factory**

Create `src/relationship/runtimeRepository.ts`:

```ts
import { createRelationshipRepository, type RelationshipRepository, type RepositorySeed } from "./repository";
import { createSqliteRelationshipRepository } from "./sqliteRepository";

export type RuntimeRelationshipRepositoryInput = {
  env?: Partial<NodeJS.ProcessEnv>;
  seed?: RepositorySeed;
};

export function createRuntimeRelationshipRepository({
  env = process.env,
  seed
}: RuntimeRelationshipRepositoryInput = {}): RelationshipRepository {
  if (env.FRIENDY_RUNTIME_STORE === "sqlite") {
    const path = env.FRIENDY_SQLITE_PATH;
    if (!path) {
      throw new Error("FRIENDY_RUNTIME_STORE=sqlite requires FRIENDY_SQLITE_PATH.");
    }
    return createSqliteRelationshipRepository({ path, seed });
  }

  return createRelationshipRepository(seed);
}
```

- [ ] **Step 4: Verify runtime factory**

Run:

```bash
npm test -- src/relationship/runtimeRepository.test.ts src/relationship/sqliteRepository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/relationship/runtimeRepository.ts src/relationship/runtimeRepository.test.ts
git commit -m "feat:add runtime repository factory"
```

## Task 5: Wire Local Checker To Injectable Persistent State

**Files:**
- Modify: `src/relationship/ingestion/localCheck.ts`
- Modify: `src/relationship/ingestion/localCheckCli.ts`
- Modify: `src/relationship/ingestion/localCheck.test.ts`

- [ ] **Step 1: Add failing local checker persistence test**

Append this test to `src/relationship/ingestion/localCheck.test.ts`:

```ts
it("writes candidates into an injected repository that another agent instance can confirm", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createSqliteRelationshipRepository } = await import("../sqliteRepository");
  const { createRelationshipTools } = await import("../tools");
  const { createRuleBasedInterpreter } = await import("../openRouterInterpreter");
  const { createInterpretedRelationshipAgent } = await import("../interpretedAgent");

  const dir = mkdtempSync(join(tmpdir(), "friendy-local-check-"));
  const dbPath = join(dir, "friendy.sqlite");

  try {
    const localRepo = createSqliteRelationshipRepository({ path: dbPath });
    const result = await runLocalContactCalendarCheck({
      before: beforeSnapshot(),
      after: afterSnapshot("Friendy-105", "2026-05-20T19:30:00.000Z"),
      calendarProvider: createFixtureCalendarEventProvider([photonDinnerEvent()]),
      repo: localRepo,
      env: {}
    });

    const agentRepo = createSqliteRelationshipRepository({ path: dbPath });
    const agent = createInterpretedRelationshipAgent({
      repo: agentRepo,
      tools: createRelationshipTools(agentRepo),
      interpreter: createRuleBasedInterpreter(),
      now: () => "2026-05-20T20:10:00.000Z"
    });

    const reply = await agent.handleMessage({
      userId,
      platform: "imessage",
      text: "yes, met Friendy-105 at Photon Residency Dinner, AI infra",
      receivedAt: "2026-05-20T20:10:00.000Z"
    });

    expect(result.candidates[0].displayName).toBe("Friendy-105");
    expect(reply.outbound.text).toContain("Saved Friendy-105");
    expect(agentRepo.listMemories(userId)[0]).toMatchObject({
      displayName: "Friendy-105",
      eventTitle: "Photon Residency Dinner"
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/ingestion/localCheck.test.ts
```

Expected: FAIL because `runLocalContactCalendarCheck` does not accept `repo`.

- [ ] **Step 3: Inject repository into local checker**

In `src/relationship/ingestion/localCheck.ts`, update imports and input type:

```ts
import { createRelationshipRepository, type RelationshipRepository } from "../repository";
```

Add `repo?: RelationshipRepository;` to `RunLocalContactCalendarCheckInput`.

Update the repository creation inside `runLocalContactCalendarCheck`:

```ts
  const repo = inputRepo ?? createRelationshipRepository({ users: [localUser(after)] });
```

Use destructuring in the function parameter:

```ts
export async function runLocalContactCalendarCheck({
  before,
  after,
  calendarProvider,
  sender,
  repo: inputRepo,
  env = process.env
}: RunLocalContactCalendarCheckInput): Promise<LocalContactCalendarCheckResult> {
```

- [ ] **Step 4: Use runtime repository in CLI**

In `src/relationship/ingestion/localCheckCli.ts`, import:

```ts
import { createRuntimeRelationshipRepository } from "../runtimeRepository";
```

In `runRealLocalCheck`, create a repository before calling the local checker:

```ts
  const repo = createRuntimeRelationshipRepository({
    env: process.env,
    seed: {
      users: [
        {
          id: args.userId,
          phoneNumber: "",
          displayName: "Local Friendy User",
          createdAt: capturedAt
        }
      ]
    }
  });
  const result = await runLocalContactCalendarCheck({ before, after, calendarProvider, sender, repo, env: process.env });
```

For mock mode, keep current behavior unless `FRIENDY_RUNTIME_STORE=sqlite` is set. The simplest implementation is:

```ts
const result = args.mock
  ? await runLocalContactCalendarCheck({
      ...createMockLocalCheckScenario(),
      sender,
      repo: process.env.FRIENDY_RUNTIME_STORE === "sqlite" ? createRuntimeRelationshipRepository({ env: process.env }) : undefined,
      env: process.env
    })
  : await runRealLocalCheck(args, sender);
```

- [ ] **Step 5: Verify local checker**

Run:

```bash
npm test -- src/relationship/ingestion/localCheck.test.ts src/relationship/runtimeRepository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/relationship/ingestion/localCheck.ts src/relationship/ingestion/localCheckCli.ts src/relationship/ingestion/localCheck.test.ts
git commit -m "feat:persist local checker candidates through runtime repository"
```

## Task 6: Wire Spectrum Runtime To Runtime Repository

**Files:**
- Modify: `src/relationship/transports/spectrumTransport.ts`
- Modify: `src/relationship/transports/spectrumTransport.test.ts`

- [ ] **Step 1: Add failing Spectrum persistence test**

Append this test to `src/relationship/transports/spectrumTransport.test.ts`:

```ts
it("shares SQLite runtime state across Spectrum runtime instances when configured", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const dir = mkdtempSync(join(tmpdir(), "friendy-spectrum-runtime-"));
  const env = {
    FRIENDY_RUNTIME_STORE: "sqlite",
    FRIENDY_SQLITE_PATH: join(dir, "friendy.sqlite")
  };

  try {
    const first = createSpectrumFriendyRuntime({
      interpreter: createRuleBasedInterpreter(),
      now: () => "2026-05-20T12:00:00.000Z",
      env
    });

    await first.handleInboundText({
      text: "I met Amaya at Photon Residency II, recruiting agents founder",
      spaceId: "space_persistent",
      receivedAt: "2026-05-20T12:00:00.000Z"
    });

    const second = createSpectrumFriendyRuntime({
      interpreter: createRuleBasedInterpreter(),
      now: () => "2026-05-20T12:05:00.000Z",
      env
    });

    const search = await second.handleInboundText({
      text: "Who was the recruiting agents founder from Photon?",
      spaceId: "space_persistent",
      receivedAt: "2026-05-20T12:05:00.000Z"
    });

    expect(search.replyText).toContain("Amaya");
    expect(second.repo.listInteractions("space_persistent")).toHaveLength(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/transports/spectrumTransport.test.ts
```

Expected: FAIL because `SpectrumRuntimeOptions` does not accept `env` and runtime defaults to in-memory fixture state.

- [ ] **Step 3: Update Spectrum runtime options and repository selection**

In `src/relationship/transports/spectrumTransport.ts`, import:

```ts
import { createRuntimeRelationshipRepository } from "../runtimeRepository";
```

Extend `SpectrumRuntimeOptions`:

```ts
  env?: Partial<NodeJS.ProcessEnv>;
```

Update `createSpectrumFriendyRuntime` parameters:

```ts
export function createSpectrumFriendyRuntime({
  interpreter,
  now,
  repo: providedRepo,
  tools: providedTools,
  env = process.env
}: SpectrumRuntimeOptions) {
```

Replace default repo creation with:

```ts
  const repo =
    providedRepo ??
    createRuntimeRelationshipRepository({
      env,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      }
    });
```

- [ ] **Step 4: Verify Spectrum runtime**

Run:

```bash
npm test -- src/relationship/transports/spectrumTransport.test.ts src/relationship/runtimeRepository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/relationship/transports/spectrumTransport.ts src/relationship/transports/spectrumTransport.test.ts
git commit -m "feat:persist spectrum runtime state when configured"
```

## Task 7: Documentation And Implementation Notes

**Files:**
- Modify: `README.md`
- Modify: `docs/ai-system-architecture.md`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Update README runtime configuration**

Add this section near the local checker/Spectrum runtime docs in `README.md`:

````md
## Optional Durable Runtime Store

By default, fixture checks use in-memory state. To let the explicit local checker and the Spectrum/iMessage runtime share pending candidates and relationship memories across separate processes, run both with:

```bash
FRIENDY_RUNTIME_STORE=sqlite
FRIENDY_SQLITE_PATH=.friendy/friendy.sqlite
```

The SQLite file lives under `.friendy/`, which is ignored by git because it contains local relationship-memory state.
````

- [ ] **Step 2: Update architecture current state**

In `docs/ai-system-architecture.md`, replace the limitation:

````md
- Memory is in-memory, not production durable storage.
````

with:

````md
- Runtime state can use the in-memory repository for deterministic checks or the optional SQLite repository for local cross-process persistence. SQLite is still local development storage, not production cloud sync.
````

Also add SQLite to the current repo implementation list:

```text
src/relationship/sqliteRepository.ts
src/relationship/runtimeRepository.ts
  optional local durable runtime store behind the repository boundary
```

- [ ] **Step 3: Update implementation notes**

Add bullets to `implementation-notes.html`:

```html
<li>Added an optional SQLite runtime repository behind the existing relationship repository interface so the local checker and Spectrum/iMessage runtime can share pending candidates and memories across process lifetimes.</li>
<li>Kept in-memory repositories as the default for deterministic tests and fixture checks. SQLite is selected explicitly with <code>FRIENDY_RUNTIME_STORE=sqlite</code> and <code>FRIENDY_SQLITE_PATH</code>.</li>
<li>Used Node's built-in <code>node:sqlite</code> instead of adding a native dependency because the project already runs on Node 24.</li>
```

- [ ] **Step 4: Verify docs wording**

Run:

```bash
rg -i "d[e]mo" README.md docs/ai-system-architecture.md implementation-notes.html docs/superpowers/plans/2026-05-21-durable-runtime-store.md
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/ai-system-architecture.md implementation-notes.html
git commit -m "docs:document durable runtime store"
```

## Task 8: Full Verification

**Files:**
- All files changed above.

- [ ] **Step 1: Run focused durable runtime tests**

Run:

```bash
npm test -- src/relationship/sqliteRepository.test.ts src/relationship/runtimeRepository.test.ts src/relationship/ingestion/localCheck.test.ts src/relationship/transports/spectrumTransport.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: PASS. The test count should be greater than the current 106 tests because new SQLite/runtime tests were added.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS. If TypeScript complains about `node:sqlite` types, first verify Node and `@types/node` versions before changing the library choice.

- [ ] **Step 4: Run agent evals**

Run:

```bash
npm run eval:agent
```

Expected: PASS with 12 of 12 required cases, 0 unsafe mutations, and 0 hallucinations.

- [ ] **Step 5: Run product checks**

Run:

```bash
npm run check:imessage-e2e
npm run ingest:check
npm run ingest:local:check -- --mock
```

Expected: all pass with existing deterministic output shape.

- [ ] **Step 6: Run SQLite runtime smoke check**

Run:

```bash
FRIENDY_RUNTIME_STORE=sqlite FRIENDY_SQLITE_PATH=.friendy/friendy-check.sqlite npm run ingest:local:check -- --mock
```

Expected: command passes and prints the Friendy confirmation prompt. The `.friendy/friendy-check.sqlite` file must remain untracked.

- [ ] **Step 7: Run final hygiene checks**

Run:

```bash
git diff --check
git status --short --branch
rg -i "d[e]mo"
```

Expected: `git diff --check` passes, the forbidden-word search returns no matches, and only intended source/docs changes are present.

- [ ] **Step 8: Commit verification notes if needed**

If implementation notes or goal logs need final verification updates, commit them:

```bash
git add implementation-notes.html docs/goals/PLAN.md docs/goals/EXPERIMENTS.md docs/goals/EXPERIMENT_NOTES.md
git commit -m "docs:record durable runtime verification"
```

Skip this commit if Task 7 already captured all final verification details and no docs changed during Task 8.
