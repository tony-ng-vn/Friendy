import { describe, expect, it } from "vitest";
import { lookupMemoryTarget } from "./memoryTargetLookup";
import type { RelationshipMemory } from "./types";

const userId = "user_fixture";

function memory(
  id: string,
  displayName: string,
  overrides: Partial<RelationshipMemory> = {}
): RelationshipMemory {
  return {
    id,
    userId,
    displayName,
    primaryContactLabel: "+15550101000",
    contextNote: "",
    tags: [],
    confidence: 0.9,
    createdAt: "2026-05-14T23:00:00-07:00",
    updatedAt: "2026-05-14T23:00:00-07:00",
    ...overrides,
  };
}

describe("lookupMemoryTarget", () => {
  it("maps Unamed to Unnamed Contact as a single fuzzy match", () => {
    const memories = [
      memory("memory_testing_3", "Testing 3"),
      memory("memory_unnamed", "Unnamed Contact"),
      memory("memory_testing_1", "Testing 1"),
    ];

    const result = lookupMemoryTarget({
      userId,
      query: "Unamed",
      memories,
    });

    expect(result).toEqual({
      kind: "single",
      memoryId: "memory_unnamed",
      displayName: "Unnamed Contact",
      score: 74,
      matchedVia: "fuzzy",
    });
  });

  it("returns ambiguous when Srah matches Sarah and Sara Kim within the gap", () => {
    const memories = [
      memory("memory_sarah", "Sarah", {
        eventTitle: "Photon dinner",
        contextNote: "met at Photon dinner",
      }),
      memory("memory_sara_kim", "Sara Kim", {
        eventTitle: "recruiting meetup",
        contextNote: "met at recruiting meetup",
      }),
      memory("memory_bob", "Bob"),
    ];

    const result = lookupMemoryTarget({
      userId,
      query: "Srah",
      memories,
    });

    expect(result).toEqual({
      kind: "ambiguous",
      query: "Srah",
      options: [
        { memoryId: "memory_sarah", displayName: "Sarah", score: 74 },
        { memoryId: "memory_sara_kim", displayName: "Sara Kim", score: 73 },
      ],
    });
  });

  it("returns none when no display name clears minScore", () => {
    const memories = [memory("memory_sarah", "Sarah"), memory("memory_bob", "Bob")];

    const result = lookupMemoryTarget({
      userId,
      query: "xyznone",
      memories,
    });

    expect(result).toEqual({
      kind: "none",
      query: "xyznone",
    });
  });

  it("does not fuzzy-match short context text to an unrelated display name", () => {
    const memories = [
      memory("memory_please_work", "Please Work", { contextNote: "Testing Friendy" }),
      memory("memory_testing_12", "Testing 12", { contextNote: "Hi" }),
    ];

    const result = lookupMemoryTarget({
      userId,
      query: "Hi",
      memories,
    });

    expect(result).toEqual({
      kind: "none",
      query: "Hi",
    });
  });

  it("can resolve a memory by exact context note when requested", () => {
    const memories = [
      memory("memory_please_work", "Please Work", { contextNote: "Testing Friendy" }),
      memory("memory_testing_12", "Testing 12", { contextNote: "Hi" }),
    ];

    const result = lookupMemoryTarget({
      userId,
      query: "Hi",
      memories,
      includeContext: true,
    });

    expect(result).toEqual({
      kind: "single",
      memoryId: "memory_testing_12",
      displayName: "Testing 12",
      score: 100,
      matchedVia: "context",
    });
  });

  it("returns single for a high-confidence exact match", () => {
    const memories = [
      memory("memory_sarah", "Sarah"),
      memory("memory_sara_kim", "Sara Kim"),
    ];

    const result = lookupMemoryTarget({
      userId,
      query: "Sarah",
      memories,
    });

    expect(result).toEqual({
      kind: "single",
      memoryId: "memory_sarah",
      displayName: "Sarah",
      score: 100,
      matchedVia: "exact",
    });
  });

  it("ignores memories for other users and deleted memories", () => {
    const memories = [
      memory("memory_unnamed", "Unnamed Contact"),
      memory("memory_other_user", "Unnamed Contact", { userId: "other_user" }),
      memory("memory_deleted", "Unnamed Contact", { deletedAt: "2026-05-15T00:00:00.000Z" }),
    ];

    const result = lookupMemoryTarget({
      userId,
      query: "Unamed",
      memories,
    });

    expect(result.kind).toBe("single");
    if (result.kind === "single") {
      expect(result.memoryId).toBe("memory_unnamed");
    }
  });
});
