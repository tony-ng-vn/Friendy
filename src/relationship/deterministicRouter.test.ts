import { describe, expect, it } from "vitest";
import { routeDeterministicRelationshipRequest } from "./deterministicRouter";

describe("routeDeterministicRelationshipRequest", () => {
  it.each([
    "What are all the people I know?",
    "Who are all the people I know?",
    "List all people I know",
    "Show everyone I remember",
    "List me everyone",
    "List everyone"
  ])("routes broad people inventory deterministically: %s", (text) => {
    expect(routeDeterministicRelationshipRequest({ text })).toEqual({
      kind: "list_people",
      reason: "broad_people_inventory"
    });
  });

  it("keeps event recall out of the broad inventory route", () => {
    expect(routeDeterministicRelationshipRequest({ text: "Who did I meet at AI dinner?" })).toBeUndefined();
  });
});
