/**
 * Fake macOS sensor that prints contract-valid NDJSON to stdout.
 *
 * Used when `FRIENDY_SENSOR_MOCK=1` so local development and CI can exercise the
 * runtime without Contacts, Calendar, or a compiled Swift binary. Set
 * `FRIENDY_SENSOR_MOCK_EVENT=contact_added` to emit a full contact batch fixture.
 */
import { MACOS_SENSOR_NAME, MACOS_SENSOR_SCHEMA_VERSION } from "./sensorEvents";

export type FakeSensorMode = "ready" | "contact_added";

type FakeSensorEvent = Record<string, unknown> & {
  type: string;
  sensorName: string;
};

/** Chooses whether the fake sensor emits only `ready` or a full `contact_added` batch. */
export function resolveFakeSensorMode(env: Partial<NodeJS.ProcessEnv> = process.env): FakeSensorMode {
  return env.FRIENDY_SENSOR_MOCK_EVENT === "contact_added" ? "contact_added" : "ready";
}

/** Builds deterministic mock sensor events that satisfy the Zod contract in `sensorEvents.ts`. */
export function createFakeMacosSensorEvents({
  mode = "ready",
  now = new Date().toISOString()
}: {
  mode?: FakeSensorMode;
  now?: string;
} = {}): FakeSensorEvent[] {
  const ready = baseEvent("ready", now, "sensor_evt_mock_ready");
  Object.assign(ready, {
    contactsPermissionStatus: "authorized",
    calendarPermissionStatus: "authorized",
    baselineCreated: false
  });

  if (mode === "ready") {
    return [ready];
  }

  return [ready, contactAddedEvent(now), historyBatchCompleteEvent(now)];
}

export function main(): void {
  const mode = resolveFakeSensorMode();
  for (const event of createFakeMacosSensorEvents({ mode })) {
    console.log(JSON.stringify(event));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

function baseEvent(type: string, emittedAt: string, eventId: string): FakeSensorEvent {
  return {
    schemaVersion: MACOS_SENSOR_SCHEMA_VERSION,
    eventId,
    type,
    sensorName: MACOS_SENSOR_NAME,
    sensorVersion: "0.1.0-mock",
    runId: "sensor_run_mock",
    deviceId: "mac_mock",
    emittedAt
  };
}

function contactAddedEvent(emittedAt: string): FakeSensorEvent {
  return {
    ...baseEvent("contact_added", emittedAt, "sensor_evt_mock_contact_1"),
    observedAt: "2026-05-21T18:36:50Z",
    idempotencyKey: "contacts:mac_mock:fixture-contact-1:add",
    historyBatchId: "history_batch_mock_1",
    historyBatchIndex: 0,
    historyBatchSize: 1,
    historyTokenBeforeRef: "outbox:history_batch_mock_1:before",
    historyTokenAfterRef: "outbox:history_batch_mock_1:after",
    detectedAt: "2026-05-21T20:30:00-07:00",
    contact: {
      stableId: "fixture-contact-1",
      unifiedStableId: "fixture-contact-1",
      containerId: "fixture-container",
      displayName: "Maya",
      phoneNumberHashes: ["sha256:fixture-phone"],
      phoneNumberHints: [{ last4: "4567", label: "" }],
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

function historyBatchCompleteEvent(emittedAt: string): FakeSensorEvent {
  return {
    ...baseEvent("history_batch_complete", emittedAt, "sensor_evt_mock_batch_1"),
    historyBatchId: "history_batch_mock_1",
    contactEventIds: ["sensor_evt_mock_contact_1"],
    ackPath: ".friendy/macos-sensor-state/acks/history_batch_mock_1.ack"
  };
}
