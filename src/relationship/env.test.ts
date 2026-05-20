import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFriendyEnv, readSpectrumCredentials } from "./env";

const ORIGINAL_PROJECT_ID = process.env.SPECTRUM_PROJECT_ID;
const ORIGINAL_PROJECT_SECRET = process.env.SPECTRUM_PROJECT_SECRET;

describe("friendy env loading", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "friendy-env-"));
    delete process.env.SPECTRUM_PROJECT_ID;
    delete process.env.SPECTRUM_PROJECT_SECRET;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    restoreEnv("SPECTRUM_PROJECT_ID", ORIGINAL_PROJECT_ID);
    restoreEnv("SPECTRUM_PROJECT_SECRET", ORIGINAL_PROJECT_SECRET);
  });

  it("loads Spectrum credentials from .env.local for standalone agent scripts", () => {
    writeFileSync(
      join(dir, ".env.local"),
      "SPECTRUM_PROJECT_ID=project_from_local\nSPECTRUM_PROJECT_SECRET=secret_from_local\n"
    );

    const loaded = loadFriendyEnv(dir);
    const credentials = readSpectrumCredentials();

    expect(loaded).toEqual([".env.local"]);
    expect(credentials).toEqual({
      projectId: "project_from_local",
      projectSecret: "secret_from_local"
    });
  });

  it("keeps shell-provided credentials ahead of .env.local", () => {
    process.env.SPECTRUM_PROJECT_ID = "project_from_shell";
    writeFileSync(
      join(dir, ".env.local"),
      "SPECTRUM_PROJECT_ID=project_from_local\nSPECTRUM_PROJECT_SECRET=secret_from_local\n"
    );

    loadFriendyEnv(dir);
    const credentials = readSpectrumCredentials();

    expect(credentials).toEqual({
      projectId: "project_from_shell",
      projectSecret: "secret_from_local"
    });
  });
});

function restoreEnv(key: "SPECTRUM_PROJECT_ID" | "SPECTRUM_PROJECT_SECRET", value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
