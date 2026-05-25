import { describe, expect, it } from "vitest";
import { cleanMemoryTargetQuery } from "./targetQueryCleanup";

describe("cleanMemoryTargetQuery", () => {
  it.each([
    ["Z2 please", "Z2"],
    ["Z2 pls", "Z2"],
    ["Sarah thanks", "Sarah"],
    ["Sarah thank you", "Sarah"],
    ["Z from memory", "Z"],
    ["Z for me", "Z"],
    ["Z?", "Z"],
    ["delete Z2 please", "Z2"],
    ["forget AJ from memory", "AJ"],
    ["me one Daniel please", "Daniel"],
    ["one Daniel", "Daniel"]
  ])("cleans %s to %s", (query, expected) => {
    expect(cleanMemoryTargetQuery(query)).toBe(expected);
  });
});
