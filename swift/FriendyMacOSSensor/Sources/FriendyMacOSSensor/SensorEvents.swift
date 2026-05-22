import Foundation

let friendySensorName = "macos_contacts_calendar"
let friendySensorVersion = "0.1.0"

struct SensorIdentity {
    let runId: String
    let deviceId: String

    static func current() -> SensorIdentity {
        SensorIdentity(
            runId: "sensor_run_\(UUID().uuidString)",
            deviceId: Host.current().localizedName ?? "mac_local"
        )
    }
}

func emitSensorEvent(_ event: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(event),
          let data = try? JSONSerialization.data(withJSONObject: event, options: []),
          let line = String(data: data, encoding: .utf8) else {
        fputs("Failed to encode sensor event\n", stderr)
        exit(1)
    }

    print(line)
    fflush(stdout)
}

func commonSensorEvent(_ type: String, identity: SensorIdentity, now: Date = Date()) -> [String: Any] {
    [
        "schemaVersion": 1,
        "eventId": "sensor_evt_\(UUID().uuidString)",
        "type": type,
        "sensorName": friendySensorName,
        "sensorVersion": friendySensorVersion,
        "runId": identity.runId,
        "deviceId": identity.deviceId,
        "emittedAt": ISO8601DateFormatter().string(from: now)
    ]
}

func fatalSensorEvent(code: String, message: String, identity: SensorIdentity) -> [String: Any] {
    var event = commonSensorEvent("fatal_error", identity: identity)
    event["idempotencyKey"] = "fatal_error:\(identity.deviceId):\(identity.runId):\(code)"
    event["code"] = code
    event["message"] = message
    event["retryable"] = false
    return event
}

func readySensorEvent(identity: SensorIdentity, baselineCreated: Bool, calendarPermissionStatus: String) -> [String: Any] {
    var event = commonSensorEvent("ready", identity: identity)
    event["contactsPermissionStatus"] = "authorized"
    event["calendarPermissionStatus"] = calendarPermissionStatus
    event["baselineCreated"] = baselineCreated
    return event
}

func contactAddedFixtureEvent(identity: SensorIdentity) -> [String: Any] {
    var event = commonSensorEvent("contact_added", identity: identity)
    event["observedAt"] = "2026-05-21T18:36:50Z"
    event["idempotencyKey"] = "contacts:\(identity.deviceId):fixture-contact-1:add"
    event["historyBatchId"] = "history_batch_fixture_1"
    event["historyBatchIndex"] = 0
    event["historyBatchSize"] = 1
    event["historyTokenBeforeRef"] = "outbox:history_batch_fixture_1:before"
    event["historyTokenAfterRef"] = "outbox:history_batch_fixture_1:after"
    event["detectedAt"] = "2026-05-21T20:30:00-07:00"
    event["contact"] = [
        "stableId": "fixture-contact-1",
        "unifiedStableId": "fixture-contact-1",
        "containerId": "fixture-container",
        "displayName": "Maya",
        "phoneNumberHashes": ["sha256:fixture-phone"],
        "phoneNumberHints": [["last4": "4567", "label": "mobile"]],
        "emailHashes": ["sha256:fixture-email"],
        "emailHints": [["domain": "example.com", "label": "work"]]
    ]
    event["calendarQuery"] = [
        "startsAt": "2026-05-21T16:30:00-07:00",
        "endsAt": "2026-05-21T21:30:00-07:00",
        "resultCountBeforeLimit": 1,
        "permissionStatus": "authorized"
    ]
    event["calendarMatches"] = [
        [
            "eventIdentifier": "fixture-event-photon-dinner",
            "calendarIdentifier": "fixture-calendar-work",
            "title": "Photon Residency Dinner",
            "startsAt": "2026-05-21T18:00:00-07:00",
            "endsAt": "2026-05-21T21:00:00-07:00",
            "location": "San Francisco",
            "calendarSource": "iCloud",
            "calendarTitle": "Work",
            "isAllDay": false,
            "attendeeCount": 12,
            "availability": "busy",
            "status": "confirmed",
            "isRecurring": false
        ]
    ]
    return event
}

func historyBatchCompleteFixtureEvent(identity: SensorIdentity) -> [String: Any] {
    var event = commonSensorEvent("history_batch_complete", identity: identity)
    event["historyBatchId"] = "history_batch_fixture_1"
    event["contactEventIds"] = ["sensor_evt_fixture_contact_1"]
    event["ackPath"] = ".friendy/macos-sensor-state/acks/history_batch_fixture_1.ack"
    return event
}
