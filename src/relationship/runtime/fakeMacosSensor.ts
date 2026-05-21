import { MACOS_SENSOR_NAME, MACOS_SENSOR_SCHEMA_VERSION } from "./sensorEvents";

const now = new Date().toISOString();

console.log(
  JSON.stringify({
    schemaVersion: MACOS_SENSOR_SCHEMA_VERSION,
    eventId: "sensor_evt_mock_ready",
    type: "ready",
    sensorName: MACOS_SENSOR_NAME,
    sensorVersion: "0.1.0-mock",
    runId: "sensor_run_mock",
    deviceId: "mac_mock",
    emittedAt: now,
    contactsPermissionStatus: "authorized",
    calendarPermissionStatus: "authorized",
    baselineCreated: false
  })
);
