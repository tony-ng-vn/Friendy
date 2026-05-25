import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import { createOnboardingStateController } from "../onboardingState";
import { createSqliteRelationshipRepository, createSqliteRuntimeStateStore } from "../sqliteRepository";
import { createRuntimePromptSender, resolveFriendyRuntimeConfig, startFriendyForegroundRuntime } from "./friendyRuntimeCli";
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
    expect(config.sensor).toMatchObject({
      kind: "executable",
      command: join(cwd, "friendy-macos-sensor"),
      args: ["--state-dir", join(cwd, ".friendy/macos-sensor-state")]
    });
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
    if (config.sensor.mode !== "mock") {
      throw new Error(`Expected mock sensor config, received ${config.sensor.mode}`);
    }
    expect(config.sensor.command).toBe("tsx");
    expect(config.sensor.args).toEqual(["src/relationship/runtime/fakeMacosSensor.ts"]);
  });

  it("reads FRIENDY_STRICT_MODE into foreground runtime config", () => {
    const cwd = tempDir();

    const config = resolveFriendyRuntimeConfig({
      cwd,
      env: {
        FRIENDY_SENSOR_MOCK: "1",
        FRIENDY_STRICT_MODE: "yes"
      }
    });

    expect(config.strictMode).toBe(true);
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
    expect(prompts[0].text).toContain("Text start and I'll ask about it");
    expect(started.state.getProcessedEvent("contacts:mac_1:ABCD-1234:add")).toMatchObject({
      status: "candidate_created"
    });

    started.onboarding.applyControl("started");
    await runtime?.processLine(
      JSON.stringify(contactAddedEvent({ eventId: "sensor_evt_contact_2", stableId: "EFGH-5678" }))
    );

    expect(started.repo.listPendingCandidates("user_friendy").map((candidate) => candidate.contactIdentifier)).toEqual([
      "ABCD-1234",
      "EFGH-5678"
    ]);
    expect(started.state.getProcessedEvent("contacts:mac_1:EFGH-5678:add")).toMatchObject({
      status: "candidate_created"
    });
    expect(prompts[1].text).toContain("Photon Residency Dinner");
    started.close();
  });

  it("clears stale pending candidates from previous foreground runs on startup", async () => {
    const cwd = tempDir();
    const sqlitePath = join(cwd, ".friendy", "friendy.sqlite");
    mkdirSync(join(cwd, ".friendy"), { recursive: true });
    const existingRepo = createSqliteRelationshipRepository({ path: sqlitePath });
    const staleCandidate = existingRepo.createCandidateFromDetectedContact({
      userId: "user_friendy",
      displayName: "Old Testing",
      phoneNumbers: ["ending in 0000"],
      emails: [],
      detectedAt: "2026-05-20T12:00:00.000Z",
      source: "contacts_delta",
      contactIdentifier: "OLD-CONTACT"
    });
    existingRepo.markCandidatePrompted(staleCandidate.id, "interaction_old_prompt", {
      promptedAt: "2026-05-20T12:00:00.000Z"
    });
    const staleState = createSqliteRuntimeStateStore({ path: sqlitePath });
    staleState.recordProcessedEvent({
      idempotencyKey: "contacts:mac_1:OLD-CONTACT:add",
      sensorEventId: "sensor_evt_contact_old",
      sensorName: "macos_contacts_calendar",
      eventType: "contact_added",
      status: "candidate_created",
      candidateId: staleCandidate.id,
      processedAt: "2026-05-20T12:00:00.000Z"
    });
    staleState.close();
    existingRepo.close();

    const started = await startFriendyForegroundRuntime({
      cwd,
      env: {
        FRIENDY_SENSOR_MOCK: "1",
        FRIENDY_LOCAL_USER_ID: "user_friendy"
      },
      sender: {
        async sendPrompt() {
          return { interactionId: "interaction_prompt_1" };
        }
      },
      startSensor() {
        return { child: fakeChildProcess() };
      },
      logger: testLogger()
    });

    expect(started.repo.listPendingCandidates("user_friendy")).toEqual([]);
    expect(started.repo.getCandidate(staleCandidate.id)).toMatchObject({
      status: "ignored"
    });
    expect(started.state.getProcessedEvent("contacts:mac_1:OLD-CONTACT:add")).toBeUndefined();
    started.close();
  });

  it("re-queues an ignored prior-run contact after start when the sensor replays the same Apple contact id", async () => {
    const cwd = tempDir();
    const sqlitePath = join(cwd, ".friendy", "friendy.sqlite");
    mkdirSync(join(cwd, ".friendy"), { recursive: true });
    const haroldStableId = "0077EDB0-D8D4-426B-9575-E3C88EDF7B71:ABPerson";
    const haroldIdempotencyKey = `contacts:mac_1:${haroldStableId}:add`;
    const existingRepo = createSqliteRelationshipRepository({ path: sqlitePath });
    const harold = existingRepo.createCandidateFromDetectedContact({
      userId: "user_friendy",
      displayName: "Harold",
      phoneNumbers: ["ending in 5596"],
      emails: [],
      detectedAt: "2026-05-24T19:18:54.000Z",
      source: "contacts_delta",
      contactIdentifier: haroldStableId
    });
    existingRepo.ignoreCandidate(harold.id);
    existingRepo.close();

    const existingState = createSqliteRuntimeStateStore({ path: sqlitePath });
    existingState.recordProcessedEvent({
      idempotencyKey: haroldIdempotencyKey,
      sensorEventId: "sensor_evt_contact_18E57805-7F56-4F01-9DFC-D2B268742AD2",
      sensorName: "macos_contacts_calendar",
      eventType: "contact_added",
      status: "candidate_created",
      candidateId: harold.id,
      processedAt: "2026-05-24T19:18:54.000Z"
    });
    existingState.close();

    const prompts: Array<{ userId: string; candidateId?: string; text: string }> = [];
    const logs: string[] = [];
    let runtime: SensorRuntimeLineProcessor | undefined;
    const duplicateEventId = "sensor_evt_contact_F5C9968A-C64B-49BB-86B4-687CEFB0504C";

    const started = await startFriendyForegroundRuntime({
      cwd,
      env: {
        FRIENDY_SENSOR_MOCK: "1",
        FRIENDY_LOCAL_USER_ID: "user_friendy"
      },
      onboarding: createOnboardingStateController("ready_pending_user_start"),
      sender: {
        async sendPrompt(input) {
          prompts.push(input);
          return { interactionId: "interaction_prompt_harold" };
        }
      },
      startSensor({ runtime: startedRuntime }) {
        runtime = startedRuntime;
        return { child: fakeChildProcess() };
      },
      logger: testLogger(logs)
    });

    started.onboarding.applyControl("started");
    const intakeStartedAt = started.onboarding.getContactIntakeStartedAt();
    if (!intakeStartedAt) {
      throw new Error("Expected contact intake start timestamp after onboarding start");
    }
    const detectedAt = new Date(Date.parse(intakeStartedAt) + 1_000).toISOString();
    await runtime?.processLine(
      JSON.stringify(
        contactAddedEvent({
          eventId: duplicateEventId,
          stableId: haroldStableId,
          displayName: "Harold",
          detectedAt
        })
      )
    );
    await runtime?.processLine(
      JSON.stringify({
        schemaVersion: 1,
        eventId: "sensor_evt_history_batch_harold",
        type: "history_batch_complete",
        sensorName: "macos_contacts_calendar",
        sensorVersion: "0.1.0",
        runId: "sensor_run_1",
        deviceId: "mac_1",
        emittedAt: "2026-05-24T21:09:06.000Z",
        historyBatchId: "history_batch_harold",
        contactEventIds: [duplicateEventId],
        ackPath: join(cwd, ".friendy/macos-sensor-state/acks/history_batch_harold.ack")
      })
    );

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      candidateId: harold.id,
      text: expect.stringContaining("Harold")
    });
    expect(started.repo.listPendingCandidates("user_friendy")).toHaveLength(1);
    expect(started.state.getProcessedEvent(haroldIdempotencyKey)).toMatchObject({
      status: "candidate_created",
      sensorEventId: duplicateEventId,
      candidateId: harold.id
    });
    expect(logs.join("\n")).toContain("Re-queued ignored contact after post-start detection");
    expect(logs.join("\n")).toContain("history_batch_ack_written batchId=history_batch_harold");
    started.close();
  });

  it("re-queues an ignored contact deferred during pre-start history replay when the user texts start", async () => {
    const cwd = tempDir();
    const sqlitePath = join(cwd, ".friendy", "friendy.sqlite");
    mkdirSync(join(cwd, ".friendy"), { recursive: true });
    const haroldStableId = "0077EDB0-D8D4-426B-9575-E3C88EDF7B71:ABPerson";
    const haroldIdempotencyKey = `contacts:mac_1:${haroldStableId}:add`;
    const existingRepo = createSqliteRelationshipRepository({ path: sqlitePath });
    const harold = existingRepo.createCandidateFromDetectedContact({
      userId: "user_friendy",
      displayName: "Harold",
      phoneNumbers: ["ending in 5596"],
      emails: [],
      detectedAt: "2026-05-24T19:18:54.000Z",
      source: "contacts_delta",
      contactIdentifier: haroldStableId
    });
    existingRepo.ignoreCandidate(harold.id);
    existingRepo.close();

    const existingState = createSqliteRuntimeStateStore({ path: sqlitePath });
    existingState.recordProcessedEvent({
      idempotencyKey: haroldIdempotencyKey,
      sensorEventId: "sensor_evt_contact_18E57805-7F56-4F01-9DFC-D2B268742AD2",
      sensorName: "macos_contacts_calendar",
      eventType: "contact_added",
      status: "candidate_created",
      candidateId: harold.id,
      processedAt: "2026-05-24T19:18:54.000Z"
    });
    existingState.close();

    const prompts: Array<{ userId: string; candidateId?: string; text: string }> = [];
    const logs: string[] = [];
    let runtime: SensorRuntimeLineProcessor | undefined;
    const duplicateEventId = "sensor_evt_contact_F5C9968A-C64B-49BB-86B4-687CEFB0504C";

    const started = await startFriendyForegroundRuntime({
      cwd,
      env: {
        FRIENDY_SENSOR_MOCK: "1",
        FRIENDY_LOCAL_USER_ID: "user_friendy"
      },
      sender: {
        async sendPrompt(input) {
          prompts.push(input);
          return { interactionId: "interaction_prompt_harold" };
        }
      },
      startSensor({ runtime: startedRuntime }) {
        runtime = startedRuntime;
        return { child: fakeChildProcess() };
      },
      logger: testLogger(logs)
    });

    await runtime?.processLine(
      JSON.stringify(
        contactAddedEvent({
          eventId: duplicateEventId,
          stableId: haroldStableId,
          displayName: "Harold",
          detectedAt: "2026-05-24T19:18:54.000Z"
        })
      )
    );
    expect(prompts).toHaveLength(0);
    expect(logs.join("\n")).toContain("Duplicate sensor event ignored");

    started.onboarding.applyControl("started");
    await started.runtime.requeueDeferredReintakeCandidatesOnStart();

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      candidateId: harold.id,
      text: expect.stringContaining("Harold")
    });
    expect(started.repo.getCandidate(harold.id)).toMatchObject({
      status: "prompted"
    });
    expect(started.repo.listPendingCandidates("user_friendy")).toHaveLength(1);
    expect(
      started.state.getProcessedEventBySensorEventId(duplicateEventId)?.status
    ).toBe("duplicate");
    expect(logs.join("\n")).toContain("[friendy:reintake] Re-queued Harold at intake start");
    started.close();
  });

  it("logs clear lifecycle states while starting", async () => {
    const cwd = tempDir();
    const logs: string[] = [];

    const started = await startFriendyForegroundRuntime({
      cwd,
      env: {
        FRIENDY_SENSOR_MOCK: "1",
        FRIENDY_PROMPT_TRANSPORT: "console",
        FRIENDY_LOCAL_USER_ID: "user_friendy"
      },
      startSensor() {
        return { child: fakeChildProcess() };
      },
      logger: testLogger(logs)
    });

    expect(logs).toContain("[friendy] loading env");
    expect(logs).toContain("[friendy] sqlite store ready");
    expect(logs).toContain("[friendy] prompt transport ready: console");
    expect(logs).toContain("[friendy] macos sensor launching: mock");
    expect(logs).toContain("[friendy] watching for contact signals");
    started.close();
  });

  it("warns when the SQLite runtime path is under a common cloud-synced folder", async () => {
    const cwd = tempDir();
    const logs: string[] = [];

    const started = await startFriendyForegroundRuntime({
      cwd,
      env: {
        FRIENDY_SENSOR_MOCK: "1",
        FRIENDY_SQLITE_PATH: join(cwd, "Dropbox", "Friendy", ".friendy", "friendy.sqlite"),
        FRIENDY_LOCAL_USER_ID: "user_friendy"
      },
      sender: {
        async sendPrompt() {
          return {};
        }
      },
      startSensor() {
        return { child: fakeChildProcess() };
      },
      logger: testLogger(logs)
    });

    expect(logs.join("\n")).toContain("[friendy:runtime_store:warning]");
    expect(logs.join("\n")).toContain("cloud-synced or network folder");
    started.close();
  });

  it("starts the inbound iMessage agent with the same repository for real sensors", async () => {
    const cwd = tempDir();
    const sensorBinaryPath = join(cwd, "friendy-macos-sensor");
    writeFileSync(sensorBinaryPath, "");
    let inboundRepo: unknown;
    let inboundUserId: string | undefined;
    let inboundOnboarding: unknown;
    let inboundClosed = false;

    const started = await startFriendyForegroundRuntime({
      cwd,
      env: {
        FRIENDY_SENSOR_BINARY_PATH: sensorBinaryPath,
        FRIENDY_PROMPT_TRANSPORT: "console",
        FRIENDY_LOCAL_USER_ID: "user_friendy"
      },
      startSensor({ launch }) {
        expect(launch.mode).toBe("real");
        return { child: fakeChildProcess() };
      },
      startInboundAgent({ repo, userId, onboarding }) {
        inboundRepo = repo;
        inboundUserId = userId;
        inboundOnboarding = onboarding;
        return {
          close() {
            inboundClosed = true;
          }
        };
      },
      logger: testLogger()
    });

    expect(inboundRepo).toBe(started.repo);
    expect(inboundUserId).toBe("user_friendy");
    expect(inboundOnboarding).toBe(started.onboarding);

    started.close();
    expect(inboundClosed).toBe(true);
  });

  it("uses console prompt delivery for mock sensors by default", async () => {
    const sender = await createRuntimePromptSender({
      env: { FRIENDY_SENSOR_MOCK: "1" },
      sensorMode: "mock"
    });

    expect(sender.kind).toBe("console");
  });

  it("requires Spectrum prompt delivery config for real sensors by default", async () => {
    await expect(
      createRuntimePromptSender({
        env: {},
        sensorMode: "real"
      })
    ).rejects.toThrow(/FRIENDY_OWNER_PHONE|FRIENDY_PROMPT_TO_PHONE/);
  });

  it("warns when strict mode is off and the inbound interpreted agent is enabled", async () => {
    const cwd = tempDir();
    const logs: string[] = [];

    const started = await startFriendyForegroundRuntime({
      cwd,
      env: {
        FRIENDY_SENSOR_MOCK: "1",
        FRIENDY_PROMPT_TRANSPORT: "console",
        FRIENDY_STRICT_MODE: "0",
        FRIENDY_START_INBOUND_AGENT: "1",
        FRIENDY_LOCAL_USER_ID: "user_friendy"
      },
      startSensor() {
        return { child: fakeChildProcess() };
      },
      startInboundAgent() {
        return undefined;
      },
      logger: testLogger(logs)
    });

    expect(logs.join("\n")).toContain("[friendy:strict_mode:warning]");
    expect(logs.join("\n")).toContain("FRIENDY_STRICT_MODE is off");
    started.close();
  });

  it("does not warn about strict mode when inbound agent is disabled", async () => {
    const cwd = tempDir();
    const logs: string[] = [];

    const started = await startFriendyForegroundRuntime({
      cwd,
      env: {
        FRIENDY_SENSOR_MOCK: "1",
        FRIENDY_PROMPT_TRANSPORT: "console",
        FRIENDY_STRICT_MODE: "0",
        FRIENDY_DISABLE_INBOUND_AGENT: "1",
        FRIENDY_LOCAL_USER_ID: "user_friendy"
      },
      startSensor() {
        return { child: fakeChildProcess() };
      },
      logger: testLogger(logs)
    });

    expect(logs.join("\n")).not.toContain("[friendy:strict_mode:warning]");
    started.close();
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-runtime-cli-"));
  tempDirs.push(dir);
  return dir;
}

function testLogger(logs: string[] = []) {
  return {
    info(message: string) {
      logs.push(message);
    },
    warn(message: string) {
      logs.push(message);
    },
    error(message: string) {
      logs.push(message);
    }
  };
}

function fakeChildProcess(): SensorChildProcess {
  const child = new EventEmitter() as SensorChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

function contactAddedEvent(
  overrides: { eventId?: string; stableId?: string; displayName?: string; detectedAt?: string } = {}
) {
  const eventId = overrides.eventId ?? "sensor_evt_contact_1";
  const stableId = overrides.stableId ?? "ABCD-1234";
  return {
    schemaVersion: 1,
    eventId,
    type: "contact_added",
    sensorName: "macos_contacts_calendar",
    sensorVersion: "0.1.0",
    runId: "sensor_run_1",
    deviceId: "mac_1",
    emittedAt: "2026-05-21T18:36:51Z",
    observedAt: "2026-05-21T18:36:50Z",
    idempotencyKey: `contacts:mac_1:${stableId}:add`,
    historyBatchId: "history_batch_1",
    historyBatchIndex: 0,
    historyBatchSize: 1,
    historyTokenBeforeRef: "outbox:history_batch_1:before",
    historyTokenAfterRef: "outbox:history_batch_1:after",
    detectedAt: overrides.detectedAt ?? "2026-05-21T20:30:00-07:00",
    contact: {
      stableId,
      unifiedStableId: `UNIFIED-${stableId}`,
      containerId: "icloud_container",
      displayName: overrides.displayName ?? "Maya",
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
