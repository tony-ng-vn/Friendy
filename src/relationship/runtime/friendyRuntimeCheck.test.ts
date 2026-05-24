import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import { runFriendyRuntimeCheck } from "./friendyRuntimeCheck";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Friendy foreground runtime check", () => {
  it("exposes an agent:friendy:check package script", () => {
    expect(packageJson.scripts["agent:friendy:check"]).toBe("tsx src/relationship/runtime/friendyRuntimeCheck.ts");
  });

  it("runs fake contact_added events through SQLite runtime and verifies prompt plus ack", async () => {
    const cwd = tempDir();

    const report = await runFriendyRuntimeCheck({ cwd });

    expect(report.ok).toBe(true);
    expect(report.candidateCount).toBe(2);
    expect(report.promptTexts[0]).toContain("Text start and I'll ask about it");
    expect(report.promptTexts[1]).toContain("Photon Residency Dinner");
    expect(report.ackPaths[0]).toContain("history_batch_mock_1.ack");
    expect(report.replayedUnackedBatchAcked).toBe(true);
    expect(report.startGateQueuedBeforeStart).toBe(true);
    expect(report.promptTexts).toHaveLength(2);
    expect(report.lines.join("\n")).toContain("Friendy runtime check passed");
    expect(report.lines.join("\n")).toContain("Start gate: queued contact event before user start");
    expect(report.lines.join("\n")).toContain("Replayed unacked history batch: acked without duplicate prompt");
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-runtime-check-"));
  tempDirs.push(dir);
  return dir;
}
