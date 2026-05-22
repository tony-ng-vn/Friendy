// Native macOS Contacts/Calendar sensor: CNChangeHistory → redacted NDJSON → durable outbox → ack → token advance.
// NDJSON contract matches `src/relationship/runtime/sensorEvents.ts` (parsed by the Node runtime supervisor).

import Foundation

#if os(macOS) && canImport(Contacts) && canImport(EventKit) && canImport(CryptoKit)
import Contacts
import CryptoKit
import EventKit

struct HistoryOutboxBatch: Codable {
    let historyBatchId: String
    let tokenAfterPath: String
    let ackPath: String
    let contactEventIds: [String]
    let events: [[String: AnyCodable]]
}

struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(String.self) {
            self.value = value
        } else if let value = try? container.decode(Bool.self) {
            self.value = value
        } else if let value = try? container.decode(Int.self) {
            self.value = value
        } else if let value = try? container.decode(Double.self) {
            self.value = value
        } else if container.decodeNil() {
            self.value = NSNull()
        } else {
            self.value = ""
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let value = value as? String {
            try container.encode(value)
        } else if let value = value as? Bool {
            try container.encode(value)
        } else if let value = value as? Int {
            try container.encode(value)
        } else if let value = value as? Double {
            try container.encode(value)
        } else {
            try container.encode(String(describing: value))
        }
    }
}

/// Watches Contacts history, emits redacted sensor events, and persists batches until the runtime acks.
final class NativeMacosSensor {
    private let stateDir: URL
    private let identity: SensorIdentity
    private let contactStore: CNContactStore
    private let eventStore: EKEventStore
    private let fileManager: FileManager

    init(
        stateDir: String,
        identity: SensorIdentity,
        contactStore: CNContactStore = CNContactStore(),
        eventStore: EKEventStore = EKEventStore(),
        fileManager: FileManager = .default
    ) {
        self.stateDir = URL(fileURLWithPath: stateDir, isDirectory: true)
        self.identity = identity
        self.contactStore = contactStore
        self.eventStore = eventStore
        self.fileManager = fileManager
    }

    /// CNContactStore history token; advanced only after the runtime writes the batch ack file.
    private var tokenURL: URL {
        stateDir.appendingPathComponent("contacts-history-token.data")
    }

    /// Pending `history_batch_complete` payloads replayed on restart until acked.
    private var outboxDir: URL {
        stateDir.appendingPathComponent("outbox", isDirectory: true)
    }

    /// Runtime-created `.ack` files that release the after-token and clear outbox entries.
    private var ackDir: URL {
        stateDir.appendingPathComponent("acks", isDirectory: true)
    }

    func start() {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .authorized:
            startAuthorized()
        case .notDetermined:
            contactStore.requestAccess(for: .contacts) { granted, _ in
                if granted {
                    self.startAuthorized()
                } else {
                    emitContactsPermissionError(identity: self.identity)
                    exit(1)
                }
            }
        default:
            emitContactsPermissionError(identity: identity)
            exit(1)
        }
        RunLoop.current.run()
    }

    private func startAuthorized() {
        requestCalendarPermissionIfNeeded { [weak self] calendarPermissionStatus in
            self?.startMonitoring(calendarPermissionStatus: calendarPermissionStatus)
        }
    }

    private func startMonitoring(calendarPermissionStatus resolvedCalendarPermissionStatus: String) {
        do {
            try fileManager.createDirectory(at: outboxDir, withIntermediateDirectories: true)
            try fileManager.createDirectory(at: ackDir, withIntermediateDirectories: true)
            try replayPendingOutboxes()

            if loadHistoryToken() == nil {
                try saveBaselineToken()
                emitSensorEvent(readySensorEvent(identity: identity, baselineCreated: true, calendarPermissionStatus: resolvedCalendarPermissionStatus))
            } else {
                emitSensorEvent(readySensorEvent(identity: identity, baselineCreated: false, calendarPermissionStatus: resolvedCalendarPermissionStatus))
            }

            NotificationCenter.default.addObserver(
                forName: .CNContactStoreDidChange,
                object: contactStore,
                queue: nil
            ) { [weak self] _ in
                self?.handleContactsChanged()
            }
        } catch {
            emitSensorEvent(fatalSensorEvent(code: "state_dir_unwritable", message: error.localizedDescription, identity: identity))
            exit(1)
        }
    }

    private func requestCalendarPermissionIfNeeded(_ completion: @escaping (String) -> Void) {
        let current = calendarPermissionStatus(eventStore)
        guard current == "notDetermined" else {
            completion(current)
            return
        }

        if #available(macOS 14.0, *) {
            eventStore.requestFullAccessToEvents { granted, _ in
                completion(granted ? "authorized" : calendarPermissionStatus(self.eventStore))
            }
        } else {
            eventStore.requestAccess(to: .event) { granted, _ in
                completion(granted ? "authorized" : calendarPermissionStatus(self.eventStore))
            }
        }
    }

    private func saveBaselineToken() throws {
        let token = contactStore.currentHistoryToken
        try token.write(to: tokenURL, options: .atomic)
    }

    private func loadHistoryToken() -> Data? {
        try? Data(contentsOf: tokenURL)
    }

    private func handleContactsChanged() {
        guard let startingToken = loadHistoryToken() else {
            do {
                try saveBaselineToken()
                emitSensorEvent(historyResetEvent(identity: identity, reason: "missing_token", detectedAt: nowString()))
            } catch {
                emitSensorEvent(fatalSensorEvent(code: "token_rebaseline_failed", message: error.localizedDescription, identity: identity))
            }
            return
        }

        do {
            let batchId = "history_batch_\(UUID().uuidString)"
            let tokenBeforeRef = "outbox:\(batchId):before"
            let tokenAfterRef = "outbox:\(batchId):after"
            let addedContacts = try fetchAddedContacts(startingToken: startingToken)
            let tokenAfter = contactStore.currentHistoryToken

            guard !addedContacts.isEmpty else {
                try tokenAfter.write(to: tokenURL, options: .atomic)
                return
            }

            let observedAt = nowString()
            let calendar = queryCalendarContext(detectedAt: Date())
            let events = addedContacts.enumerated().map { index, contact in
                contactAddedEvent(
                    identity: identity,
                    eventId: "sensor_evt_contact_\(UUID().uuidString)",
                    idempotencyKey: "contacts:\(identity.deviceId):\(contact.identifier):add",
                    historyBatchId: batchId,
                    historyBatchIndex: index,
                    historyBatchSize: addedContacts.count,
                    historyTokenBeforeRef: tokenBeforeRef,
                    historyTokenAfterRef: tokenAfterRef,
                    detectedAt: observedAt,
                    observedAt: observedAt,
                    contact: redactedContactPayload(contact),
                    calendarQuery: calendar.query,
                    calendarMatches: calendar.matches
                )
            }
            let eventIds = events.compactMap { $0["eventId"] as? String }
            let ackPath = ackDir.appendingPathComponent("\(batchId).ack").path

            try writeHistoryBatchOutbox(
                historyBatchId: batchId,
                tokenAfter: tokenAfter,
                ackPath: ackPath,
                events: events
            )

            for event in events {
                emitSensorEvent(event)
            }
            emitSensorEvent(historyBatchCompleteEvent(identity: identity, historyBatchId: batchId, contactEventIds: eventIds, ackPath: ackPath))
            waitForAckAndAdvanceToken(
                batchId: batchId,
                tokenAfter: tokenAfter,
                ackPath: ackPath,
                tokenAfterPath: outboxDir.appendingPathComponent("\(batchId)-after-token.data").path
            )
        } catch {
            do {
                try saveBaselineToken()
                emitSensorEvent(historyResetEvent(identity: identity, reason: "expired_token", detectedAt: nowString()))
            } catch {
                emitSensorEvent(fatalSensorEvent(code: "history_reset_failed", message: error.localizedDescription, identity: identity))
            }
        }
    }

    private func fetchAddedContacts(startingToken: Data) throws -> [CNContact] {
        let request = CNChangeHistoryFetchRequest()
        request.startingToken = startingToken
        request.additionalContactKeyDescriptors = [
            CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactIdentifierKey as CNKeyDescriptor
        ]

        var added: [CNContact] = []
        try contactStore.enumerateChangeHistory(with: request) { event, _ in
            if let add = event as? CNChangeHistoryAddContactEvent {
                added.append(add.contact)
            }
        }
        return added
    }

    private func writeHistoryBatchOutbox(historyBatchId: String, tokenAfter: Data, ackPath: String, events: [[String: Any]]) throws {
        let tokenAfterURL = outboxDir.appendingPathComponent("\(historyBatchId)-after-token.data")
        try tokenAfter.write(to: tokenAfterURL, options: .atomic)

        let payload: [String: Any] = [
            "historyBatchId": historyBatchId,
            "tokenAfterPath": tokenAfterURL.path,
            "ackPath": ackPath,
            "events": events
        ]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: outboxDir.appendingPathComponent("\(historyBatchId).json"), options: .atomic)
    }

    private func replayPendingOutboxes() throws {
        guard let files = try? fileManager.contentsOfDirectory(at: outboxDir, includingPropertiesForKeys: nil) else {
            return
        }

        for file in files where file.pathExtension == "json" {
            let data = try Data(contentsOf: file)
            guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let events = payload["events"] as? [[String: Any]],
                  let historyBatchId = payload["historyBatchId"] as? String,
                  let tokenAfterPath = payload["tokenAfterPath"] as? String,
                  let tokenAfter = try? Data(contentsOf: URL(fileURLWithPath: tokenAfterPath)),
                  let ackPath = payload["ackPath"] as? String else {
                continue
            }
            let eventIds = events.compactMap { $0["eventId"] as? String }
            for event in events {
                emitSensorEvent(event)
            }
            emitSensorEvent(historyBatchCompleteEvent(identity: identity, historyBatchId: historyBatchId, contactEventIds: eventIds, ackPath: ackPath))
            waitForAckAndAdvanceToken(batchId: historyBatchId, tokenAfter: tokenAfter, ackPath: ackPath, tokenAfterPath: tokenAfterPath)
        }
    }

    /// Polls for `ackPath` up to ~60s; on success writes `tokenAfter` to `tokenURL` and removes outbox artifacts.
    private func waitForAckAndAdvanceToken(batchId: String, tokenAfter: Data, ackPath: String, tokenAfterPath: String) {
        DispatchQueue.global().async {
            for _ in 0..<120 {
                if self.fileManager.fileExists(atPath: ackPath) {
                    try? tokenAfter.write(to: self.tokenURL, options: .atomic)
                    try? self.fileManager.removeItem(at: self.outboxDir.appendingPathComponent("\(batchId).json"))
                    try? self.fileManager.removeItem(at: self.outboxDir.appendingPathComponent("\(batchId)-after-token.data"))
                    try? self.fileManager.removeItem(atPath: tokenAfterPath)
                    return
                }
                Thread.sleep(forTimeInterval: 0.5)
            }
        }
    }

    /// Maps CNContact to the `contact` object: sha256 hashes plus last4/domain hints; no raw methods.
    private func redactedContactPayload(_ contact: CNContact) -> [String: Any] {
        let phoneNumberHashes = contact.phoneNumbers.compactMap { normalizedPhoneHash($0.value.stringValue) }
        let emailHashes = contact.emailAddresses.compactMap { normalizedEmailHash(String($0.value)) }

        [
            "stableId": contact.identifier,
            "unifiedStableId": contact.identifier,
            "containerId": "unknown",
            "displayName": CNContactFormatter.string(from: contact, style: .fullName) ?? "Unnamed Contact",
            "phoneNumberHashes": phoneNumberHashes,
            "phoneNumberHints": contact.phoneNumbers.map { ["last4": String($0.value.stringValue.suffix(4)), "label": $0.label ?? "phone"] },
            "emailHashes": emailHashes,
            "emailHints": contact.emailAddresses.map { ["domain": String($0.value).components(separatedBy: "@").last ?? "", "label": $0.label ?? "email"] }
        ]
    }

    private func normalizedPhoneHash(_ value: String) -> String? {
        let digits = value.filter { $0.isNumber }
        guard !digits.isEmpty else {
            return nil
        }
        return sha256Hash(digits)
    }

    private func normalizedEmailHash(_ value: String) -> String? {
        let email = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !email.isEmpty else {
            return nil
        }
        return sha256Hash(email)
    }

    private func sha256Hash(_ value: String) -> String {
        let digest = SHA256.hash(data: Data(value.utf8))
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return "sha256:\(hex)"
    }

    private func queryCalendarContext(detectedAt: Date) -> (query: [String: Any], matches: [[String: Any]]) {
        let start = Calendar.current.date(byAdding: .hour, value: -4, to: detectedAt) ?? detectedAt
        let end = Calendar.current.date(byAdding: .hour, value: 1, to: detectedAt) ?? detectedAt
        let permission = calendarPermissionStatus(eventStore)

        guard permission == "authorized" else {
            return (
                [
                    "startsAt": ISO8601DateFormatter().string(from: start),
                    "endsAt": ISO8601DateFormatter().string(from: end),
                    "resultCountBeforeLimit": 0,
                    "permissionStatus": permission
                ],
                []
            )
        }

        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: nil)
        let events = eventStore.events(matching: predicate)
        let matches = sortedCalendarEvents(events).prefix(20).map { event in
            [
                "eventIdentifier": event.eventIdentifier ?? "",
                "calendarIdentifier": event.calendar.calendarIdentifier,
                "title": event.title ?? "",
                "startsAt": ISO8601DateFormatter().string(from: event.startDate),
                "endsAt": ISO8601DateFormatter().string(from: event.endDate),
                "location": event.location ?? "",
                "calendarSource": event.calendar.source.title,
                "calendarTitle": event.calendar.title,
                "isAllDay": event.isAllDay,
                "attendeeCount": event.attendees?.count ?? 0,
                "availability": "busy",
                "status": "confirmed",
                "isRecurring": event.hasRecurrenceRules
            ] as [String: Any]
        }

        return (
            [
                "startsAt": ISO8601DateFormatter().string(from: start),
                "endsAt": ISO8601DateFormatter().string(from: end),
                "resultCountBeforeLimit": events.count,
                "permissionStatus": permission
            ],
            Array(matches)
        )
    }

    private func sortedCalendarEvents(_ events: [EKEvent]) -> [EKEvent] {
        events.sorted { left, right in
            if left.startDate != right.startDate {
                return left.startDate < right.startDate
            }

            if left.endDate != right.endDate {
                return left.endDate < right.endDate
            }

            let leftTitle = left.title ?? ""
            let rightTitle = right.title ?? ""
            if leftTitle != rightTitle {
                return leftTitle < rightTitle
            }

            if left.calendar.calendarIdentifier != right.calendar.calendarIdentifier {
                return left.calendar.calendarIdentifier < right.calendar.calendarIdentifier
            }

            return (left.eventIdentifier ?? "") < (right.eventIdentifier ?? "")
        }
    }
}

func runNativeMacosSensor(stateDir: String, identity: SensorIdentity) {
    NativeMacosSensor(stateDir: stateDir, identity: identity).start()
}

func calendarPermissionStatus(_ eventStore: EKEventStore) -> String {
    switch EKEventStore.authorizationStatus(for: .event) {
    case .authorized:
        return "authorized"
    case .denied:
        return "denied"
    case .restricted:
        return "restricted"
    case .notDetermined:
        return "notDetermined"
    @unknown default:
        return "unavailable"
    }
}

func emitContactsPermissionError(identity: SensorIdentity) {
    var event = commonSensorEvent("permission_error", identity: identity)
    event["idempotencyKey"] = "permission_error:\(identity.deviceId):\(identity.runId):contacts_permission_denied"
    event["code"] = "contacts_permission_denied"
    event["message"] = "Contacts permission denied by user."
    event["retryable"] = true
    emitSensorEvent(event)
}

private func nowString() -> String {
    ISO8601DateFormatter().string(from: Date())
}

#else

func runNativeMacosSensor(stateDir: String, identity: SensorIdentity) {
    emitSensorEvent(fatalSensorEvent(
        code: "unsupported_platform",
        message: "Friendy macOS sensor requires macOS Contacts and EventKit frameworks.",
        identity: identity
    ))
    exit(1)
}

#endif
