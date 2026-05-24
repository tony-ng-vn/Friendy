import { describe, expect, it } from "vitest";
import {
  appendRecentEntityRef,
  appendRouteHistory,
  emptySession,
  MAX_RECENT_ENTITY_REFS,
  MAX_ROUTE_HISTORY,
  migrateFromLegacyContext,
  touchUpdatedAt
} from "./conversationSession";

const sessionKey = {
  userId: "user_fixture",
  platform: "imessage" as const,
  spaceId: "space_testing"
};

describe("conversation session", () => {
  it("creates empty defaults for a session key", () => {
    const session = emptySession(sessionKey, "2026-05-20T12:00:00.000Z");

    expect(session.key).toEqual(sessionKey);
    expect(session.recentEntityRefs).toEqual([]);
    expect(session.routeHistory).toEqual([]);
    expect(session.updatedAt).toBe("2026-05-20T12:00:00.000Z");
    expect(session.version).toBe(1);
    expect(session.activeWorkflow).toBeUndefined();
    expect(session.carryover).toBeUndefined();
  });

  it("caps routeHistory at ten entries", () => {
    let session = emptySession(sessionKey);

    for (let index = 0; index < MAX_ROUTE_HISTORY + 3; index += 1) {
      session = appendRouteHistory(session, {
        intent: `intent_${index}`,
        routeSource: "llm",
        createdAt: `2026-05-20T12:0${index % 10}:00.000Z`
      });
    }

    expect(session.routeHistory).toHaveLength(MAX_ROUTE_HISTORY);
    expect(session.routeHistory[0]?.intent).toBe("intent_3");
    expect(session.routeHistory.at(-1)?.intent).toBe(`intent_${MAX_ROUTE_HISTORY + 2}`);
  });

  it("caps recentEntityRefs at ten entries", () => {
    let session = emptySession(sessionKey);

    for (let index = 0; index < MAX_RECENT_ENTITY_REFS + 2; index += 1) {
      session = appendRecentEntityRef(session, {
        kind: "memory",
        id: `memory_${index}`,
        displayName: `Person ${index}`,
        referencedAt: `2026-05-20T12:0${index % 10}:00.000Z`
      });
    }

    expect(session.recentEntityRefs).toHaveLength(MAX_RECENT_ENTITY_REFS);
    expect(session.recentEntityRefs[0]?.displayName).toBe("Person 2");
    expect(session.recentEntityRefs.at(-1)?.displayName).toBe("Person 11");
  });

  it("updates updatedAt without changing version", () => {
    const session = emptySession(sessionKey, "2026-05-20T12:00:00.000Z");
    const touched = touchUpdatedAt(session, "2026-05-20T12:05:00.000Z");

    expect(touched.updatedAt).toBe("2026-05-20T12:05:00.000Z");
    expect(touched.version).toBe(1);
  });

  it("migrates legacy conversation context into session fields", () => {
    const session = migrateFromLegacyContext(
      sessionKey,
      {
        activeEventName: "Photon Residency",
        activeDateContext: {
          rawText: "last Tuesday",
          localDate: "2026-05-13",
          startsAt: "2026-05-13T00:00:00.000Z",
          timezone: "UTC"
        },
        lastSearch: {
          searchContextId: "search_1",
          createdAt: "2026-05-20T12:00:00.000Z",
          expiresAt: "2026-05-20T12:15:00.000Z",
          originalQuery: "Photon",
          candidateMemoryIds: ["memory_sarah"],
          lastQuestion: "Who did I meet at Photon?"
        },
        activeMemoryId: "memory_sarah",
        pendingDelete: {
          memoryId: "memory_unnamed",
          displayName: "Unnamed Contact"
        },
        recentPeople: Array.from({ length: 12 }, (_, index) => `Person ${index}`)
      },
      "2026-05-20T12:10:00.000Z"
    );

    expect(session.activeWorkflow).toEqual({
      kind: "pending_delete_confirm",
      memoryId: "memory_unnamed",
      displayName: "Unnamed Contact",
      query: "Unnamed Contact",
      openedAt: "2026-05-20T12:10:00.000Z"
    });
    expect(session.lastSearch?.originalQuery).toBe("Photon");
    expect(session.activeMemoryId).toBe("memory_sarah");
    expect(session.carryover?.activeEventName).toBe("Photon Residency");
    expect(session.carryover?.recentPeople).toHaveLength(10);
    expect(session.carryover?.recentPeople[0]).toBe("Person 2");
  });
});
