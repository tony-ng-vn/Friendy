import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import { resolveFriendyRuntimeConfig, startFriendyForegroundRuntime } from "./friendyRuntimeCli";
import type { SensorChildProcess, SensorRuntimeLineProcessor } from "./sensorProcess";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Friendy foreground runtime CLI configuration", () => {
  it("exposes the agent:friendy script", () => {
    expect(packageJson.scripts["agent:friendy"]).toBe("tsx src/relationship/runtime/friendyRuntimeCli.ts");
  });

  it("defaults the foreground runtime to local SQLite and the repo-local sensor state directory", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "friendy-macos-sensor"), "");

    const config = resolveFriendyRuntimeConfig({
      cwd,
      env: {
        FRIENDY_SENSOR_BINARY_PATH: join(cwd, "friendy-macos-sensor")
      }
    });

    expect(config.runtimeStore).toBe("sqlite");
    expect(config.sqlitePath).toBe(join(cwd, ".friendy/friendy.sqlite"));
    expect(config.sensorStateDir).toBe(join(cwd, ".friendy/macos-sensor-state"));
    expect(config.sensor.mode).toBe("real");
    expect(config.sensor.command).toBe(join(cwd, "friendy-macos-sensor"));
    expect(config.sensor.args).toEqual(["--state-dir", join(cwd, ".friendy/macos-sensor-state")]);
  });

  it("uses the fake sensor when FRIENDY_SENSOR_MOCK=1", () => {
    const cwd = tempDir();

    const config = resolveFriendyRuntimeConfig({
      cwd,
      env: {
        FRIENDY_SENSOR_MOCK: "1"
      }
    });

    expect(config.sensor.mode).toBe("mock");
    expect(config.sensor.command).toBe("tsx");
    expect(config.sensor.args).toEqual(["src/relationship/runtime/fakeMacosSensor.ts"]);
  });

  it("throws a clear error when the real sensor binary is missing", () => {
    const cwd = tempDir();

    expect(() => resolveFriendyRuntimeConfig({ cwd, env: {} })).toThrow(/friendy-macos-sensor/);
  });

  it("wires fake sensor lines into a SQLite-backed runtime", async () => {
    const cwd = tempDir();
    let runtime: SensorRuntimeLineProcessor | undefined;
    const prompts: Array<{ userId: string; candidateId?: string; text: string }> = [];

    const started = await startFriendyForegroundRuntime({
      cwd,
      env: {
        FRIENDY_SENSOR_MOCK: "1",
        FRIENDY_LOCAL_USER_ID: "user_friendy"
      },
      sender: {
        async sendPrompt(input) {
          prompts.push(input);
          return { interactionId: "interaction_prompt_1" };
        }
      },
      startSensor({ launch, runtime: startedRuntime }) {
        runtime = startedRuntime;
        expect(launch.mode).toBe("mock");
        return { child: fakeChildProcess() };
      },
      logger: testLogger()
    });

    await runtime?.processLine(JSON.stringify(contactAddedEvent()));

    expect(started.repo.listPendingCandidates("user_friendy")[0]).toMatchObject({
      displayName: "Maya",
      contactIdentifier: "ABCD-1234"
    });
    expect(started.state.getProcessedEvent("contacts:mac_1:ABCD-1234:add")).toMatchObject({
      status: "candidate_created"
    });
    expect(prompts[0].text).toContain("Photon Residency Dinner");
    started.close();
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-runtime-cli-"));
  tempDirs.push(dir);
  return dir;
}

function testLogger() {
  return {
    info() {},
    warn() {},
    error() {}
  };
}

function fakeChildProcess(): SensorChildProcess {
  const child = new EventEmitter() as SensorChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

function contactAddedEvent() {
  return {
    schemaVersion: 1,
    eventId: "sensor_evt_contact_1",
    type: "contact_added",
    sensorName: "macos_contacts_calendar",
    sensorVersion: "0.1.0",
    runId: "sensor_run_1",
    deviceId: "mac_1",
    emittedAt: "2026-05-21T18:36:51Z",
    observedAt: "2026-05-21T18:36:50Z",
    idempotencyKey: "contacts:mac_1:ABCD-1234:add",
    historyBatchId: "history_batch_1",
    historyBatchIndex: 0,
    historyBatchSize: 1,
    historyTokenBeforeRef: "outbox:history_batch_1:before",
    historyTokenAfterRef: "outbox:history_batch_1:after",
    detectedAt: "2026-05-21T20:30:00-07:00",
    contact: {
      stableId: "ABCD-1234",
      unifiedStableId: "UNIFIED-ABCD-1234",
      containerId: "icloud_container",
      displayName: "Maya",
      phoneNumberHashes: ["sha256:phone"],
      phoneNumberHints: [{ last4: "4567", label: "mobile" }],
      emailHashes: [],
      emailHints: []
    },
    calendarQuery: {
      startsAt: "2026-05-21T16:30:00-07:00",
      endsAt: "2026-05-21T21:30:00-07:00",
      resultCountBeforeLimit: 1,
      permissionStatus: "authorized"
    },
    calendarMatches: [
      {
        eventIdentifier: "event_photon_dinner",
        calendarIdentifier: "calendar_work",
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
