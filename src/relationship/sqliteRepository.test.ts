import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent, fixtureUser } from "./fixtures";
import {
  createSqliteRelationshipRepository,
  SqliteRepositoryBusyError,
  createSqliteRuntimeStateStore,
  openSqliteRuntimeDatabase
} from "./sqliteRepository";
import { createRelationshipTools } from "./tools";
import type { SqliteRelationshipRepository } from "./sqliteRepository";
import type { AgentInteraction, ContactCandidate, EventContextMatch, RelationshipMemory } from "./types";

const tempDirs: string[] = [];
const repositories: SqliteRelationshipRepository[] = [];
const closeables: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    repository.close();
  }

  for (const item of closeables.splice(0)) {
    item.close();
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("sqlite relationship repository", () => {
  it("initializes runtime SQLite with WAL, busy timeout, foreign keys, and migration ledger", () => {
    const dbPath = tempDatabasePath();
    const db = trackCloseable(openSqliteRuntimeDatabase(dbPath));

    expect((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode.toLowerCase()).toBe("wal");
    expect((db.prepare("PRAGMA busy_timeout").get() as { timeout: number }).timeout).toBe(5000);
    expect((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
    ).toEqual({ name: "schema_migrations" });
    expect(db.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: 1, name: "1_initial_runtime_store" },
      { version: 2, name: "2_memory_search_documents" }
    ]);
  });

  it("persists processed sensor events and runtime warnings across state store instances", () => {
    const dbPath = tempDatabasePath();
    const firstState = trackCloseable(createSqliteRuntimeStateStore({ path: dbPath }));

    firstState.recordProcessedEvent({
      idempotencyKey: "contacts:mac_1:ABCD:add",
      sensorEventId: "sensor_evt_contact_1",
      sensorName: "macos_contacts_calendar",
      eventType: "contact_added",
      status: "candidate_created",
      candidateId: "candidate_maya_1",
      processedAt: "2026-05-21T18:36:51.000Z"
    });
    firstState.upsertWarning({
      userId: "user_friendy",
      sensorName: "macos_contacts_calendar",
      warningCode: "contacts_permission_denied",
      permissionStatus: "denied",
      now: "2026-05-21T18:36:51.000Z",
      notified: true
    });

    const secondState = trackCloseable(createSqliteRuntimeStateStore({ path: dbPath }));
    expect(secondState.getProcessedEvent("contacts:mac_1:ABCD:add")).toMatchObject({
      sensorEventId: "sensor_evt_contact_1",
      status: "candidate_created",
      candidateId: "candidate_maya_1"
    });
    expect(secondState.getProcessedEventBySensorEventId("sensor_evt_contact_1")).toMatchObject({
      idempotencyKey: "contacts:mac_1:ABCD:add"
    });
    expect(secondState.getWarning("user_friendy", "macos_contacts_calendar", "contacts_permission_denied")).toMatchObject({
      permissionStatus: "denied",
      notificationCount: 1,
      lastNotifiedAt: "2026-05-21T18:36:51.000Z"
    });
  });

  it("persists sensor health state across state store instances", () => {
    const dbPath = tempDatabasePath();
    const firstState = trackCloseable(createSqliteRuntimeStateStore({ path: dbPath }));

    firstState.upsertSensorState({
      userId: "user_friendy",
      sensorName: "macos_contacts_calendar",
      deviceId: "mac_1",
      stateJson: {
        lastEventType: "ready",
        contactsPermissionStatus: "authorized",
        calendarPermissionStatus: "denied"
      },
      baselineCompletedAt: "2026-05-21T18:36:51.000Z",
      lastSuccessAt: "2026-05-21T18:36:51.000Z",
      lastPermissionStatus: "contacts:authorized;calendar:denied",
      now: "2026-05-21T18:36:51.000Z"
    });

    const secondState = trackCloseable(createSqliteRuntimeStateStore({ path: dbPath }));
    expect(secondState.getSensorState("user_friendy", "macos_contacts_calendar", "mac_1")).toMatchObject({
      userId: "user_friendy",
      sensorName: "macos_contacts_calendar",
      deviceId: "mac_1",
      stateJson: {
        lastEventType: "ready",
        contactsPermissionStatus: "authorized",
        calendarPermissionStatus: "denied"
      },
      historyTokenBlob: undefined,
      baselineCompletedAt: "2026-05-21T18:36:51.000Z",
      lastSuccessAt: "2026-05-21T18:36:51.000Z",
      lastPermissionStatus: "contacts:authorized;calendar:denied",
      createdAt: "2026-05-21T18:36:51.000Z",
      updatedAt: "2026-05-21T18:36:51.000Z"
    });
  });

  it("persists candidates, event matches, memories, and interactions across repository instances", () => {
    const dbPath = tempDatabasePath();
    const firstRepo = trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      }
    }));
    const firstTools = createRelationshipTools(firstRepo);

    const candidate = firstTools.create_contact_candidate(fixtureDetectedContact);
    expect(firstTools.list_candidate_event_matches(fixtureUser.id, candidate.id)[0].eventTitle).toBe(
      "Photon Residency Dinner"
    );

    const secondRepo = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    const secondTools = createRelationshipTools(secondRepo);

    expect(secondTools.list_candidate_event_matches(fixtureUser.id, candidate.id)[0].eventTitle).toBe(
      "Photon Residency Dinner"
    );
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

    const thirdRepo = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
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

  it("persists append-only memory revisions while search uses the latest projection", () => {
    const dbPath = tempDatabasePath();
    const repo = trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      }
    }));
    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
    const memory = repo.confirmCandidate(candidate.id, "building recruiting agents", fixtureShortEvent.id);

    const reopened = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    const updated = reopened.updateMemory(memory.id, {
      contextNote: "working on hiring workflows",
      reason: "user_correction",
      userText: "Actually Maya was working on hiring workflows.",
      updatedAt: "2026-05-22T12:00:00.000Z"
    });

    const finalRepo = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    const revisions = finalRepo.listMemoryRevisions(memory.id);
    const search = createRelationshipTools(finalRepo).search_memories(fixtureUser.id, "hiring workflows");

    expect(updated.contextNote).toBe("working on hiring workflows");
    expect(finalRepo.listMemories(fixtureUser.id)[0].contextNote).toBe("working on hiring workflows");
    expect(search[0].memory.id).toBe(memory.id);
    expect(search[0].memory.contextNote).toBe("working on hiring workflows");
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toMatchObject({
      reason: "created",
      memoryId: memory.id,
      nextValue: {
        contextNote: "building recruiting agents"
      }
    });
    expect(revisions[1]).toMatchObject({
      reason: "user_correction",
      memoryId: memory.id,
      previousValue: {
        contextNote: "building recruiting agents"
      },
      nextValue: {
        contextNote: "working on hiring workflows"
      },
      userText: "Actually Maya was working on hiring workflows."
    });
  });

  it("persists soft deletes and keeps deleted memories out of search", () => {
    const dbPath = tempDatabasePath();
    const repo = trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      }
    }));
    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
    const memory = repo.confirmCandidate(candidate.id, "building recruiting agents", fixtureShortEvent.id);

    const reopened = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    reopened.deleteMemory(memory.id, {
      userText: "delete Maya memory",
      deletedAt: "2026-05-22T12:00:00.000Z"
    });

    const finalRepo = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));

    expect(finalRepo.listMemories(fixtureUser.id)).toEqual([]);
    expect(createRelationshipTools(finalRepo).search_memories(fixtureUser.id, "recruiting agents")).toEqual([]);
    expect(finalRepo.listMemoryRevisions(memory.id).at(-1)).toMatchObject({
      reason: "deleted",
      userText: "delete Maya memory"
    });
  });

  it("backfills and syncs memory search documents across SQLite repository instances", () => {
    const dbPath = tempDatabasePath();
    const repo = trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      }
    }));
    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
    const memory = repo.confirmCandidate(candidate.id, "building recruiting agents", fixtureShortEvent.id);

    const reopened = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    expect(reopened.listMemorySearchDocuments(fixtureUser.id)[0]).toMatchObject({
      memoryId: memory.id,
      userId: fixtureUser.id,
      fields: {
        displayName: "Maya Chen",
        contextNote: "building recruiting agents"
      }
    });

    reopened.updateMemory(memory.id, {
      contextNote: "working on hiring workflows",
      reason: "user_correction",
      userText: "Actually Maya was working on hiring workflows.",
      updatedAt: "2026-05-22T12:00:00.000Z"
    });

    const updatedRepo = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    expect(updatedRepo.listMemorySearchDocuments(fixtureUser.id)[0].text).toContain("working on hiring workflows");

    updatedRepo.deleteMemory(memory.id, {
      userText: "delete Maya memory",
      deletedAt: "2026-05-22T12:30:00.000Z"
    });

    const finalRepo = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    expect(finalRepo.listMemorySearchDocuments(fixtureUser.id)).toEqual([]);
  });

  it("returns FTS memory search document candidates when SQLite supports FTS5", () => {
    if (!sqliteSupportsFts5()) {
      return;
    }

    const dbPath = tempDatabasePath();
    const repo = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    const tools = createRelationshipTools(repo);
    const memory = tools.create_manual_memory(
      fixtureUser.id,
      "Testing 12",
      "Met them during testing Friendy",
      "manual contact",
      {
        dateContext: {
          rawText: "during Mac contact watcher debugging week",
          localDate: "2026-05-22",
          startsAt: "2026-05-22T00:00:00.000Z",
          timezone: "America/Los_Angeles"
        }
      }
    );

    expect(repo.searchMemoryDocuments?.(fixtureUser.id, "debugging week", ["debugging", "week"])).toEqual([
      {
        memoryId: memory.id,
        source: "fts",
        score: expect.any(Number),
        matchedTerms: ["debugging", "week"]
      }
    ]);
  });

  it("persists candidate expiration and expires stale candidates on pending lookup", () => {
    const dbPath = tempDatabasePath();
    const repo = trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      }
    }));
    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);

    expect(candidate).toMatchObject({
      status: "pending",
      expiresAt: "2026-05-30T04:42:00.000Z"
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-31T00:00:00.000Z"));

      const reopened = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
      expect(reopened.listPendingCandidates(fixtureUser.id)).toEqual([]);
      expect(reopened.getCandidate(candidate.id)).toMatchObject({
        status: "expired"
      });
      expect(() => reopened.confirmCandidate(candidate.id, "late reply", fixtureShortEvent.id)).toThrow(
        "Candidate is not confirmable"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps ignored candidates out of later pending queues without creating memory", () => {
    const dbPath = tempDatabasePath();
    const repo = trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      }
    }));

    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
    repo.ignoreCandidate(candidate.id);

    const reopened = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    expect(reopened.listPendingCandidates(fixtureUser.id)).toEqual([]);
    expect(reopened.getCandidate(candidate.id)?.status).toBe("ignored");
    expect(reopened.listMemories(fixtureUser.id)).toEqual([]);
  });

  it("persists prompted candidates as reviewable across repository instances", () => {
    const dbPath = tempDatabasePath();
    const repo = trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      }
    }));

    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
    repo.markCandidatePrompted(candidate.id, "interaction_prompt_sqlite_1", {
      spaceId: "imessage_space_sqlite_prompt",
      promptedAt: "2026-05-21T18:36:51.000Z"
    });

    const reopened = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    expect(reopened.getCandidate(candidate.id)).toMatchObject({
      status: "prompted",
      promptInteractionId: "interaction_prompt_sqlite_1",
      promptSpaceId: "imessage_space_sqlite_prompt",
      promptedAt: "2026-05-21T18:36:51.000Z"
    });
    expect(reopened.listPendingCandidates(fixtureUser.id).map((item) => item.id)).toEqual([candidate.id]);
  });

  it("persists candidate prompt attempts across repository instances", () => {
    const dbPath = tempDatabasePath();
    const repo = trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      }
    }));

    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
    repo.recordPromptAttempt({
      id: "prompt_attempt_sqlite_1",
      candidateId: candidate.id,
      interactionId: "interaction_prompt_sqlite_1",
      spectrumSpaceId: "imessage_space_sqlite_prompt",
      status: "send_succeeded",
      rawJson: {
        route: "single"
      },
      createdAt: "2026-05-21T18:36:51.000Z"
    });

    const reopened = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    expect(reopened.listCandidatePromptAttempts(candidate.id)).toEqual([
      expect.objectContaining({
        id: "prompt_attempt_sqlite_1",
        candidateId: candidate.id,
        interactionId: "interaction_prompt_sqlite_1",
        spectrumSpaceId: "imessage_space_sqlite_prompt",
        status: "send_succeeded",
        rawJson: {
          route: "single"
        },
        createdAt: "2026-05-21T18:36:51.000Z"
      })
    ]);
  });

  it("rejects confirming ignored or already confirmed candidates", () => {
    const dbPath = tempDatabasePath();
    const repo = trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      }
    }));
    const ignored = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
    const confirmed = repo.createCandidateFromDetectedContact({
      ...fixtureDetectedContact,
      displayName: "Nina Park",
      phoneNumbers: ["+15550101021"],
      detectedAt: "2026-05-15T21:44:00-07:00"
    });

    repo.ignoreCandidate(ignored.id);
    repo.confirmCandidate(confirmed.id, "designer building notes", fixtureShortEvent.id);

    expect(() => repo.confirmCandidate(ignored.id, "should not save", fixtureShortEvent.id)).toThrow(
      "Candidate is not confirmable"
    );
    expect(() => repo.confirmCandidate(confirmed.id, "should not save twice", fixtureShortEvent.id)).toThrow(
      "Candidate is not confirmable"
    );
    expect(repo.listMemories(fixtureUser.id).map((memory) => memory.displayName)).toEqual(["Nina Park"]);
  });

  it("persists candidate timing fields and maps events through the event match anchor", () => {
    const dbPath = tempDatabasePath();
    const repo = trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [
          {
            id: "event_anchor_dinner",
            userId: fixtureUser.id,
            title: "Anchor Dinner",
            startsAt: "2026-05-22T09:30:00.000Z",
            endsAt: "2026-05-22T10:30:00.000Z",
            timezone: "UTC",
            calendarSource: "simulated",
            eventKind: "short"
          }
        ]
      }
    }));

    const candidate = repo.createCandidateFromDetectedContact({
      ...fixtureDetectedContact,
      detectedAt: "2026-05-22T12:00:00.000Z",
      observedAt: "2026-05-22T10:00:00.000Z",
      contactUpdatedAt: "2026-05-22T09:58:00.000Z",
      eventMatchAnchorAt: "2026-05-22T10:00:00.000Z"
    });

    expect(repo.getCandidate(candidate.id)).toMatchObject({
      detectedAt: "2026-05-22T12:00:00.000Z",
      observedAt: "2026-05-22T10:00:00.000Z",
      contactUpdatedAt: "2026-05-22T09:58:00.000Z",
      eventMatchAnchorAt: "2026-05-22T10:00:00.000Z"
    });
    expect(repo.listEventMatches(candidate.id)[0]).toMatchObject({
      eventTitle: "Anchor Dinner",
      rank: 1
    });
  });

  it("rejects direct memory writes without a confirmed candidate", () => {
    const dbPath = tempDatabasePath();
    const repo = trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      }
    }));

    expect(() =>
      repo.addMemory({
        id: "memory_without_candidate",
        userId: fixtureUser.id,
        displayName: "Unconfirmed Person",
        primaryContactLabel: "manual contact",
        contextNote: "should not bypass candidate confirmation",
        tags: ["bypass"],
        confidence: 0.5,
        createdAt: "2026-05-21T06:00:00.000Z",
        updatedAt: "2026-05-21T06:00:00.000Z"
      })
    ).toThrow("Memory requires a confirmed candidate");
  });

  it("rejects raw SQLite memory inserts without a confirmed candidate", () => {
    const dbPath = tempDatabasePath();
    trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      }
    }));
    const db = trackCloseable(new DatabaseSync(dbPath));

    expect(() =>
      db
        .prepare(
          `
            INSERT INTO memories (
              id, insert_order, user_id, candidate_id, display_name, event_id, event_title,
              created_at, updated_at, raw_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          "memory_raw_without_candidate",
          1,
          fixtureUser.id,
          null,
          "Raw Insert Person",
          null,
          null,
          "2026-05-21T06:00:00.000Z",
          "2026-05-21T06:00:00.000Z",
          JSON.stringify({ id: "memory_raw_without_candidate" })
        )
    ).toThrow("Memory requires a confirmed candidate");
  });

  it("rejects raw SQLite memory inserts that reuse a confirmed candidate", () => {
    const dbPath = tempDatabasePath();
    const repo = trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      }
    }));
    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
    repo.confirmCandidate(candidate.id, "recruiting agents, played piano", fixtureShortEvent.id);
    const db = trackCloseable(new DatabaseSync(dbPath));

    expect(() =>
      db
        .prepare(
          `
            INSERT INTO memories (
              id, insert_order, user_id, candidate_id, display_name, event_id, event_title,
              created_at, updated_at, raw_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          "memory_raw_duplicate_candidate",
          2,
          fixtureUser.id,
          candidate.id,
          "Duplicate Candidate Person",
          null,
          null,
          "2026-05-21T06:00:00.000Z",
          "2026-05-21T06:00:00.000Z",
          JSON.stringify({ id: "memory_raw_duplicate_candidate", candidateId: candidate.id })
        )
    ).toThrow();
    expect(repo.listMemories(fixtureUser.id)).toHaveLength(1);
  });

  it("accepts writes for unseeded users like the in-memory repository", () => {
    const dbPath = tempDatabasePath();
    const repo = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    const userId = "user_unseeded";

    const candidate = repo.createCandidateFromDetectedContact({
      ...fixtureDetectedContact,
      userId,
      displayName: "Unseeded Person",
      detectedAt: "2026-05-16T09:30:00-07:00"
    });
    expect(repo.listPendingCandidates(userId).map((item) => item.displayName)).toEqual(["Unseeded Person"]);

    const memory = repo.confirmCandidate(candidate.id, "met at an unseeded runtime check");
    repo.addInteraction({
      id: "interaction_unseeded_1",
      userId,
      platform: "imessage",
      inboundText: "remember this unseeded user",
      outboundText: "Saved Unseeded Person.",
      toolCalls: ["create_manual_memory"],
      createdAt: "2026-05-21T01:01:00.000Z"
    });

    const reopened = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    expect(reopened.listPendingCandidates(userId)).toEqual([]);
    expect(reopened.listMemories(userId)).toEqual([
      expect.objectContaining({
        id: memory.id,
        displayName: "Unseeded Person"
      })
    ]);
    expect(reopened.listInteractions(userId)).toEqual([
      expect.objectContaining({
        id: "interaction_unseeded_1",
        inboundText: "remember this unseeded user"
      })
    ]);
  });

  it("preserves orphan event match seeds like the in-memory repository", () => {
    const dbPath = tempDatabasePath();
    const orphanMatch: EventContextMatch = {
      id: "match_orphan_seed",
      candidateId: "candidate_missing",
      calendarEventId: "event_missing",
      eventTitle: "Missing Event",
      confidence: 0.5,
      reason: "Seeded without related rows.",
      rank: 1
    };

    trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        eventMatches: [orphanMatch]
      }
    }));

    const reopened = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    expect(reopened.listEventMatches("candidate_missing")).toEqual([orphanMatch]);
  });

  it("preserves equal-rank event match seed order like the in-memory repository", () => {
    const dbPath = tempDatabasePath();
    const candidateId = "candidate_equal_rank";
    const firstMatch: EventContextMatch = {
      id: "match_z",
      candidateId,
      calendarEventId: "event_z",
      eventTitle: "Z Event",
      confidence: 0.8,
      reason: "Seeded first with the same rank.",
      rank: 1
    };
    const secondMatch: EventContextMatch = {
      id: "match_a",
      candidateId,
      calendarEventId: "event_a",
      eventTitle: "A Event",
      confidence: 0.8,
      reason: "Seeded second with the same rank.",
      rank: 1
    };

    trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        eventMatches: [firstMatch, secondMatch]
      }
    }));

    const reopened = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    expect(reopened.listEventMatches(candidateId).map((match) => match.id)).toEqual(["match_z", "match_a"]);
  });

  it("preserves memory and interaction insertion order instead of sorting by createdAt", () => {
    const dbPath = tempDatabasePath();
    const userId = "user_ordering";
    const firstMemory: RelationshipMemory = {
      id: "memory_order_first",
      userId,
      candidateId: "candidate_order_first",
      displayName: "First Inserted",
      primaryContactLabel: "first contact",
      contextNote: "inserted first with newer createdAt",
      tags: ["first"],
      confidence: 0.7,
      createdAt: "2026-05-21T03:00:00.000Z",
      updatedAt: "2026-05-21T03:00:00.000Z"
    };
    const secondMemory: RelationshipMemory = {
      id: "memory_order_second",
      userId,
      candidateId: "candidate_order_second",
      displayName: "Second Inserted",
      primaryContactLabel: "second contact",
      contextNote: "inserted second with older createdAt",
      tags: ["second"],
      confidence: 0.7,
      createdAt: "2026-05-21T02:00:00.000Z",
      updatedAt: "2026-05-21T02:00:00.000Z"
    };
    const firstInteraction: AgentInteraction = {
      id: "interaction_order_first",
      userId,
      platform: "imessage",
      inboundText: "first inserted interaction",
      outboundText: "First response.",
      toolCalls: ["search_memories"],
      createdAt: "2026-05-21T03:01:00.000Z"
    };
    const secondInteraction: AgentInteraction = {
      id: "interaction_order_second",
      userId,
      platform: "imessage",
      inboundText: "second inserted interaction",
      outboundText: "Second response.",
      toolCalls: ["search_memories"],
      createdAt: "2026-05-21T02:01:00.000Z"
    };

    trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        candidates: [
          confirmedCandidate({ id: "candidate_order_first", userId, displayName: "First Inserted" }),
          confirmedCandidate({ id: "candidate_order_second", userId, displayName: "Second Inserted" })
        ],
        memories: [firstMemory, secondMemory],
        interactions: [firstInteraction, secondInteraction]
      }
    }));

    const reopened = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    expect(reopened.listMemories(userId).map((memory) => memory.id)).toEqual([
      "memory_order_first",
      "memory_order_second"
    ]);
    expect(reopened.listInteractions(userId).map((interaction) => interaction.id)).toEqual([
      "interaction_order_first",
      "interaction_order_second"
    ]);
  });

  it("rolls back seed writes when a later seeded row fails", () => {
    const dbPath = tempDatabasePath();
    const userId = "user_seed_transaction";

    expect(() =>
      trackRepository(createSqliteRelationshipRepository({
        path: dbPath,
        seed: {
          candidates: [
            confirmedCandidate({
              id: "candidate_before_failed_seed",
              userId,
              displayName: "Seed Transaction Person"
            })
          ],
          memories: [
            {
              id: "memory_before_failed_seed",
              userId,
              candidateId: "candidate_before_failed_seed",
              displayName: "Seed Transaction Person",
              primaryContactLabel: "seeded contact",
              contextNote: "this should roll back",
              tags: ["rollback"],
              confidence: 0.6,
              createdAt: "2026-05-21T04:00:00.000Z",
              updatedAt: "2026-05-21T04:00:00.000Z"
            }
          ],
          interactions: [
            {
              id: "interaction_invalid_seed",
              userId,
              inboundText: "invalid interaction",
              outboundText: "Invalid.",
              toolCalls: [],
              createdAt: "2026-05-21T04:01:00.000Z"
            } as unknown as AgentInteraction
          ]
        }
      }))
    ).toThrow();

    const reopened = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    expect(reopened.listMemories(userId)).toEqual([]);
  });

  it("does not overwrite existing memories or interactions when duplicate ids are added", () => {
    const dbPath = tempDatabasePath();
    const userId = "user_duplicate_insert";
    const originalMemory: RelationshipMemory = {
      id: "memory_duplicate_insert",
      userId,
      candidateId: "candidate_duplicate_insert",
      displayName: "Original Memory",
      primaryContactLabel: "original contact",
      contextNote: "original memory content",
      tags: ["original"],
      confidence: 0.8,
      createdAt: "2026-05-21T05:00:00.000Z",
      updatedAt: "2026-05-21T05:00:00.000Z"
    };
    const duplicateMemory: RelationshipMemory = {
      ...originalMemory,
      displayName: "Overwritten Memory",
      contextNote: "duplicate memory content",
      tags: ["duplicate"],
      updatedAt: "2026-05-21T05:01:00.000Z"
    };
    const originalInteraction: AgentInteraction = {
      id: "interaction_duplicate_insert",
      userId,
      platform: "imessage",
      inboundText: "original interaction content",
      outboundText: "Original response.",
      toolCalls: ["search_memories"],
      createdAt: "2026-05-21T05:02:00.000Z"
    };
    const duplicateInteraction: AgentInteraction = {
      ...originalInteraction,
      inboundText: "duplicate interaction content",
      outboundText: "Duplicate response.",
      toolCalls: ["confirm_candidate"],
      createdAt: "2026-05-21T05:03:00.000Z"
    };

    const repo = trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        candidates: [
          confirmedCandidate({
            id: "candidate_duplicate_insert",
            userId,
            displayName: "Original Memory"
          })
        ]
      }
    }));

    repo.addMemory(originalMemory);
    expect(() => repo.addMemory(duplicateMemory)).toThrow();

    repo.addInteraction(originalInteraction);
    expect(() => repo.addInteraction(duplicateInteraction)).toThrow();

    repo.close();
    repositories.splice(repositories.indexOf(repo), 1);

    const reopened = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    expect(reopened.listMemories(userId)).toEqual([originalMemory]);
    expect(reopened.listInteractions(userId)).toEqual([originalInteraction]);
  });

  it("stores multiple manual memories created in the same millisecond", () => {
    const dbPath = tempDatabasePath();
    const userId = "user_same_millisecond";
    const repo = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    const tools = createRelationshipTools(repo);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(1779307200000);

    try {
      tools.create_manual_memory(userId, "Amaya", "met at Photon Residency, AI recruiting founder");
      tools.create_manual_memory(userId, "Sarah Fah", "ran Photon Residency II as community lead");
    } finally {
      dateNow.mockRestore();
    }

    const memories = repo.listMemories(userId);
    expect(memories.map((memory) => memory.displayName)).toEqual(["Amaya", "Sarah Fah"]);
    expect(new Set(memories.map((memory) => memory.id)).size).toBe(2);
    expect(memories.every((memory) => Boolean(memory.candidateId))).toBe(true);
    expect(memories.map((memory) => repo.getCandidate(memory.candidateId!)?.status)).toEqual(["confirmed", "confirmed"]);
  });

  it("deduplicates retried manual iMessage saves by interaction id across repository instances", () => {
    const dbPath = tempDatabasePath();
    const userId = "user_manual_retry";
    const firstRepo = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    const firstTools = createRelationshipTools(firstRepo);

    const first = firstTools.create_manual_memory(
      userId,
      "Amaya",
      "met at Photon Residency, AI recruiting founder",
      "manual contact",
      { idempotencyKey: "manual_imessage:interaction_retry_1" }
    );
    firstRepo.close();
    repositories.splice(repositories.indexOf(firstRepo), 1);

    const secondRepo = trackRepository(createSqliteRelationshipRepository({ path: dbPath }));
    const secondTools = createRelationshipTools(secondRepo);
    const second = secondTools.create_manual_memory(
      userId,
      "Amaya",
      "met at Photon Residency, AI recruiting founder",
      "manual contact",
      { idempotencyKey: "manual_imessage:interaction_retry_1" }
    );

    expect(second).toEqual(first);
    expect(secondRepo.listMemories(userId)).toEqual([first]);
    expect(secondRepo.getCandidate(first.candidateId!)).toMatchObject({
      source: "manual_imessage",
      manualIdempotencyKey: "manual_imessage:interaction_retry_1",
      createdFromInteractionId: "interaction_retry_1",
      status: "confirmed"
    });
  });

  it("returns a controlled retryable error when another connection holds the write lock", () => {
    const dbPath = tempDatabasePath();
    const repo = trackRepository(createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        users: [fixtureUser],
        calendarEvents: [fixtureLongEvent, fixtureShortEvent]
      },
      busyTimeoutMs: 1
    }));
    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
    const lockDb = trackCloseable(new DatabaseSync(dbPath));

    lockDb.exec("BEGIN IMMEDIATE");
    try {
      expect(() => repo.confirmCandidate(candidate.id, "locked write", fixtureShortEvent.id)).toThrow(
        SqliteRepositoryBusyError
      );
      try {
        repo.confirmCandidate(candidate.id, "locked write", fixtureShortEvent.id);
      } catch (error) {
        expect(error).toMatchObject({
          code: "SQLITE_BUSY",
          retryable: true
        });
      }
    } finally {
      lockDb.exec("ROLLBACK");
    }

    expect(repo.getCandidate(candidate.id)).toMatchObject({
      status: "pending"
    });
    expect(repo.listMemories(fixtureUser.id)).toEqual([]);
  });

  it("sets schema version and stores explicit insert order columns", () => {
    const dbPath = tempDatabasePath();
    trackRepository(createSqliteRelationshipRepository({ path: dbPath }));

    const db = new DatabaseSync(dbPath);
    try {
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(2);
      for (const table of ["calendar_events", "candidates", "memories", "interactions"]) {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        expect(columns.map((column) => column.name)).toContain("insert_order");
      }
    } finally {
      db.close();
    }
  });
});

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-sqlite-"));
  tempDirs.push(dir);
  return join(dir, "friendy.sqlite");
}

function trackRepository(repository: SqliteRelationshipRepository): SqliteRelationshipRepository {
  repositories.push(repository);
  return repository;
}

function trackCloseable<T extends { close: () => void }>(item: T): T {
  closeables.push(item);
  return item;
}

function sqliteSupportsFts5(): boolean {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE VIRTUAL TABLE temp_fts_support USING fts5(value)");
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

function confirmedCandidate({
  id,
  userId,
  displayName
}: {
  id: string;
  userId: string;
  displayName: string;
}): ContactCandidate {
  return {
    id,
    userId,
    displayName,
    phoneNumbers: ["seeded contact"],
    emails: [],
    detectedAt: "2026-05-21T00:00:00.000Z",
    source: "simulated",
    status: "confirmed"
  };
}
