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
    contactAddedEvent(
        identity: identity,
        eventId: "sensor_evt_fixture_contact_1",
        idempotencyKey: "contacts:\(identity.deviceId):fixture-contact-1:add",
        historyBatchId: "history_batch_fixture_1",
        historyBatchIndex: 0,
        historyBatchSize: 1,
        historyTokenBeforeRef: "outbox:history_batch_fixture_1:before",
        historyTokenAfterRef: "outbox:history_batch_fixture_1:after",
        detectedAt: "2026-05-21T20:30:00-07:00",
        observedAt: "2026-05-21T18:36:50Z",
        contact: [
            "stableId": "fixture-contact-1",
            "unifiedStableId": "fixture-contact-1",
            "containerId": "fixture-container",
            "displayName": "Maya",
            "phoneNumberHashes": ["sha256:fixture-phone"],
            "phoneNumberHints": [["last4": "4567", "label": "mobile"]],
            "emailHashes": ["sha256:fixture-email"],
            "emailHints": [["domain": "example.com", "label": "work"]]
        ],
        calendarQuery: [
            "startsAt": "2026-05-21T16:30:00-07:00",
            "endsAt": "2026-05-21T21:30:00-07:00",
            "resultCountBeforeLimit": 1,
            "permissionStatus": "authorized"
        ],
        calendarMatches: [
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
    )
}

func contactAddedEvent(
    identity: SensorIdentity,
    eventId: String,
    idempotencyKey: String,
    historyBatchId: String,
    historyBatchIndex: Int,
    historyBatchSize: Int,
    historyTokenBeforeRef: String,
    historyTokenAfterRef: String,
    detectedAt: String,
    observedAt: String,
    contact: [String: Any],
    calendarQuery: [String: Any],
    calendarMatches: [[String: Any]]
) -> [String: Any] {
    var event = commonSensorEvent("contact_added", identity: identity)
    event["eventId"] = eventId
    event["observedAt"] = observedAt
    event["idempotencyKey"] = idempotencyKey
    event["historyBatchId"] = historyBatchId
    event["historyBatchIndex"] = historyBatchIndex
    event["historyBatchSize"] = historyBatchSize
    event["historyTokenBeforeRef"] = historyTokenBeforeRef
    event["historyTokenAfterRef"] = historyTokenAfterRef
    event["detectedAt"] = detectedAt
    event["contact"] = contact
    event["calendarQuery"] = calendarQuery
    event["calendarMatches"] = calendarMatches
    return event
}

func historyBatchCompleteFixtureEvent(identity: SensorIdentity) -> [String: Any] {
    historyBatchCompleteEvent(
        identity: identity,
        historyBatchId: "history_batch_fixture_1",
        contactEventIds: ["sensor_evt_fixture_contact_1"],
        ackPath: ".friendy/macos-sensor-state/acks/history_batch_fixture_1.ack"
    )
}

func historyBatchCompleteEvent(identity: SensorIdentity, historyBatchId: String, contactEventIds: [String], ackPath: String) -> [String: Any] {
    var event = commonSensorEvent("history_batch_complete", identity: identity)
    event["historyBatchId"] = historyBatchId
    event["contactEventIds"] = contactEventIds
    event["ackPath"] = ackPath
    return event
}

func historyResetEvent(identity: SensorIdentity, reason: String, detectedAt: String) -> [String: Any] {
    var event = commonSensorEvent("history_reset", identity: identity)
    event["idempotencyKey"] = "history_reset:\(identity.deviceId):\(identity.runId):\(reason):\(detectedAt)"
    event["reason"] = reason
    event["detectedAt"] = detectedAt
    return event
}

/*
The fixture event keeps the contract visible in source while avoiding raw phoneNumbers/emails:
[
    "contact": [
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
]
*/
