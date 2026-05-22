import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCandidateId, mapCandidateToEvents } from "./eventMapper";
import type {
  ProcessedSensorEvent,
  RuntimeSensorState,
  RuntimeStateStore,
  RuntimeWarningState
} from "./runtime/friendyRuntime";
import {
  calculateCandidateExpiresAt,
  expireCandidateIfStale,
  extractTags,
  type ConfirmCandidateOptions,
  type MarkCandidatePromptedOptions,
  type RelationshipRepository,
  type RepositorySeed
} from "./repository";
import type {
  AgentInteraction,
  CalendarEvent,
  CandidatePromptAttempt,
  ContactCandidate,
  ContactCandidateDetected,
  EventContextMatch,
  RelationshipMemory,
  User
} from "./types";

export type SqliteRelationshipRepositoryOptions = {
  path: string;
  seed?: RepositorySeed;
  busyTimeoutMs?: number;
};

export type SqliteRelationshipRepository = RelationshipRepository & {
  close(): void;
};

export type SqliteRuntimeStateStore = RuntimeStateStore & {
  close(): void;
};

type RawJsonRow = {
  raw_json: string;
};

type InsertOrderedTable =
  | "calendar_events"
  | "candidates"
  | "event_matches"
  | "candidate_prompt_attempts"
  | "memories"
  | "interactions";

export class SqliteRepositoryBusyError extends Error {
  readonly code = "SQLITE_BUSY";
  readonly retryable = true;
  readonly cause: unknown;

  constructor(operation: string, cause: unknown) {
    super(`SQLite database is busy during ${operation}`);
    this.name = "SqliteRepositoryBusyError";
    this.cause = cause;
  }
}

export function createSqliteRelationshipRepository(options: SqliteRelationshipRepositoryOptions): SqliteRelationshipRepository {
  const seed = options.seed;
  const db = openSqliteRuntimeDatabase(options.path, { busyTimeoutMs: options.busyTimeoutMs });
  try {
    if (seed) {
      runTransaction(db, () => seedRepository(db, seed));
    }
  } catch (error) {
    db.close();
    throw error;
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
      return runTransaction(db, () => {
        for (const event of events) {
          upsertCalendarEvent(db, event);
        }

        return events;
      });
    },

    createCandidateFromDetectedContact(contact: ContactCandidateDetected): ContactCandidate {
      return runTransaction(db, () => {
        const candidateId = createCandidateId(contact);
        const existingCandidate = readOptionalRow<ContactCandidate>(
          db.prepare("SELECT raw_json FROM candidates WHERE id = ?").get(candidateId)
        );
        if (existingCandidate) {
          return existingCandidate;
        }

        const candidate: ContactCandidate = {
          ...contact,
          id: candidateId,
          status: "pending",
          expiresAt: calculateCandidateExpiresAt(contact.detectedAt)
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
      expireStaleCandidates(db, userId);
      return readRows<ContactCandidate>(
        db
          .prepare(
            "SELECT raw_json FROM candidates WHERE user_id = ? AND status IN ('pending', 'prompted') ORDER BY insert_order, id"
          )
          .all(userId)
      );
    },

    getCandidate(candidateId: string): ContactCandidate | undefined {
      return readOptionalRow<ContactCandidate>(
        db.prepare("SELECT raw_json FROM candidates WHERE id = ?").get(candidateId)
      );
    },

    listEventMatches,

    recordPromptAttempt(attempt: CandidatePromptAttempt): CandidatePromptAttempt {
      upsertPromptAttempt(db, attempt);
      return attempt;
    },

    listCandidatePromptAttempts(candidateId: string): CandidatePromptAttempt[] {
      return readRows<CandidatePromptAttempt>(
        db
          .prepare(
            "SELECT raw_json FROM candidate_prompt_attempts WHERE candidate_id = ? ORDER BY created_at, insert_order, id"
          )
          .all(candidateId)
      );
    },

    markCandidatePrompted(
      candidateId: string,
      interactionId: string,
      options: MarkCandidatePromptedOptions = {}
    ): ContactCandidate {
      return runTransaction(db, () => {
        const candidate = readOptionalRow<ContactCandidate>(
          db.prepare("SELECT raw_json FROM candidates WHERE id = ?").get(candidateId)
        );
        if (!candidate) {
          throw new Error(`Candidate not found: ${candidateId}`);
        }
        const currentCandidate = expireSqliteCandidateIfStale(db, candidate);
        if (currentCandidate.status !== "pending") {
          throw new Error(`Candidate is not promptable: ${candidateId}`);
        }

        const promptedCandidate: ContactCandidate = {
          ...currentCandidate,
          status: "prompted",
          promptInteractionId: interactionId,
          promptSpaceId: options.spaceId,
          promptedAt: options.promptedAt,
          statusReason: undefined
        };
        upsertCandidate(db, promptedCandidate);
        return promptedCandidate;
      });
    },

    markCandidatePromptFailed(candidateId: string, reason: string): ContactCandidate {
      return runTransaction(db, () => {
        const candidate = readOptionalRow<ContactCandidate>(
          db.prepare("SELECT raw_json FROM candidates WHERE id = ?").get(candidateId)
        );
        if (!candidate) {
          throw new Error(`Candidate not found: ${candidateId}`);
        }
        const currentCandidate = expireSqliteCandidateIfStale(db, candidate);
        if (currentCandidate.status !== "pending") {
          throw new Error(`Candidate is not pending: ${candidateId}`);
        }

        const failedCandidate: ContactCandidate = {
          ...currentCandidate,
          statusReason: reason
        };
        upsertCandidate(db, failedCandidate);
        return failedCandidate;
      });
    },

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
        const currentCandidate = expireSqliteCandidateIfStale(db, candidate);
        if (!isReviewableCandidateStatus(currentCandidate.status)) {
          throw new Error(`Candidate is not confirmable: ${candidateId}`);
        }

        const confirmedCandidate: ContactCandidate = { ...currentCandidate, status: "confirmed" };
        upsertCandidate(db, confirmedCandidate);

        const selectedMatch =
          options.eventTitle && !eventId ? undefined : selectEventMatch(listEventMatches(candidateId), eventId);
        const memory: RelationshipMemory = {
          id: `memory_${currentCandidate.id}`,
          userId: currentCandidate.userId,
          candidateId: currentCandidate.id,
          displayName: currentCandidate.displayName,
          primaryContactLabel: currentCandidate.phoneNumbers[0] ?? currentCandidate.emails[0] ?? "contact saved",
          eventId: selectedMatch?.calendarEventId,
          eventTitle: options.eventTitle ?? selectedMatch?.eventTitle,
          dateContext: options.dateContext,
          contextNote,
          relationshipContext: options.relationshipContext,
          tags: extractTags(contextNote),
          confidence: selectedMatch?.confidence ?? 0.5,
          createdAt: "2026-05-20T12:00:00.000Z",
          updatedAt: "2026-05-20T12:00:00.000Z"
        };

        insertMemory(db, memory);
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
      const currentCandidate = expireSqliteCandidateIfStale(db, candidate);
      if (!isReviewableCandidateStatus(currentCandidate.status)) {
        throw new Error(`Candidate is not ignorable: ${candidateId}`);
      }

      upsertCandidate(db, { ...currentCandidate, status: "ignored" });
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
      assertSqliteMemoryHasConfirmedCandidate(db, memory);
      insertMemory(db, memory);
      return memory;
    },

    addInteraction(interaction: AgentInteraction): AgentInteraction {
      insertInteraction(db, interaction);
      return interaction;
    },

    listInteractions(userId?: string): AgentInteraction[] {
      if (userId) {
        return readRows<AgentInteraction>(
          db.prepare("SELECT raw_json FROM interactions WHERE user_id = ? ORDER BY insert_order, id").all(userId)
        );
      }

      return readRows<AgentInteraction>(db.prepare("SELECT raw_json FROM interactions ORDER BY insert_order, id").all());
    },

    close(): void {
      db.close();
    }
  };
}

export function openSqliteRuntimeDatabase(
  path: string,
  options: { busyTimeoutMs?: number } = {}
): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const busyTimeoutMs = options.busyTimeoutMs ?? 5000;
  const db = new DatabaseSync(path, {
    timeout: busyTimeoutMs,
    enableForeignKeyConstraints: true
  });

  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = ${busyTimeoutMs};
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = NORMAL;
    `);
    setupSchema(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function createSqliteRuntimeStateStore({ path }: { path: string }): SqliteRuntimeStateStore {
  const db = openSqliteRuntimeDatabase(path);

  return {
    getProcessedEvent(idempotencyKey: string): ProcessedSensorEvent | undefined {
      return readProcessedEvent(
        db.prepare("SELECT * FROM processed_sensor_events WHERE idempotency_key = ?").get(idempotencyKey)
      );
    },

    getProcessedEventBySensorEventId(sensorEventId: string): ProcessedSensorEvent | undefined {
      return readProcessedEvent(
        db.prepare("SELECT * FROM processed_sensor_events WHERE sensor_event_id = ? ORDER BY processed_at DESC LIMIT 1").get(sensorEventId)
      );
    },

    recordProcessedEvent(event: ProcessedSensorEvent): void {
      db.prepare(
        `
          INSERT INTO processed_sensor_events (
            idempotency_key, sensor_event_id, sensor_name, event_type, status,
            candidate_id, warning_code, processed_at, raw_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(idempotency_key) DO UPDATE SET
            sensor_event_id = excluded.sensor_event_id,
            sensor_name = excluded.sensor_name,
            event_type = excluded.event_type,
            status = excluded.status,
            candidate_id = excluded.candidate_id,
            warning_code = excluded.warning_code,
            processed_at = excluded.processed_at,
            raw_json = excluded.raw_json
        `
      ).run(
        event.idempotencyKey,
        event.sensorEventId ?? null,
        event.sensorName,
        event.eventType,
        event.status,
        event.candidateId ?? null,
        event.warningCode ?? null,
        event.processedAt,
        stringify(event)
      );
    },

    getSensorState(userId: string, sensorName: string, deviceId: string): RuntimeSensorState | undefined {
      return readSensorState(
        db
          .prepare("SELECT * FROM sensor_state WHERE user_id = ? AND sensor_name = ? AND device_id = ?")
          .get(userId, sensorName, deviceId)
      );
    },

    upsertSensorState(input: {
      userId: string;
      sensorName: string;
      deviceId: string;
      stateJson: Record<string, unknown>;
      historyTokenBlob?: Uint8Array;
      baselineCompletedAt?: string;
      lastSuccessAt?: string;
      lastErrorCode?: string;
      lastPermissionStatus?: string;
      now: string;
    }): RuntimeSensorState {
      const existing = this.getSensorState(input.userId, input.sensorName, input.deviceId);
      const sensorState: RuntimeSensorState = {
        userId: input.userId,
        sensorName: input.sensorName,
        deviceId: input.deviceId,
        stateJson: input.stateJson,
        historyTokenBlob: input.historyTokenBlob ?? existing?.historyTokenBlob,
        baselineCompletedAt: input.baselineCompletedAt ?? existing?.baselineCompletedAt,
        lastSuccessAt: input.lastSuccessAt ?? existing?.lastSuccessAt,
        lastErrorCode: input.lastErrorCode ?? existing?.lastErrorCode,
        lastPermissionStatus: input.lastPermissionStatus ?? existing?.lastPermissionStatus,
        createdAt: existing?.createdAt ?? input.now,
        updatedAt: input.now
      };

      db.prepare(
        `
          INSERT INTO sensor_state (
            user_id, sensor_name, device_id, state_json, history_token_blob,
            baseline_completed_at, last_success_at, last_error_code, last_permission_status,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, sensor_name, device_id) DO UPDATE SET
            state_json = excluded.state_json,
            history_token_blob = excluded.history_token_blob,
            baseline_completed_at = excluded.baseline_completed_at,
            last_success_at = excluded.last_success_at,
            last_error_code = excluded.last_error_code,
            last_permission_status = excluded.last_permission_status,
            updated_at = excluded.updated_at
        `
      ).run(
        sensorState.userId,
        sensorState.sensorName,
        sensorState.deviceId,
        stringify(sensorState.stateJson),
        sensorState.historyTokenBlob ?? null,
        sensorState.baselineCompletedAt ?? null,
        sensorState.lastSuccessAt ?? null,
        sensorState.lastErrorCode ?? null,
        sensorState.lastPermissionStatus ?? null,
        sensorState.createdAt,
        sensorState.updatedAt
      );

      return sensorState;
    },

    getWarning(userId: string, sensorName: string, warningCode: string): RuntimeWarningState | undefined {
      return readRuntimeWarning(
        db
          .prepare("SELECT * FROM runtime_warnings WHERE user_id = ? AND sensor_name = ? AND warning_code = ?")
          .get(userId, sensorName, warningCode)
      );
    },

    upsertWarning(input: {
      userId: string;
      sensorName: string;
      warningCode: string;
      permissionStatus?: string;
      now: string;
      notified: boolean;
    }): RuntimeWarningState {
      const existing = this.getWarning(input.userId, input.sensorName, input.warningCode);
      const warning: RuntimeWarningState = existing
        ? {
            ...existing,
            permissionStatus: input.permissionStatus,
            lastSeenAt: input.now,
            lastNotifiedAt: input.notified ? input.now : existing.lastNotifiedAt,
            notificationCount: existing.notificationCount + (input.notified ? 1 : 0)
          }
        : {
            userId: input.userId,
            sensorName: input.sensorName,
            warningCode: input.warningCode,
            permissionStatus: input.permissionStatus,
            firstSeenAt: input.now,
            lastSeenAt: input.now,
            lastNotifiedAt: input.notified ? input.now : undefined,
            notificationCount: input.notified ? 1 : 0
          };

      db.prepare(
        `
          INSERT INTO runtime_warnings (
            user_id, sensor_name, warning_code, permission_status, first_seen_at,
            last_seen_at, last_notified_at, notification_count, raw_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, sensor_name, warning_code) DO UPDATE SET
            permission_status = excluded.permission_status,
            last_seen_at = excluded.last_seen_at,
            last_notified_at = excluded.last_notified_at,
            notification_count = excluded.notification_count,
            raw_json = excluded.raw_json
        `
      ).run(
        warning.userId,
        warning.sensorName,
        warning.warningCode,
        warning.permissionStatus ?? null,
        warning.firstSeenAt,
        warning.lastSeenAt,
        warning.lastNotifiedAt ?? null,
        warning.notificationCount,
        stringify(warning)
      );

      return warning;
    },

    close(): void {
      db.close();
    }
  };
}

function setupSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS candidate_prompt_attempts (
      id TEXT PRIMARY KEY,
      insert_order INTEGER NOT NULL,
      candidate_id TEXT NOT NULL,
      interaction_id TEXT,
      spectrum_space_id TEXT,
      status TEXT NOT NULL,
      error_code TEXT,
      created_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS prompt_attempts_candidate_created_idx
      ON candidate_prompt_attempts(candidate_id, created_at);

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

    CREATE UNIQUE INDEX IF NOT EXISTS memories_candidate_unique_idx
      ON memories(candidate_id)
      WHERE candidate_id IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS memory_requires_confirmed_candidate
    BEFORE INSERT ON memories
    FOR EACH ROW
    WHEN NEW.candidate_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM candidates
      WHERE id = NEW.candidate_id
        AND user_id = NEW.user_id
        AND status = 'confirmed'
    )
    BEGIN
      SELECT RAISE(ABORT, 'Memory requires a confirmed candidate');
    END;

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

    CREATE TABLE IF NOT EXISTS sensor_state (
      user_id TEXT NOT NULL,
      sensor_name TEXT NOT NULL,
      device_id TEXT NOT NULL,
      state_json TEXT NOT NULL,
      history_token_blob BLOB,
      baseline_completed_at TEXT,
      last_success_at TEXT,
      last_error_code TEXT,
      last_permission_status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, sensor_name, device_id)
    );

    CREATE TABLE IF NOT EXISTS runtime_warnings (
      user_id TEXT NOT NULL,
      sensor_name TEXT NOT NULL,
      warning_code TEXT NOT NULL,
      permission_status TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_notified_at TEXT,
      suppressed_until TEXT,
      acknowledged_at TEXT,
      notification_count INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      PRIMARY KEY (user_id, sensor_name, warning_code)
    );

    CREATE TABLE IF NOT EXISTS processed_sensor_events (
      idempotency_key TEXT PRIMARY KEY,
      sensor_event_id TEXT,
      sensor_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('candidate_created', 'duplicate', 'ignored', 'baselined', 'warning', 'failed')
      ),
      candidate_id TEXT,
      warning_code TEXT,
      processed_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS processed_sensor_events_sensor_event_idx
      ON processed_sensor_events(sensor_event_id);

    INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
    VALUES (1, '1_initial_runtime_store', '2026-05-21T00:00:00.000Z');

    PRAGMA user_version = 1;
  `);
}

function expireStaleCandidates(db: DatabaseSync, userId: string): void {
  const candidates = readRows<ContactCandidate>(
    db.prepare("SELECT raw_json FROM candidates WHERE user_id = ? AND status IN ('pending', 'prompted')").all(userId)
  );

  for (const candidate of candidates) {
    expireSqliteCandidateIfStale(db, candidate);
  }
}

function expireSqliteCandidateIfStale(db: DatabaseSync, candidate: ContactCandidate): ContactCandidate {
  const originalStatus = candidate.status;
  const updatedCandidate = expireCandidateIfStale(candidate);
  if (updatedCandidate.status !== originalStatus) {
    upsertCandidate(db, updatedCandidate);
  }

  return updatedCandidate;
}

function isReviewableCandidateStatus(status: ContactCandidate["status"]): boolean {
  return status === "pending" || status === "prompted";
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
  for (const attempt of seed.promptAttempts ?? []) {
    upsertPromptAttempt(db, attempt);
  }
  for (const memory of seed.memories ?? []) {
    insertMemory(db, memory);
  }
  for (const interaction of seed.interactions ?? []) {
    insertInteraction(db, interaction);
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

function upsertPromptAttempt(db: DatabaseSync, attempt: CandidatePromptAttempt): void {
  db.prepare(
    `
      INSERT INTO candidate_prompt_attempts (
        id, insert_order, candidate_id, interaction_id, spectrum_space_id, status, error_code, created_at, raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        candidate_id = excluded.candidate_id,
        interaction_id = excluded.interaction_id,
        spectrum_space_id = excluded.spectrum_space_id,
        status = excluded.status,
        error_code = excluded.error_code,
        created_at = excluded.created_at,
        raw_json = excluded.raw_json
    `
  ).run(
    attempt.id,
    nextInsertOrder(db, "candidate_prompt_attempts"),
    attempt.candidateId,
    attempt.interactionId ?? null,
    attempt.spectrumSpaceId ?? null,
    attempt.status,
    attempt.errorCode ?? null,
    attempt.createdAt,
    stringify(attempt)
  );
}

function insertMemory(db: DatabaseSync, memory: RelationshipMemory): void {
  db.prepare(
    `
      INSERT INTO memories (
        id, insert_order, user_id, candidate_id, display_name, event_id, event_title, created_at, updated_at, raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

function assertSqliteMemoryHasConfirmedCandidate(db: DatabaseSync, memory: RelationshipMemory): void {
  if (!memory.candidateId) {
    throw new Error("Memory requires a confirmed candidate");
  }

  const row = db
    .prepare("SELECT id FROM candidates WHERE id = ? AND user_id = ? AND status = 'confirmed'")
    .get(memory.candidateId, memory.userId);
  if (!row) {
    throw new Error("Memory requires a confirmed candidate");
  }

  const existingMemory = db.prepare("SELECT id FROM memories WHERE candidate_id = ?").get(memory.candidateId);
  if (existingMemory) {
    throw new Error("Memory already exists for candidate");
  }
}

function insertInteraction(db: DatabaseSync, interaction: AgentInteraction): void {
  db.prepare(
    `
      INSERT INTO interactions (id, insert_order, user_id, platform, space_id, created_at, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
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
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch (error) {
    throw normalizeSqliteError(error, "begin transaction");
  }

  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // If BEGIN failed or SQLite already unwound the transaction, preserve the original error.
    }
    throw normalizeSqliteError(error, "transaction");
  }
}

function normalizeSqliteError(error: unknown, operation: string): unknown {
  if (isSqliteBusyError(error)) {
    return new SqliteRepositoryBusyError(operation, error);
  }
  return error;
}

function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "SQLITE_BUSY" ||
    (typeof candidate.message === "string" &&
      (candidate.message.includes("SQLITE_BUSY") || candidate.message.includes("database is locked")))
  );
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

function readProcessedEvent(row: unknown): ProcessedSensorEvent | undefined {
  if (!row) {
    return undefined;
  }

  const value = row as {
    idempotency_key: string;
    sensor_event_id: string | null;
    sensor_name: string;
    event_type: string;
    status: ProcessedSensorEvent["status"];
    candidate_id: string | null;
    warning_code: string | null;
    processed_at: string;
  };

  return {
    idempotencyKey: value.idempotency_key,
    sensorEventId: value.sensor_event_id ?? undefined,
    sensorName: value.sensor_name,
    eventType: value.event_type,
    status: value.status,
    candidateId: value.candidate_id ?? undefined,
    warningCode: value.warning_code ?? undefined,
    processedAt: value.processed_at
  };
}

function readSensorState(row: unknown): RuntimeSensorState | undefined {
  if (!row) {
    return undefined;
  }

  const value = row as {
    user_id: string;
    sensor_name: string;
    device_id: string;
    state_json: string;
    history_token_blob: Uint8Array | null;
    baseline_completed_at: string | null;
    last_success_at: string | null;
    last_error_code: string | null;
    last_permission_status: string | null;
    created_at: string;
    updated_at: string;
  };

  return {
    userId: value.user_id,
    sensorName: value.sensor_name,
    deviceId: value.device_id,
    stateJson: parseJson<Record<string, unknown>>(value.state_json),
    historyTokenBlob: value.history_token_blob ?? undefined,
    baselineCompletedAt: value.baseline_completed_at ?? undefined,
    lastSuccessAt: value.last_success_at ?? undefined,
    lastErrorCode: value.last_error_code ?? undefined,
    lastPermissionStatus: value.last_permission_status ?? undefined,
    createdAt: value.created_at,
    updatedAt: value.updated_at
  };
}

function readRuntimeWarning(row: unknown): RuntimeWarningState | undefined {
  if (!row) {
    return undefined;
  }

  const value = row as {
    user_id: string;
    sensor_name: string;
    warning_code: string;
    permission_status: string | null;
    first_seen_at: string;
    last_seen_at: string;
    last_notified_at: string | null;
    notification_count: number;
  };

  return {
    userId: value.user_id,
    sensorName: value.sensor_name,
    warningCode: value.warning_code,
    permissionStatus: value.permission_status ?? undefined,
    firstSeenAt: value.first_seen_at,
    lastSeenAt: value.last_seen_at,
    lastNotifiedAt: value.last_notified_at ?? undefined,
    notificationCount: value.notification_count
  };
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
