import { describe, expect, it } from "vitest";
import { rankDisplayNameMatches } from "./personNameMatch";

describe("personNameMatch", () => {
  it("maps Unamed to Unnamed Contact", () => {
    const matches = rankDisplayNameMatches("Unamed", ["Testing 3", "Unnamed Contact", "Testing 1"]);
    expect(matches[0]?.displayName).toBe("Unnamed Contact");
  });

  it.each([
    ["z2", "z2", true],
    ["z2 please", "z2", true],
    ["z2 please", "z", false],
    ["z", "z2", false],
    ["aj", "AJ", true],
    ["alex", "A", false]
  ])("matches short names conservatively: query %s vs name %s", (query, name, shouldMatch) => {
    const matches = rankDisplayNameMatches(query, [name]);
    expect(matches.some((match) => match.displayName === name)).toBe(shouldMatch);
  });
});
