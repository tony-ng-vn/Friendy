import { describe, expect, it } from "vitest";
import {
  computeMethodFingerprint,
  displayNamesCollide,
  findDisplayNameCollisions,
  normalizeDisplayNameForIdentity
} from "./personIdentity";

describe("personIdentity", () => {
  describe("normalizeDisplayNameForIdentity", () => {
    it("trims, lowercases, and collapses whitespace", () => {
      expect(normalizeDisplayNameForIdentity("  Testing   3  ")).toBe("testing 3");
    });
  });

  describe("displayNamesCollide", () => {
    it("detects normalized display-name collisions", () => {
      expect(displayNamesCollide("Testing 3", "testing 3")).toBe(true);
      expect(displayNamesCollide("Testing 3", "Testing 4")).toBe(false);
    });

    it("does not treat empty names as collisions", () => {
      expect(displayNamesCollide("   ", "Testing 3")).toBe(false);
    });
  });

  describe("findDisplayNameCollisions", () => {
    it("returns saved names that collide with the candidate display name", () => {
      expect(findDisplayNameCollisions("testing 3", ["Maya Chen", "Testing 3", "Testing 3 "])).toEqual([
        "Testing 3",
        "Testing 3 "
      ]);
    });
  });

  describe("computeMethodFingerprint", () => {
    it("is stable regardless of phone and email order", () => {
      const left = computeMethodFingerprint({
        phoneNumbers: ["+15550101020", "+15550101001"],
        emails: ["nina@example.com", "alex@example.com"]
      });
      const right = computeMethodFingerprint({
        emails: ["ALEX@EXAMPLE.COM", "nina@example.com"],
        phoneNumbers: ["+1 (555) 010-1001", "+15550101020"]
      });

      expect(left).toBe(right);
    });

    it("changes when a normalized contact method differs", () => {
      const baseline = computeMethodFingerprint({
        phoneNumbers: ["+15550101001"],
        emails: ["alex@example.com"]
      });
      const changed = computeMethodFingerprint({
        phoneNumbers: ["+15550101002"],
        emails: ["alex@example.com"]
      });

      expect(baseline).not.toBe(changed);
    });

    it("hashes an empty method set deterministically", () => {
      expect(computeMethodFingerprint({})).toBe(computeMethodFingerprint({ phoneNumbers: [], emails: [] }));
    });
  });
});
