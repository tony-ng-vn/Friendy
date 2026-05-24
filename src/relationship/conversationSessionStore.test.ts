import { describe, expect, it } from "vitest";
import { emptySession } from "./conversationSession";
import { createInMemoryConversationSessionStore } from "./conversationSessionStore";

describe("conversation session store", () => {
  it("returns undefined for missing sessions", () => {
    const store = createInMemoryConversationSessionStore();

    expect(
      store.getSession({
        userId: "user_fixture",
        platform: "imessage"
      })
    ).toBeUndefined();
  });

  it("upserts and retrieves sessions by normalized key", () => {
    const store = createInMemoryConversationSessionStore();
    const key = {
      userId: "user_fixture",
      platform: "terminal" as const,
      spaceId: "space_a"
    };
    const created = store.upsertSession(
      emptySession(key, "2026-05-20T12:00:00.000Z")
    );

    expect(store.getSession(key)?.updatedAt).toBe("2026-05-20T12:00:00.000Z");
    expect(store.getSession({ ...key, spaceId: undefined })).toBeUndefined();

    const updated = store.upsertSession({
      ...created,
      updatedAt: "2026-05-20T12:05:00.000Z"
    });

    expect(updated.version).toBe(2);
    expect(store.getSession(key)?.version).toBe(2);
    expect(store.getSession(key)?.updatedAt).toBe("2026-05-20T12:05:00.000Z");
  });

  it("treats nullish spaceId as the same cache key", () => {
    const store = createInMemoryConversationSessionStore();
    const session = emptySession(
      {
        userId: "user_fixture",
        platform: "imessage"
      },
      "2026-05-20T12:00:00.000Z"
    );

    store.upsertSession(session);

    expect(
      store.getSession({
        userId: "user_fixture",
        platform: "imessage",
        spaceId: undefined
      })?.updatedAt
    ).toBe("2026-05-20T12:00:00.000Z");
    expect(
      store.getSession({
        userId: "user_fixture",
        platform: "imessage",
        spaceId: ""
      })?.updatedAt
    ).toBe("2026-05-20T12:00:00.000Z");
  });

  it("deletes sessions by key", () => {
    const store = createInMemoryConversationSessionStore();
    const key = {
      userId: "user_fixture",
      platform: "web" as const
    };

    store.upsertSession(emptySession(key));
    expect(store.getSession(key)).toBeDefined();

    store.deleteSession(key);
    expect(store.getSession(key)).toBeUndefined();
  });
});
