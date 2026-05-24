import { describe, expect, it } from "vitest";
import { buildExpressionFactBundle } from "./expressionBundleFactory";
import type { RelationshipMemory } from "./types";

function memory(overrides: Partial<RelationshipMemory> = {}): RelationshipMemory {
  return {
    id: "mem-1",
    userId: "user-1",
    displayName: "Sarah Fan",
    primaryContactLabel: "number ending in 4567",
    eventTitle: "Photon Residency II",
    contextNote: "project: community lead",
    tags: [],
    confidence: 0.9,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides
  };
}

describe("buildExpressionFactBundle", () => {
  it("builds save confirmation bundles from memories", () => {
    const draft = "Got it, saved Maya Chen from Photon dinner.";
    const bundle = buildExpressionFactBundle({
      kind: "save_confirmation",
      draft,
      memories: [
        memory({
          displayName: "Maya Chen",
          eventTitle: "Photon dinner",
          contextNote: "project: building recruiting agents"
        })
      ]
    });

    expect(bundle?.kind).toBe("save_confirmation");
    expect(bundle?.allowedPeopleNames).toEqual(["Maya Chen"]);
    expect(JSON.stringify(bundle)).not.toMatch(/mem-1|user-1/);
  });

  it("builds single search match bundles with allowed contact hints", () => {
    const draft = "I think that was Sarah Fan.";
    const bundle = buildExpressionFactBundle({
      kind: "search_single_match",
      draft,
      memory: memory()
    });

    expect(bundle?.kind).toBe("search_single_match");
    expect(bundle?.allowedContactHints).toEqual(["number ending in 4567"]);
    expect(bundle?.allowedEventNames).toEqual(["Photon Residency II"]);
  });

  it("builds ambiguous search bundles from ranked matches", () => {
    const draft = "Which person do you mean?";
    const bundle = buildExpressionFactBundle({
      kind: "search_ambiguous_matches",
      draft,
      matches: [
        { memory: memory({ displayName: "Maya Chen", eventTitle: "Photon dinner" }), score: 0.8, reason: "name" },
        { memory: memory({ id: "mem-2", displayName: "Maya Patel", eventTitle: "Agents meetup" }), score: 0.7, reason: "name" }
      ]
    });

    expect(bundle?.kind).toBe("search_ambiguous_matches");
    expect(bundle?.ambiguity).toBe(true);
    expect(bundle?.allowedPeopleNames).toEqual(["Maya Chen", "Maya Patel"]);
  });

  it("returns undefined for empty drafts", () => {
    expect(
      buildExpressionFactBundle({
        kind: "clarification",
        draft: "   ",
        questionIntent: "search_clue"
      })
    ).toBeUndefined();
  });
});
