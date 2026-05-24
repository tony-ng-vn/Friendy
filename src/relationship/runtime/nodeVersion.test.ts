import { describe, expect, it } from "vitest";
import packageJson from "../../../package.json";

describe("runtime Node version contract", () => {
  it("pins Node 24 or newer because Friendy uses node:sqlite", () => {
    expect(packageJson.engines?.node).toBe(">=24");
  });
});
