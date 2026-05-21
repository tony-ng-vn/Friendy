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
});

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-sqlite-"));
  tempDirs.push(dir);
  return join(dir, "friendy.sqlite");
}
