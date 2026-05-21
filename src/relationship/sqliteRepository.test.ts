import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent, fixtureUser } from "./fixtures";
import { createSqliteRelationshipRepository } from "./sqliteRepository";
import { createRelationshipTools } from "./tools";
import type { AgentInteraction, EventContextMatch, RelationshipMemory } from "./types";

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

  it("accepts writes for unseeded users like the in-memory repository", () => {
    const dbPath = tempDatabasePath();
    const repo = createSqliteRelationshipRepository({ path: dbPath });
    const userId = "user_unseeded";

    const candidate = repo.createCandidateFromDetectedContact({
      ...fixtureDetectedContact,
      userId,
      displayName: "Unseeded Person",
      detectedAt: "2026-05-16T09:30:00-07:00"
    });
    expect(repo.listPendingCandidates(userId).map((item) => item.displayName)).toEqual(["Unseeded Person"]);

    repo.addMemory({
      id: "memory_unseeded_1",
      userId,
      displayName: "Unseeded Person",
      primaryContactLabel: "+15550101020",
      contextNote: "met at an unseeded runtime check",
      tags: ["met", "unseeded", "runtime", "check"],
      confidence: 0.7,
      createdAt: "2026-05-21T01:00:00.000Z",
      updatedAt: "2026-05-21T01:00:00.000Z"
    });
    repo.addInteraction({
      id: "interaction_unseeded_1",
      userId,
      platform: "imessage",
      inboundText: "remember this unseeded user",
      outboundText: "Saved Unseeded Person.",
      toolCalls: ["create_manual_memory"],
      createdAt: "2026-05-21T01:01:00.000Z"
    });

    const reopened = createSqliteRelationshipRepository({ path: dbPath });
    expect(reopened.listPendingCandidates(userId).map((item) => item.displayName)).toEqual(["Unseeded Person"]);
    expect(reopened.listMemories(userId)).toEqual([
      expect.objectContaining({
        id: "memory_unseeded_1",
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

  it("preserves orphan event match and memory seeds like the in-memory repository", () => {
    const dbPath = tempDatabasePath();
    const userId = "user_orphan_seed";
    const orphanMatch: EventContextMatch = {
      id: "match_orphan_seed",
      candidateId: "candidate_missing",
      calendarEventId: "event_missing",
      eventTitle: "Missing Event",
      confidence: 0.5,
      reason: "Seeded without related rows.",
      rank: 1
    };
    const orphanMemory: RelationshipMemory = {
      id: "memory_orphan_seed",
      userId,
      candidateId: "candidate_missing",
      displayName: "Orphan Seed Person",
      primaryContactLabel: "seeded contact",
      contextNote: "seeded memory with missing candidate",
      tags: ["seeded", "missing", "candidate"],
      confidence: 0.6,
      createdAt: "2026-05-21T02:00:00.000Z",
      updatedAt: "2026-05-21T02:00:00.000Z"
    };

    createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        eventMatches: [orphanMatch],
        memories: [orphanMemory]
      }
    });

    const reopened = createSqliteRelationshipRepository({ path: dbPath });
    expect(reopened.listEventMatches("candidate_missing")).toEqual([orphanMatch]);
    expect(reopened.listMemories(userId)).toEqual([orphanMemory]);
  });

  it("preserves memory and interaction insertion order instead of sorting by createdAt", () => {
    const dbPath = tempDatabasePath();
    const userId = "user_ordering";
    const firstMemory: RelationshipMemory = {
      id: "memory_order_first",
      userId,
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

    createSqliteRelationshipRepository({
      path: dbPath,
      seed: {
        memories: [firstMemory, secondMemory],
        interactions: [firstInteraction, secondInteraction]
      }
    });

    const reopened = createSqliteRelationshipRepository({ path: dbPath });
    expect(reopened.listMemories(userId).map((memory) => memory.id)).toEqual([
      "memory_order_first",
      "memory_order_second"
    ]);
    expect(reopened.listInteractions(userId).map((interaction) => interaction.id)).toEqual([
      "interaction_order_first",
      "interaction_order_second"
    ]);
  });
});

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-sqlite-"));
  tempDirs.push(dir);
  return join(dir, "friendy.sqlite");
}
