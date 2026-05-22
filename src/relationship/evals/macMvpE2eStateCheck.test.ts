import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import { runMacMvpE2eStateCheck } from "./macMvpE2eStateCheck";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Mac MVP live E2E state check", () => {
  it("exposes the live state checker script", () => {
    expect(packageJson.scripts["check:mac-mvp-e2e-state"]).toBe("tsx src/relationship/evals/macMvpE2eStateCheck.ts");
  });

  it("passes when live artifacts contain a named contact event, ack, and saved memory", () => {
    const cwd = tempDir();
    const stateDir = join(cwd, ".friendy/macos-sensor-state");
    const sqlitePath = join(cwd, ".friendy/friendy.sqlite");
    const ackPath = join(stateDir, "acks/history_batch_testing_7.ack");
    mkdirSync(join(stateDir, "acks"), { recursive: true });
    writeFileSync(ackPath, "");
    writeSensorEvents(stateDir, [
      contactAddedEvent({ displayName: "Testing Seven", historyBatchId: "history_batch_testing_7" }),
      historyBatchCompleteEvent({ historyBatchId: "history_batch_testing_7", ackPath })
    ]);
    writeSqlite(sqlitePath, {
      candidates: [{ displayName: "Testing Seven", status: "confirmed" }],
      memories: [{ displayName: "Testing Seven", eventTitle: "Friendy MVP test", contextNote: "met at home" }]
    });

    const report = runMacMvpE2eStateCheck({ cwd });

    expect(report.ok).toBe(true);
    expect(report.latestContactName).toBe("Testing Seven");
    expect(report.latestHistoryBatchId).toBe("history_batch_testing_7");
    expect(report.memoryCount).toBe(1);
    expect(report.lines.join("\n")).toContain("Latest contact_added: Testing Seven");
    expect(report.lines.join("\n")).toContain("History batch ack: present");
    expect(report.lines.join("\n")).toContain("Saved memories: 1");
  });

  it("fails with a useful diagnostic when polling is alive but no contact event exists", () => {
    const cwd = tempDir();
    const stateDir = join(cwd, ".friendy/macos-sensor-state");
    mkdirSync(stateDir, { recursive: true });
    writeSensorEvents(stateDir, [
      {
        ...baseEvent("sensor_diagnostic"),
        code: "contacts_history_poll_no_changes",
        pendingContactCount: 0,
        nextCheckInSeconds: 5
      }
    ]);

    const report = runMacMvpE2eStateCheck({ cwd });

    expect(report.ok).toBe(false);
    expect(report.latestContactName).toBeUndefined();
    expect(report.diagnosticCodes).toEqual(["contacts_history_poll_no_changes"]);
    expect(report.lines.join("\n")).toContain("Latest sensor diagnostic: contacts_history_poll_no_changes");
    expect(report.lines.join("\n")).toContain("No contact_added event found after start");
  });

  it("fails when the latest contact is unnamed or no memory has been saved", () => {
    const cwd = tempDir();
    const stateDir = join(cwd, ".friendy/macos-sensor-state");
    mkdirSync(stateDir, { recursive: true });
    writeSensorEvents(stateDir, [contactAddedEvent({ displayName: "Unnamed Contact" })]);
    writeSqlite(join(cwd, ".friendy/friendy.sqlite"), {
      candidates: [{ displayName: "Unnamed Contact", status: "prompted" }],
      memories: []
    });

    const report = runMacMvpE2eStateCheck({ cwd });

    expect(report.ok).toBe(false);
    expect(report.lines.join("\n")).toContain("Latest contact_added: Unnamed Contact");
    expect(report.lines.join("\n")).toContain("Named post-start contact: missing");
    expect(report.lines.join("\n")).toContain("Saved memories: 0");
  });
});

function tempDir(): string {
  const dir = join(tmpdir(), `friendy-mac-e2e-state-${crypto.randomUUID()}`);
  tempDirs.push(dir);
  return dir;
}

function writeSensorEvents(stateDir: string, events: Array<Record<string, unknown>>): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "sensor-events.ndjson"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

function writeSqlite(
  sqlitePath: string,
  seed: {
    candidates: Array<{ displayName: string; status: string }>;
    memories: Array<{ displayName: string; eventTitle?: string; contextNote?: string }>;
  }
): void {
  mkdirSync(join(sqlitePath, ".."), { recursive: true });
  const db = new DatabaseSync(sqlitePath);
  try {
    db.exec(`
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        insert_order INTEGER NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        insert_order INTEGER NOT NULL,
        display_name TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );
    `);
    for (const [index, candidate] of seed.candidates.entries()) {
      db.prepare("INSERT INTO candidates (id, insert_order, display_name, status, raw_json) VALUES (?, ?, ?, ?, ?)").run(
        `candidate_${index}`,
        index,
        candidate.displayName,
        candidate.status,
        JSON.stringify(candidate)
      );
    }
    for (const [index, memory] of seed.memories.entries()) {
      db.prepare("INSERT INTO memories (id, insert_order, display_name, raw_json) VALUES (?, ?, ?, ?)").run(
        `memory_${index}`,
        index,
        memory.displayName,
        JSON.stringify(memory)
      );
    }
  } finally {
    db.close();
  }
}

function contactAddedEvent({
  displayName,
  historyBatchId = "history_batch_testing"
}: {
  displayName: string;
  historyBatchId?: string;
}): Record<string, unknown> {
  return {
    ...baseEvent("contact_added"),
    observedAt: "2026-05-22T09:10:05Z",
    idempotencyKey: `contacts:mac:test-${displayName}:add`,
    historyBatchId,
    historyBatchIndex: 0,
    historyBatchSize: 1,
    historyTokenBeforeRef: `outbox:${historyBatchId}:before`,
    historyTokenAfterRef: `outbox:${historyBatchId}:after`,
    detectedAt: "2026-05-22T09:10:05Z",
    contact: {
      stableId: `stable-${displayName}`,
      displayName,
      phoneNumberHashes: ["sha256:test"],
      phoneNumberHints: [{ last4: "4567", label: "mobile" }],
      emailHashes: [],
      emailHints: []
    },
    calendarQuery: {
      startsAt: "2026-05-22T05:10:05Z",
      endsAt: "2026-05-22T10:10:05Z",
      resultCountBeforeLimit: 0,
      permissionStatus: "authorized"
    },
    calendarMatches: []
  };
}

function historyBatchCompleteEvent({
  historyBatchId,
  ackPath
}: {
  historyBatchId: string;
  ackPath: string;
}): Record<string, unknown> {
  return {
    ...baseEvent("history_batch_complete"),
    historyBatchId,
    contactEventIds: ["sensor_evt_contact_1"],
    ackPath
  };
}

function baseEvent(type: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    eventId: type === "contact_added" ? "sensor_evt_contact_1" : `sensor_evt_${type}`,
    type,
    sensorName: "macos_contacts_calendar",
    sensorVersion: "0.1.0",
    runId: "sensor_run_test",
    deviceId: "mac_test",
    emittedAt: "2026-05-22T09:10:05Z"
  };
}
