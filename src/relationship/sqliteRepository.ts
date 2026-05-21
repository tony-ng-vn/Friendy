import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCandidateId, mapCandidateToEvents } from "./eventMapper";
import {
  extractTags,
  type ConfirmCandidateOptions,
  type RelationshipRepository,
  type RepositorySeed
} from "./repository";
import type {
  AgentInteraction,
  CalendarEvent,
  ContactCandidate,
  ContactCandidateDetected,
  EventContextMatch,
  RelationshipMemory,
  User
} from "./types";

export type SqliteRelationshipRepositoryOptions = {
  path: string;
  seed?: RepositorySeed;
};

type RawJsonRow = {
  raw_json: string;
};

type InsertOrderedTable = "calendar_events" | "candidates" | "event_matches" | "memories" | "interactions";

export function createSqliteRelationshipRepository(options: SqliteRelationshipRepositoryOptions): RelationshipRepository {
  mkdirSync(dirname(options.path), { recursive: true });

  const db = new DatabaseSync(options.path);
  setupSchema(db);

  if (options.seed) {
    runTransaction(db, () => seedRepository(db, options.seed));
  }

  function listCalendarEvents(userId: string): CalendarEvent[] {
    return readRows<CalendarEvent>(
      db.prepare("SELECT raw_json FROM calendar_events WHERE user_id = ? ORDER BY insert_order, id").all(userId)
    );
  }

  function listEventMatches(candidateId: string): EventContextMatch[] {
    return readRows<EventContextMatch>(
      db.prepare("SELECT raw_json FROM event_matches WHERE candidate_id = ? ORDER BY rank, insert_order, id").all(candidateId)
    );
  }

  return {
    listCalendarEvents,

    addCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
      for (const event of events) {
        upsertCalendarEvent(db, event);
      }

      return events;
    },

    createCandidateFromDetectedContact(contact: ContactCandidateDetected): ContactCandidate {
      return runTransaction(db, () => {
        const candidate: ContactCandidate = {
          ...contact,
          id: createCandidateId(contact),
          status: "pending"
        };

        upsertCandidate(db, candidate);

        const eventMatches = mapCandidateToEvents(candidate.id, contact, listCalendarEvents(contact.userId));
        for (const match of eventMatches) {
          upsertEventMatch(db, match);
        }

        return candidate;
      });
    },

    listPendingCandidates(userId: string): ContactCandidate[] {
      return readRows<ContactCandidate>(
        db
          .prepare("SELECT raw_json FROM candidates WHERE user_id = ? AND status = 'pending' ORDER BY insert_order, id")
          .all(userId)
      );
    },

    getCandidate(candidateId: string): ContactCandidate | undefined {
      return readOptionalRow<ContactCandidate>(
        db.prepare("SELECT raw_json FROM candidates WHERE id = ?").get(candidateId)
      );
    },

    listEventMatches,

    confirmCandidate(
      candidateId: string,
      contextNote: string,
      eventId?: string,
      options: ConfirmCandidateOptions = {}
    ): RelationshipMemory {
      return runTransaction(db, () => {
        const candidate = readOptionalRow<ContactCandidate>(
          db.prepare("SELECT raw_json FROM candidates WHERE id = ?").get(candidateId)
        );
        if (!candidate) {
          throw new Error(`Candidate not found: ${candidateId}`);
        }

        const confirmedCandidate: ContactCandidate = { ...candidate, status: "confirmed" };
        upsertCandidate(db, confirmedCandidate);

        const selectedMatch =
          options.eventTitle && !eventId ? undefined : selectEventMatch(listEventMatches(candidateId), eventId);
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

        upsertMemory(db, memory);
        return memory;
      });
    },

    ignoreCandidate(candidateId: string): void {
      const candidate = readOptionalRow<ContactCandidate>(
        db.prepare("SELECT raw_json FROM candidates WHERE id = ?").get(candidateId)
      );
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }

      upsertCandidate(db, { ...candidate, status: "ignored" });
    },

    listMemories(userId?: string): RelationshipMemory[] {
      if (userId) {
        return readRows<RelationshipMemory>(
          db.prepare("SELECT raw_json FROM memories WHERE user_id = ? ORDER BY insert_order, id").all(userId)
        );
      }

      return readRows<RelationshipMemory>(db.prepare("SELECT raw_json FROM memories ORDER BY insert_order, id").all());
    },

    addMemory(memory: RelationshipMemory): RelationshipMemory {
      upsertMemory(db, memory);
      return memory;
    },

    addInteraction(interaction: AgentInteraction): AgentInteraction {
      upsertInteraction(db, interaction);
      return interaction;
    },

    listInteractions(userId?: string): AgentInteraction[] {
      if (userId) {
        return readRows<AgentInteraction>(
          db.prepare("SELECT raw_json FROM interactions WHERE user_id = ? ORDER BY insert_order, id").all(userId)
        );
      }

      return readRows<AgentInteraction>(db.prepare("SELECT raw_json FROM interactions ORDER BY insert_order, id").all());
    }
  };
}

function setupSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone_number TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      insert_order INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      timezone TEXT NOT NULL,
      calendar_source TEXT NOT NULL,
      event_kind TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS calendar_events_user_time_idx
      ON calendar_events(user_id, starts_at, ends_at);

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      insert_order INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS candidates_user_status_idx
      ON candidates(user_id, status, detected_at);

    CREATE TABLE IF NOT EXISTS event_matches (
      id TEXT PRIMARY KEY,
      insert_order INTEGER NOT NULL,
      candidate_id TEXT NOT NULL,
      calendar_event_id TEXT NOT NULL,
      event_title TEXT NOT NULL,
      confidence REAL NOT NULL,
      rank INTEGER NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS event_matches_candidate_rank_idx
      ON event_matches(candidate_id, rank);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      insert_order INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      candidate_id TEXT,
      display_name TEXT NOT NULL,
      event_id TEXT,
      event_title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS memories_user_created_idx
      ON memories(user_id, created_at);

    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      insert_order INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      space_id TEXT,
      created_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS interactions_user_created_idx
      ON interactions(user_id, created_at);

    PRAGMA user_version = 1;
  `);
}

function seedRepository(db: DatabaseSync, seed: RepositorySeed): void {
  for (const user of seed.users ?? []) {
    upsertUser(db, user);
  }
  for (const event of seed.calendarEvents ?? []) {
    upsertCalendarEvent(db, event);
  }
  for (const candidate of seed.candidates ?? []) {
    upsertCandidate(db, candidate);
  }
  for (const match of seed.eventMatches ?? []) {
    upsertEventMatch(db, match);
  }
  for (const memory of seed.memories ?? []) {
    upsertMemory(db, memory);
  }
  for (const interaction of seed.interactions ?? []) {
    upsertInteraction(db, interaction);
  }
}

function upsertUser(db: DatabaseSync, user: User): void {
  db.prepare(
    `
      INSERT INTO users (id, phone_number, display_name, created_at, raw_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        phone_number = excluded.phone_number,
        display_name = excluded.display_name,
        created_at = excluded.created_at,
        raw_json = excluded.raw_json
    `
  ).run(user.id, user.phoneNumber, user.displayName, user.createdAt, stringify(user));
}

function upsertCalendarEvent(db: DatabaseSync, event: CalendarEvent): void {
  db.prepare(
    `
      INSERT INTO calendar_events (
        id, insert_order, user_id, title, starts_at, ends_at, timezone, calendar_source, event_kind, raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        title = excluded.title,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        timezone = excluded.timezone,
        calendar_source = excluded.calendar_source,
        event_kind = excluded.event_kind,
        raw_json = excluded.raw_json
    `
  ).run(
    event.id,
    nextInsertOrder(db, "calendar_events"),
    event.userId,
    event.title,
    event.startsAt,
    event.endsAt,
    event.timezone,
    event.calendarSource,
    event.eventKind,
    stringify(event)
  );
}

function upsertCandidate(db: DatabaseSync, candidate: ContactCandidate): void {
  db.prepare(
    `
      INSERT INTO candidates (id, insert_order, user_id, display_name, detected_at, source, status, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        display_name = excluded.display_name,
        detected_at = excluded.detected_at,
        source = excluded.source,
        status = excluded.status,
        raw_json = excluded.raw_json
    `
  ).run(
    candidate.id,
    nextInsertOrder(db, "candidates"),
    candidate.userId,
    candidate.displayName,
    candidate.detectedAt,
    candidate.source,
    candidate.status,
    stringify(candidate)
  );
}

function upsertEventMatch(db: DatabaseSync, match: EventContextMatch): void {
  db.prepare(
    `
      INSERT INTO event_matches (
        id, insert_order, candidate_id, calendar_event_id, event_title, confidence, rank, raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        candidate_id = excluded.candidate_id,
        calendar_event_id = excluded.calendar_event_id,
        event_title = excluded.event_title,
        confidence = excluded.confidence,
        rank = excluded.rank,
        raw_json = excluded.raw_json
    `
  ).run(
    match.id,
    nextInsertOrder(db, "event_matches"),
    match.candidateId,
    match.calendarEventId,
    match.eventTitle,
    match.confidence,
    match.rank,
    stringify(match)
  );
}

function upsertMemory(db: DatabaseSync, memory: RelationshipMemory): void {
  db.prepare(
    `
      INSERT INTO memories (
        id, insert_order, user_id, candidate_id, display_name, event_id, event_title, created_at, updated_at, raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        candidate_id = excluded.candidate_id,
        display_name = excluded.display_name,
        event_id = excluded.event_id,
        event_title = excluded.event_title,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        raw_json = excluded.raw_json
    `
  ).run(
    memory.id,
    nextInsertOrder(db, "memories"),
    memory.userId,
    memory.candidateId ?? null,
    memory.displayName,
    memory.eventId ?? null,
    memory.eventTitle ?? null,
    memory.createdAt,
    memory.updatedAt,
    stringify(memory)
  );
}

function upsertInteraction(db: DatabaseSync, interaction: AgentInteraction): void {
  db.prepare(
    `
      INSERT INTO interactions (id, insert_order, user_id, platform, space_id, created_at, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        platform = excluded.platform,
        space_id = excluded.space_id,
        created_at = excluded.created_at,
        raw_json = excluded.raw_json
    `
  ).run(
    interaction.id,
    nextInsertOrder(db, "interactions"),
    interaction.userId,
    interaction.platform,
    interaction.spaceId ?? null,
    interaction.createdAt,
    stringify(interaction)
  );
}

function runTransaction<T>(db: DatabaseSync, callback: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function nextInsertOrder(db: DatabaseSync, table: InsertOrderedTable): number {
  const row = db.prepare(`SELECT COALESCE(MAX(insert_order), 0) + 1 AS next_order FROM ${table}`).get() as {
    next_order: number;
  };
  return row.next_order;
}

function readRows<T>(rows: unknown[]): T[] {
  return rows.map((row) => parseJson<T>((row as RawJsonRow).raw_json));
}

function readOptionalRow<T>(row: unknown): T | undefined {
  if (!row) {
    return undefined;
  }

  return parseJson<T>((row as RawJsonRow).raw_json);
}

function selectEventMatch(matches: EventContextMatch[], eventId?: string): EventContextMatch | undefined {
  if (eventId) {
    return matches.find((match) => match.calendarEventId === eventId);
  }

  return matches.sort((a, b) => a.rank - b.rank)[0];
}

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
