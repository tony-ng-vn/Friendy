import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  MACOS_SENSOR_CONTACT_IDENTIFIER_SNAPSHOT,
  MACOS_SENSOR_RESET_CONTACT_SNAPSHOT_SIGNAL,
  requestMacosSensorContactSnapshotReset
} from "./macosSensorState";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-macos-sensor-state-"));
  tempDirs.push(dir);
  return dir;
}

describe("requestMacosSensorContactSnapshotReset", () => {
  it("writes a reset signal even when the snapshot file is missing", () => {
    const dir = tempDir();
    const result = requestMacosSensorContactSnapshotReset(dir);

    expect(result).toEqual({ removedSnapshot: false, wroteSignal: true });
    expect(
      readFileSync(join(dir, MACOS_SENSOR_RESET_CONTACT_SNAPSHOT_SIGNAL), "utf8").trim().length
    ).toBeGreaterThan(0);
    expect(existsSync(join(dir, MACOS_SENSOR_CONTACT_IDENTIFIER_SNAPSHOT))).toBe(false);
  });

  it("removes an existing snapshot and writes the reset signal", () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    const snapshotPath = join(dir, MACOS_SENSOR_CONTACT_IDENTIFIER_SNAPSHOT);
    writeFileSync(snapshotPath, "[]\n");

    const result = requestMacosSensorContactSnapshotReset(dir);

    expect(result).toEqual({ removedSnapshot: true, wroteSignal: true });
    expect(existsSync(snapshotPath)).toBe(false);
    expect(existsSync(join(dir, MACOS_SENSOR_RESET_CONTACT_SNAPSHOT_SIGNAL))).toBe(true);
  });
});
