import { describe, expect, it } from "vitest";
import {
  hasSubstantiveAdditionalMemoryContent,
  isAdditionalMemoryDecline,
  isAdditionalMemoryTaskSwitch,
  isBareAdditionalMemoryAffirmative
} from "./additionalMemoryCapture";

describe("additionalMemoryCapture", () => {
  it("detects decline replies", () => {
    expect(isAdditionalMemoryDecline("no")).toBe(true);
    expect(isAdditionalMemoryDecline("Nothing else, thanks.")).toBe(true);
    expect(isAdditionalMemoryDecline("That's it")).toBe(true);
    expect(isAdditionalMemoryDecline("That\u2019s it")).toBe(true);
    expect(isAdditionalMemoryDecline("He is my best friend")).toBe(false);
    expect(hasSubstantiveAdditionalMemoryContent("That's it")).toBe(false);
  });

  it("detects bare affirmatives", () => {
    expect(isBareAdditionalMemoryAffirmative("yes")).toBe(true);
    expect(isBareAdditionalMemoryAffirmative("yeah")).toBe(true);
  });

  it("accepts substantive follow-up notes", () => {
    expect(hasSubstantiveAdditionalMemoryContent("He also plays piano")).toBe(true);
    expect(hasSubstantiveAdditionalMemoryContent("yes")).toBe(false);
    expect(hasSubstantiveAdditionalMemoryContent("Who did I run into from high school at Photon?")).toBe(false);
  });

  it("detects new tasks that should leave the optional capture loop", () => {
    expect(isAdditionalMemoryTaskSwitch("Who did I run into from high school at Photon?")).toBe(true);
    expect(isAdditionalMemoryTaskSwitch("Can you change her context?")).toBe(true);
    expect(isAdditionalMemoryTaskSwitch("He also plays piano")).toBe(false);
  });
});
