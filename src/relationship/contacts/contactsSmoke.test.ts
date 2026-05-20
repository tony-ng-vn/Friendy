import { describe, expect, it, vi } from "vitest";
import packageJson from "../../../package.json";
import {
  buildMacContactsAppleScript,
  parseContactsSmokeArgs,
  runContactsSmoke,
  validateFriendySmokeContactName
} from "./contactsSmoke";

describe("explicit Contacts smoke command safety", () => {
  it("accepts only Friendy-number test contact names", () => {
    expect(validateFriendySmokeContactName("Friendy-001")).toEqual({ ok: true });
    expect(validateFriendySmokeContactName("Friendy-test")).toEqual({
      ok: false,
      reason: "Contact smoke names must match Friendy-<number>, for example Friendy-001."
    });
  });

  it("parses explicit smoke args and derives a deterministic test phone", () => {
    expect(parseContactsSmokeArgs(["--name", "Friendy-042"])).toEqual({
      name: "Friendy-042",
      phoneNumber: "+15550000042"
    });
  });

  it("builds an idempotent macOS Contacts script for one exact test contact", () => {
    const script = buildMacContactsAppleScript({ name: "Friendy-042", phoneNumber: "+15550000042" });

    expect(script).toContain('set friendyName to "Friendy-042"');
    expect(script).toContain('set friendyPhone to "+15550000042"');
    expect(script).toContain('set matches to people whose name is friendyName');
    expect(script).toContain("make new person");
    expect(script).toContain("save");
  });

  it("fails clearly outside macOS without touching Contacts", () => {
    const execFileSync = vi.fn();
    const result = runContactsSmoke({
      argv: ["--name", "Friendy-001"],
      platform: "linux",
      execFileSync
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("macOS Contacts smoke test is only available on darwin");
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("exposes the real Contacts smoke command as an explicit npm script", () => {
    expect(packageJson.scripts["ingest:contacts:smoke"]).toBe("tsx src/relationship/contacts/contactsSmokeCli.ts");
  });
});
