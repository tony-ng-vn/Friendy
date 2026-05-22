import { describe, expect, it } from "vitest";
import { createRelationshipRepository } from "../repository";
import { createFriendySensorRuntime, createInMemoryRuntimeStateStore, type RuntimePromptSender } from "./friendyRuntime";

describe("Friendy macOS sensor runtime", () => {
  it("ignores malformed sensor JSON without throwing", async () => {
    const harness = createHarness();

    await expect(harness.runtime.processLine("{bad json")).resolves.toBeUndefined();

    expect(harness.prompts).toEqual([]);
    expect(harness.logs[0]).toContain("Malformed sensor JSON");
  });

  it("records history_reset without creating candidates or prompts", async () => {
    const harness = createHarness();

    await harness.runtime.processLine(
      JSON.stringify({
        ...baseEvent("history_reset"),
        idempotencyKey: "history_reset:mac_1:sensor_run_1:expired_token:2026-05-21T18:36:51Z",
        reason: "expired_token",
        detectedAt: "2026-05-21T18:36:51Z"
      })
    );

    expect(harness.repo.listPendingCandidates("user_friendy")).toEqual([]);
    expect(harness.prompts).toEqual([]);
    expect(harness.state.getProcessedEvent("history_reset:mac_1:sensor_run_1:expired_token:2026-05-21T18:36:51Z")).toMatchObject({
      status: "ignored",
      eventType: "history_reset"
    });
  });

  it("sends permission warnings once through durable warning state", async () => {
    const harness = createHarness();
    const line = JSON.stringify({
      ...baseEvent("permission_error"),
      idempotencyKey: "permission_error:mac_1:sensor_run_1:contacts_permission_denied",
      code: "contacts_permission_denied",
      message: "Contacts permission denied by user.",
      retryable: true
    });

    await harness.runtime.processLine(line);
    await harness.runtime.processLine(line);

    expect(harness.prompts.map((prompt) => prompt.text)).toEqual([
      "Friendy is running, but I need Contacts permission before I can notice new contacts."
    ]);
    expect(harness.state.getWarning("user_friendy", "macos_contacts_calendar", "contacts_permission_denied")).toMatchObject({
      notificationCount: 1
    });
  });

  it("keeps running and persists warning state if warning prompt delivery fails", async () => {
    const harness = createHarness({
      sendPrompt() {
        throw new Error("Spectrum warning send failed");
      }
    });

    await expect(
      harness.runtime.processLine(
        JSON.stringify({
          ...baseEvent("permission_error"),
          idempotencyKey: "permission_error:mac_1:sensor_run_1:contacts_permission_denied",
          code: "contacts_permission_denied",
          message: "Contacts permission denied by user.",
          retryable: true
        })
      )
    ).resolves.toBeUndefined();

    expect(harness.state.getWarning("user_friendy", "macos_contacts_calendar", "contacts_permission_denied")).toMatchObject({
      notificationCount: 0,
      lastNotifiedAt: undefined
    });
    expect(harness.state.getProcessedEvent("permission_error:mac_1:sensor_run_1:contacts_permission_denied")).toMatchObject({
      status: "ignored",
      warningCode: "contacts_permission_denied"
    });
    expect(harness.logs.join("\n")).toContain("Failed to send sensor warning");
  });

  it("records Calendar warning from ready but keeps running", async () => {
    const harness = createHarness();

    await harness.runtime.processLine(
      JSON.stringify({
        ...baseEvent("ready"),
        contactsPermissionStatus: "authorized",
        calendarPermissionStatus: "denied",
        baselineCreated: false
      })
    );

    expect(harness.state.getWarning("user_friendy", "macos_contacts_calendar", "calendar_permission_denied")).toMatchObject({
      permissionStatus: "denied",
      notificationCount: 1
    });
    expect(harness.prompts[0].text).toBe(
      "Friendy can still notice new contacts, but I need Calendar permission to guess where you met them."
    );
  });

  it("creates one candidate, preserves stableId identity, scores events, and sends a prompt", async () => {
    const harness = createHarness();

    await harness.runtime.processLine(JSON.stringify(contactAddedEvent()));

    const [candidate] = harness.repo.listPendingCandidates("user_friendy");
    expect(candidate).toMatchObject({
      displayName: "Maya",
      contactIdentifier: "ABCD-1234",
      sensorEventId: "sensor_evt_contact_1",
      status: "prompted",
      promptInteractionId: "interaction_1"
    });
    expect(harness.prompts).toHaveLength(1);
    expect(harness.prompts[0]).toMatchObject({
      userId: "user_friendy",
      candidateId: candidate.id,
      text: "I noticed you added Maya during Photon Residency Dinner. Did you meet them there?"
    });
    expect(harness.state.getProcessedEvent("contacts:mac_1:ABCD-1234:add")).toMatchObject({
      status: "candidate_created",
      candidateId: candidate.id
    });
  });

  it("leaves a sensor-created candidate pending when proactive prompt delivery fails", async () => {
    const harness = createHarness({
      sendPrompt() {
        throw new Error("Spectrum send failed");
      }
    });

    await expect(harness.runtime.processLine(JSON.stringify(contactAddedEvent()))).resolves.toBeUndefined();

    const [candidate] = harness.repo.listPendingCandidates("user_friendy");
    expect(candidate).toMatchObject({
      displayName: "Maya",
      status: "pending",
      statusReason: "prompt_send_failed"
    });
    expect(candidate).not.toHaveProperty("promptInteractionId");
    expect(harness.logs.join("\n")).toContain("Failed to send candidate prompt");
    expect(harness.state.getProcessedEvent("contacts:mac_1:ABCD-1234:add")).toMatchObject({
      status: "candidate_created",
      candidateId: candidate.id
    });
  });

  it("does not create duplicate candidates or prompts for replayed idempotency keys", async () => {
    const harness = createHarness();
    const line = JSON.stringify(contactAddedEvent());

    await harness.runtime.processLine(line);
    await harness.runtime.processLine(line);

    expect(harness.repo.listPendingCandidates("user_friendy")).toHaveLength(1);
    expect(harness.prompts).toHaveLength(1);
  });

  it("retries prompt delivery for a duplicate contact event when the candidate is still pending", async () => {
    let shouldFail = true;
    const harness = createHarness({
      async sendPrompt(input) {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("first send failed");
        }
        harness.prompts.push(input);
        return { interactionId: "interaction_retry_1" };
      }
    });
    const line = JSON.stringify(contactAddedEvent());

    await harness.runtime.processLine(line);
    await harness.runtime.processLine(line);

    const [candidate] = harness.repo.listPendingCandidates("user_friendy");
    expect(candidate).toMatchObject({
      displayName: "Maya",
      status: "prompted",
      promptInteractionId: "interaction_retry_1"
    });
    expect(harness.prompts).toHaveLength(1);
    expect(harness.logs.join("\n")).toContain("Retrying prompt delivery for duplicate sensor event");
  });

  it("writes history batch ack only after every contact event has a persisted outcome", async () => {
    const harness = createHarness();

    await harness.runtime.processLine(
      JSON.stringify({
        ...baseEvent("history_batch_complete"),
        historyBatchId: "history_batch_1",
        contactEventIds: ["sensor_evt_contact_1"],
        ackPath: ".friendy/macos-sensor-state/acks/history_batch_1.ack"
      })
    );
    expect(harness.acks).toEqual([]);

    await harness.runtime.processLine(JSON.stringify(contactAddedEvent()));
    await harness.runtime.processLine(
      JSON.stringify({
        ...baseEvent("history_batch_complete"),
        historyBatchId: "history_batch_1",
        contactEventIds: ["sensor_evt_contact_1"],
        ackPath: ".friendy/macos-sensor-state/acks/history_batch_1.ack"
      })
    );

    expect(harness.acks).toEqual([".friendy/macos-sensor-state/acks/history_batch_1.ack"]);
  });
});

function createHarness(overrides: Partial<RuntimePromptSender> = {}) {
  const repo = createRelationshipRepository();
  const state = createInMemoryRuntimeStateStore();
  const prompts: Array<{ userId: string; candidateId?: string; text: string }> = [];
  const acks: string[] = [];
  const logs: string[] = [];
  const sender: RuntimePromptSender = {
    async sendPrompt(input) {
      prompts.push(input);
      return { interactionId: `interaction_${prompts.length}` };
    },
    ...overrides
  };
  const runtime = createFriendySensorRuntime({
    userId: "user_friendy",
    repo,
    state,
    sender,
    ackWriter: {
      async writeAck(path) {
        acks.push(path);
      }
    },
    logger: {
      info(message) {
        logs.push(message);
      },
      warn(message) {
        logs.push(message);
      },
      error(message) {
        logs.push(message);
      }
    },
    now: () => "2026-05-21T18:36:51.000Z"
  });

  return { runtime, repo, state, prompts, acks, logs };
}

function contactAddedEvent() {
  return {
    ...baseEvent("contact_added"),
    eventId: "sensor_evt_contact_1",
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

function baseEvent(type: string) {
  return {
    schemaVersion: 1,
    eventId: `sensor_evt_${type}`,
    type,
    sensorName: "macos_contacts_calendar",
    sensorVersion: "0.1.0",
    runId: "sensor_run_1",
    deviceId: "mac_1",
    emittedAt: "2026-05-21T18:36:51Z"
  };
}
