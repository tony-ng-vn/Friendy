import { describe, expect, it } from "vitest";
import { parseSensorEventLine } from "./sensorEvents";

describe("macOS sensor event contract", () => {
  it("parses ready events with separate Contacts and Calendar permission statuses", () => {
    const event = parseSensorEventLine(
      JSON.stringify({
        schemaVersion: 1,
        eventId: "sensor_evt_ready_1",
        type: "ready",
        sensorName: "macos_contacts_calendar",
        sensorVersion: "0.1.0",
        runId: "sensor_run_1",
        deviceId: "mac_1",
        emittedAt: "2026-05-21T18:36:51Z",
        contactsPermissionStatus: "authorized",
        calendarPermissionStatus: "denied",
        baselineCreated: false
      })
    );

    expect(event).toMatchObject({
      type: "ready",
      contactsPermissionStatus: "authorized",
      calendarPermissionStatus: "denied",
      baselineCreated: false
    });
  });

  it("parses contact_added with redacted contact methods and calendar query metadata", () => {
    const event = parseSensorEventLine(JSON.stringify(contactAddedPayload()));

    expect(event.type).toBe("contact_added");
    if (event.type !== "contact_added") {
      throw new Error(`Expected contact_added, received ${event.type}`);
    }

    expect(event.contact.stableId).toBe("ABCD-1234");
    expect(event.contact.unifiedStableId).toBe("UNIFIED-ABCD-1234");
    expect(event.contact.phoneNumberHints[0]).toEqual({ last4: "4567", label: "mobile" });
    expect(event.calendarQuery).toMatchObject({
      resultCountBeforeLimit: 14,
      permissionStatus: "authorized"
    });
    expect(event.calendarMatches[0]).toMatchObject({
      title: "Photon Residency Dinner",
      attendeeCount: 12,
      status: "confirmed"
    });
    expect(JSON.stringify(event)).not.toContain("+1555");
  });

  it("parses history_batch_complete with an ack path", () => {
    const event = parseSensorEventLine(
      JSON.stringify({
        schemaVersion: 1,
        eventId: "sensor_evt_batch_1",
        type: "history_batch_complete",
        sensorName: "macos_contacts_calendar",
        sensorVersion: "0.1.0",
        runId: "sensor_run_1",
        deviceId: "mac_1",
        emittedAt: "2026-05-21T18:36:52Z",
        historyBatchId: "history_batch_1",
        contactEventIds: ["sensor_evt_contact_1"],
        ackPath: ".friendy/macos-sensor-state/acks/history_batch_1.ack"
      })
    );

    expect(event).toMatchObject({
      type: "history_batch_complete",
      historyBatchId: "history_batch_1",
      ackPath: ".friendy/macos-sensor-state/acks/history_batch_1.ack"
    });
  });

  it("parses non-PII contact_pending diagnostics while the native sensor waits for a saved card", () => {
    const event = parseSensorEventLine(
      JSON.stringify({
        ...basePayload("contact_pending"),
        reason: "waiting_for_saved_contact",
        pendingContactCount: 1,
        readyContactCount: 0,
        nextCheckInSeconds: 5
      })
    );

    expect(event).toMatchObject({
      type: "contact_pending",
      reason: "waiting_for_saved_contact",
      pendingContactCount: 1,
      readyContactCount: 0,
      nextCheckInSeconds: 5
    });
    expect(JSON.stringify(event)).not.toMatch(/Testing|Maya|\+1555|@/);
  });

  it("requires idempotency keys on durable outcome events", () => {
    const payload = contactAddedPayload();
    delete (payload as Record<string, unknown>).idempotencyKey;

    expect(() => parseSensorEventLine(JSON.stringify(payload))).toThrow(/idempotencyKey/i);
  });

  it("rejects raw phone numbers, raw emails, and malformed JSON", () => {
    const payload = contactAddedPayload();
    Object.assign(payload.contact, {
      phoneNumbers: ["+15551234567"],
      emails: ["maya@example.com"]
    });

    expect(() => parseSensorEventLine("{bad json")).toThrow(/Malformed sensor JSON/);
    expect(() => parseSensorEventLine(JSON.stringify(payload))).toThrow(/raw contact method/i);
  });

  it("rejects unsupported sensor names and schema versions", () => {
    expect(() =>
      parseSensorEventLine(
        JSON.stringify({
          ...basePayload("ready"),
          sensorName: "other_sensor",
          contactsPermissionStatus: "authorized",
          calendarPermissionStatus: "authorized",
          baselineCreated: true
        })
      )
    ).toThrow(/macos_contacts_calendar/);

    expect(() =>
      parseSensorEventLine(
        JSON.stringify({
          ...basePayload("ready"),
          schemaVersion: 2,
          contactsPermissionStatus: "authorized",
          calendarPermissionStatus: "authorized",
          baselineCreated: true
        })
      )
    ).toThrow(/schemaVersion/);
  });
});

function contactAddedPayload() {
  return {
    ...basePayload("contact_added"),
    observedAt: "2026-05-21T18:36:50Z",
    idempotencyKey: "contacts:mac_1:ABCD-1234:add",
    historyBatchId: "history_batch_1",
    historyBatchIndex: 0,
    historyBatchSize: 1,
    historyTokenBeforeRef: "outbox:history_batch_1:before",
    historyTokenAfterRef: "outbox:history_batch_1:after",
    detectedAt: "2026-05-21T11:36:51-07:00",
    contact: {
      stableId: "ABCD-1234",
      unifiedStableId: "UNIFIED-ABCD-1234",
      containerId: "icloud_container",
      displayName: "Maya",
      phoneNumberHashes: ["sha256:phone"],
      phoneNumberHints: [{ last4: "4567", label: "mobile" }],
      emailHashes: ["sha256:email"],
      emailHints: [{ domain: "example.com", label: "work" }]
    },
    calendarQuery: {
      startsAt: "2026-05-21T07:36:51-07:00",
      endsAt: "2026-05-21T12:36:51-07:00",
      resultCountBeforeLimit: 14,
      permissionStatus: "authorized"
    },
    calendarMatches: [
      {
        eventIdentifier: "event_123",
        calendarIdentifier: "calendar_456",
        title: "Photon Residency Dinner",
        startsAt: "2026-05-21T10:00:00-07:00",
        endsAt: "2026-05-21T12:00:00-07:00",
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

function basePayload(type: string) {
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
