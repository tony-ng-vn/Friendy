import { describe, expect, it } from "vitest";
import { rankDisplayNameMatches } from "./personNameMatch";

describe("personNameMatch", () => {
  it("maps Unamed to Unnamed Contact", () => {
    const matches = rankDisplayNameMatches("Unamed", ["Testing 3", "Unnamed Contact", "Testing 1"]);
    expect(matches[0]?.displayName).toBe("Unnamed Contact");
  });
});
