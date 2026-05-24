import { describe, expect, it } from "vitest";
import { createFakeMacosSensorEvents, resolveFakeSensorMode } from "./fakeMacosSensor";
import { parseSensorEventLine } from "./sensorEvents";

describe("fake macOS sensor", () => {
  it("emits ready only by default", () => {
    const events = createFakeMacosSensorEvents({ now: "2026-05-22T00:00:00.000Z" });

    expect(events.map((event) => event.type)).toEqual(["ready"]);
    expect(events[0]).toMatchObject({
      sensorName: "macos_contacts_calendar",
      contactsPermissionStatus: "authorized",
      calendarPermissionStatus: "authorized"
    });
  });

  it("can emit a full contact_added fixture batch for foreground runtime smoke checks", () => {
    const events = createFakeMacosSensorEvents({
      mode: "contact_added",
      now: "2026-05-22T00:00:00.000Z"
    });

    expect(events.map((event) => event.type)).toEqual(["ready", "contact_added", "history_batch_complete"]);
    const contact = parseSensorEventLine(JSON.stringify(events[1]));
    expect(contact.type).toBe("contact_added");
    if (contact.type !== "contact_added") {
      throw new Error(`Expected contact_added, received ${contact.type}`);
    }

    expect(contact.contact.displayName).toBe("Maya");
    expect(contact.calendarMatches[0].title).toBe("Photon Residency Dinner");
    expect(JSON.stringify(contact)).not.toContain("+1555");
    expect(JSON.stringify(contact)).not.toContain("maya@example.com");
  });

  it("resolves contact fixture mode from FRIENDY_SENSOR_MOCK_EVENT", () => {
    expect(resolveFakeSensorMode({ FRIENDY_SENSOR_MOCK_EVENT: "contact_added" })).toBe("contact_added");
    expect(resolveFakeSensorMode({})).toBe("ready");
  });
});
