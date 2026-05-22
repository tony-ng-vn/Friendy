import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import { MACOS_SENSOR_NAME, MACOS_SENSOR_SCHEMA_VERSION } from "./sensorEvents";
import { runMacosSensorFixtureCheck } from "./macosSensorFixtureCheck";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("compiled macOS sensor fixture check", () => {
  it("exposes a package script for validating compiled sensor fixture output", () => {
    expect(packageJson.scripts["check:macos-sensor-fixture"]).toBe(
      "tsx src/relationship/runtime/macosSensorFixtureCheck.ts"
    );
  });

  it("skips cleanly on non-macOS workspaces when the compiled binary is missing", () => {
    const cwd = tempDir();

    const report = runMacosSensorFixtureCheck({
      cwd,
      platform: "linux",
      execFileSync() {
        throw new Error("missing Linux binary should skip before executing");
      }
    });

    expect(report.ok).toBe(true);
    expect(report.skipped).toBe(true);
    expect(report.binaryPath).toBe(join(cwd, "bin/friendy-macos-sensor"));
    expect(report.lines.join("\n")).toContain("Skipped compiled macOS sensor fixture check");
    expect(report.lines.join("\n")).toContain("Run npm run build:macos-sensor on macOS");
  });

  it("fails clearly on macOS when the compiled binary is missing", () => {
    const cwd = tempDir();

    const report = runMacosSensorFixtureCheck({
      cwd,
      platform: "darwin",
      execFileSync() {
        throw new Error("missing macOS binary should fail before executing");
      }
    });

    expect(report.ok).toBe(false);
    expect(report.skipped).toBe(false);
    expect(report.lines.join("\n")).toContain("Missing macOS sensor binary");
    expect(report.lines.join("\n")).toContain("npm run build:macos-sensor");
  });

  it("runs the standalone binary fixture mode and validates redacted contact_added NDJSON", () => {
    const cwd = tempDir();
    const binaryPath = join(cwd, "bin/friendy-macos-sensor");
    mkdirSync(join(cwd, "bin"), { recursive: true });
    writeFileSync(binaryPath, "");

    const calls: Array<{ command: string; args: string[] }> = [];
    const report = runMacosSensorFixtureCheck({
      cwd,
      platform: "darwin",
      execFileSync(command, args) {
        calls.push({ command, args });
        return `${JSON.stringify(contactAddedFixture())}\n`;
      }
    });

    expect(report.ok).toBe(true);
    expect(report.skipped).toBe(false);
    expect(report.eventTypes).toEqual(["contact_added"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(binaryPath);
    expect(calls[0].args).toContain("--state-dir");
    expect(calls[0].args).toContain("--emit-fixture");
    expect(calls[0].args).toContain("contact_added");
    expect(report.lines.join("\n")).toContain("Fixture event types: contact_added");
    expect(report.lines.join("\n")).toContain("Redacted contact methods: present");
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-macos-fixture-check-"));
  tempDirs.push(dir);
  return dir;
}

function contactAddedFixture(): Record<string, unknown> {
  return {
    schemaVersion: MACOS_SENSOR_SCHEMA_VERSION,
    eventId: "sensor_evt_fixture_contact_1",
    type: "contact_added",
    sensorName: MACOS_SENSOR_NAME,
    sensorVersion: "0.1.0",
    runId: "sensor_run_fixture",
    deviceId: "mac_fixture",
    emittedAt: "2026-05-21T18:36:51Z",
    observedAt: "2026-05-21T18:36:50Z",
    idempotencyKey: "contacts:mac_fixture:fixture-contact-1:add",
    historyBatchId: "history_batch_fixture_1",
    historyBatchIndex: 0,
    historyBatchSize: 1,
    historyTokenBeforeRef: "outbox:history_batch_fixture_1:before",
    historyTokenAfterRef: "outbox:history_batch_fixture_1:after",
    detectedAt: "2026-05-21T20:30:00-07:00",
    contact: {
      stableId: "fixture-contact-1",
      unifiedStableId: "fixture-contact-1",
      containerId: "fixture-container",
      displayName: "Maya",
      phoneNumberHashes: ["sha256:fixture-phone"],
      phoneNumberHints: [{ last4: "4567", label: "mobile" }],
      emailHashes: ["sha256:fixture-email"],
      emailHints: [{ domain: "example.com", label: "work" }]
    },
    calendarQuery: {
      startsAt: "2026-05-21T16:30:00-07:00",
      endsAt: "2026-05-21T21:30:00-07:00",
      resultCountBeforeLimit: 1,
      permissionStatus: "authorized"
    },
    calendarMatches: [
      {
        eventIdentifier: "fixture-event-photon-dinner",
        calendarIdentifier: "fixture-calendar-work",
        title: "Photon Residency Dinner",
        startsAt: "2026-05-21T18:00:00-07:00",
        endsAt: "2026-05-21T21:00:00-07:00",
        location: "San Francisco",
        calendarSource: "iCloud",
        calendarTitle: "Work",
        isAllDay: false,
        attendeeCount: 12,
        availability: "busy",
        status: "confirmed",
        isRecurring: false
      }
    ]
  };
}
