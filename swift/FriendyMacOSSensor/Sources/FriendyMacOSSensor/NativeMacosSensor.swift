// Native macOS Contacts/Calendar sensor: CNChangeHistory → redacted NDJSON → durable outbox → ack → token advance.
// NDJSON contract matches `src/relationship/runtime/sensorEvents.ts` (parsed by the Node runtime supervisor).

import Foundation

#if os(macOS) && canImport(Contacts) && canImport(EventKit) && canImport(CryptoKit)
import Contacts
import ContactsHistoryBridge
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
    private var contactsPollTimer: Timer?
    private var contactEmitDebounceTimer: Timer?
    private var isHandlingContactsChange = false
    /// Contacts seen in history (add or update) but not emitted until they look saved (real name, not in-progress card).
    private var pendingContactIdentifiers: Set<String> = []
    private var pendingDiagnosticContactIdentifiers: Set<String> = []
    private var pendingHistoryTokenAfter: Data?
    private var lastNoChangeDiagnosticAt: Date?
    private var contactsPollCount = 0

    /// Quiet period after the last add/update before re-fetching; mimics waiting until the user taps Done.
    private static let contactEmitDebounceSeconds: TimeInterval = 5.0
    private static let noChangeDiagnosticSeconds: TimeInterval = 15.0

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

    /// Last seen contact identifiers; used when CNChangeHistory returns no add/update events.
    private var contactSnapshotURL: URL {
        stateDir.appendingPathComponent("contacts-identifier-snapshot.json")
    }

    /// Agent writes this file when the user texts `start` so a live sensor re-baselines immediately.
    private var resetContactSnapshotSignalURL: URL {
        stateDir.appendingPathComponent("reset-contact-snapshot.signal")
    }

    func start() {
        // APPL bundles must initialize NSApplication before RunLoop.run(); the notDetermined path
        // already calls prepareForSystemPermissionPrompt(), but the authorized fast path did not.
        prepareForSystemPermissionPrompt()

        let status = CNContactStore.authorizationStatus(for: .contacts)
        switch status {
        case .authorized:
            startAuthorized()
        case .notDetermined, .limited:
            requestContactsAccess { granted in
                let resolved = CNContactStore.authorizationStatus(for: .contacts)
                if granted || resolved == .authorized {
                    DispatchQueue.main.async {
                        self.startAuthorized()
                    }
                } else {
                    emitContactsPermissionError(identity: self.identity, status: resolved)
                    exit(1)
                }
            }
        default:
            emitContactsPermissionError(identity: identity, status: status)
            exit(1)
        }
        RunLoop.current.run()
    }

    private func requestContactsAccess(_ completion: @escaping (Bool) -> Void) {
        let runRequest = {
            prepareForSystemPermissionPrompt()
            self.contactStore.requestAccess(for: .contacts) { granted, _ in
                completion(granted)
            }
        }

        if Thread.isMainThread {
            runRequest()
        } else {
            DispatchQueue.main.async(execute: runRequest)
        }
    }

    private func startAuthorized() {
        requestCalendarPermissionIfNeeded { [weak self] calendarPermissionStatus in
            DispatchQueue.main.async {
                self?.startMonitoring(calendarPermissionStatus: calendarPermissionStatus)
            }
        }
    }

    private func startMonitoring(calendarPermissionStatus resolvedCalendarPermissionStatus: String) {
        dispatchPrecondition(condition: .onQueue(.main))
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
                self?.scheduleContactsChanged()
            }
            establishContactIdentifierSnapshotIfNeeded()
            startContactsPolling()
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
                let status = granted ? "fullAccess" : calendarPermissionStatus(self.eventStore)
                DispatchQueue.main.async {
                    completion(status)
                }
            }
        } else {
            eventStore.requestAccess(to: .event) { granted, _ in
                let status = granted ? "authorized" : calendarPermissionStatus(self.eventStore)
                DispatchQueue.main.async {
                    completion(status)
                }
            }
        }
    }

    private func saveBaselineToken() throws {
        guard let token = contactStore.currentHistoryToken else {
            return
        }
        try token.write(to: tokenURL, options: .atomic)
    }

    private func loadHistoryToken() -> Data? {
        try? Data(contentsOf: tokenURL)
    }

    /// Headless `.app` launches often miss `CNContactStoreDidChange`; poll as a fallback.
    private func startContactsPolling() {
        dispatchPrecondition(condition: .onQueue(.main))
        contactsPollTimer?.invalidate()
        let timer = Timer(timeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.scheduleContactsChanged()
        }
        RunLoop.main.add(timer, forMode: .common)
        contactsPollTimer = timer
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            self?.scheduleContactsChanged()
        }
    }

    private func scheduleMainRunLoopTimer(
        timeInterval: TimeInterval,
        repeats: Bool,
        block: @escaping (Timer) -> Void
    ) -> Timer {
        dispatchPrecondition(condition: .onQueue(.main))
        let timer = Timer(timeInterval: timeInterval, repeats: repeats, block: block)
        RunLoop.main.add(timer, forMode: .common)
        return timer
    }

    private func scheduleContactsChanged() {
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.isHandlingContactsChange else {
                return
            }
            self.isHandlingContactsChange = true
            defer { self.isHandlingContactsChange = false }
            self.handleContactsChanged()
        }
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
            let historyFetch = try fetchContactHistoryChanges(startingToken: startingToken)
            contactsPollCount += 1
            var newlyQueuedContactIdentifiers = Set<String>()
            for identifier in historyFetch.touchedContactIds {
                if pendingContactIdentifiers.insert(identifier).inserted {
                    newlyQueuedContactIdentifiers.insert(identifier)
                }
            }
            pendingHistoryTokenAfter = historyFetch.tokenAfter
            try historyFetch.tokenAfter.write(to: tokenURL, options: .atomic)

            consumeContactSnapshotResetSignalIfPresent()
            let snapshotDiff = try detectNewContactsFromSnapshot()
            if !snapshotDiff.newIds.isEmpty {
                for identifier in snapshotDiff.newIds {
                    if pendingContactIdentifiers.insert(identifier).inserted {
                        newlyQueuedContactIdentifiers.insert(identifier)
                    }
                }
            }

            if historyFetch.touchedContactIds.isEmpty && snapshotDiff.newIds.isEmpty {
                emitNoChangeDiagnosticIfDue()
            } else {
                lastNoChangeDiagnosticAt = nil
                let pendingReason = !historyFetch.touchedContactIds.isEmpty
                    ? "history_changes_queued"
                    : "snapshot_diff_new_contacts"
                emitSensorEvent(contactPendingEvent(
                    identity: identity,
                    reason: pendingReason,
                    pendingContactCount: pendingContactIdentifiers.count,
                    nextCheckInSeconds: Int(Self.contactEmitDebounceSeconds)
                ))
            }

            if !newlyQueuedContactIdentifiers.isEmpty {
                schedulePendingContactEmit()
            } else if !pendingContactIdentifiers.isEmpty, contactEmitDebounceTimer?.isValid != true {
                schedulePendingContactEmit()
            }
        } catch {
            do {
                try saveBaselineToken()
                emitSensorEvent(historyResetEvent(identity: identity, reason: "expired_token", detectedAt: nowString()))
            } catch {
                emitSensorEvent(fatalSensorEvent(code: "history_reset_failed", message: error.localizedDescription, identity: identity))
            }
        }
    }

    private struct ContactHistoryFetchResult {
        let touchedContactIds: Set<String>
        let tokenAfter: Data
        let addEventCount: Int
        let updateEventCount: Int
        let otherEventCount: Int
    }

    private func loadContactIdentifierSnapshot() -> Set<String> {
        guard let data = try? Data(contentsOf: contactSnapshotURL),
              let identifiers = try? JSONSerialization.jsonObject(with: data) as? [String] else {
            return []
        }
        return Set(identifiers)
    }

    private func saveContactIdentifierSnapshot(_ identifiers: Set<String>) {
        let sorted = identifiers.sorted()
        guard JSONSerialization.isValidJSONObject(sorted),
              let data = try? JSONSerialization.data(withJSONObject: sorted, options: []) else {
            return
        }
        try? data.write(to: contactSnapshotURL, options: .atomic)
    }

    private func consumeContactSnapshotResetSignalIfPresent() {
        guard fileManager.fileExists(atPath: resetContactSnapshotSignalURL.path) else {
            return
        }

        try? fileManager.removeItem(at: contactSnapshotURL)
        try? fileManager.removeItem(at: resetContactSnapshotSignalURL)
    }

    private func fetchAllContactIdentifiers() throws -> Set<String> {
        var identifiers = Set<String>()
        let request = CNContactFetchRequest(keysToFetch: [CNContactIdentifierKey as CNKeyDescriptor])
        request.unifyResults = true
        try contactStore.enumerateContacts(with: request) { contact, _ in
            identifiers.insert(contact.identifier)
        }
        return identifiers
    }

    private func fetchRawContactIdentifierCount() throws -> Int {
        var count = 0
        let request = CNContactFetchRequest(keysToFetch: [CNContactIdentifierKey as CNKeyDescriptor])
        request.unifyResults = false
        try contactStore.enumerateContacts(with: request) { _, _ in
            count += 1
        }
        return count
    }

    /// Seeds snapshot on first run; on later polls returns identifiers absent from the saved snapshot.
    private func establishContactIdentifierSnapshotIfNeeded() {
        guard loadContactIdentifierSnapshot().isEmpty else {
            return
        }
        guard let current = try? fetchAllContactIdentifiers() else {
            return
        }
        saveContactIdentifierSnapshot(current)
    }

    private struct ContactSnapshotDiff {
        let newIds: Set<String>
        let currentCount: Int
        let baselineCount: Int
    }

    private func detectNewContactsFromSnapshot() throws -> ContactSnapshotDiff {
        let current = try fetchAllContactIdentifiers()
        let baseline = loadContactIdentifierSnapshot()
        let currentCount = current.count
        if baseline.isEmpty {
            saveContactIdentifierSnapshot(current)
            return ContactSnapshotDiff(newIds: [], currentCount: currentCount, baselineCount: 0)
        }
        let newIds = current.subtracting(baseline)
        saveContactIdentifierSnapshot(current)
        return ContactSnapshotDiff(
            newIds: newIds,
            currentCount: currentCount,
            baselineCount: baseline.count
        )
    }

    private func emitNoChangeDiagnosticIfDue(now: Date = Date()) {
        if let lastNoChangeDiagnosticAt,
           now.timeIntervalSince(lastNoChangeDiagnosticAt) < Self.noChangeDiagnosticSeconds {
            return
        }

        lastNoChangeDiagnosticAt = now
        emitSensorEvent(sensorDiagnosticEvent(
            identity: identity,
            code: "contacts_history_poll_no_changes",
            pendingContactCount: pendingContactIdentifiers.count,
            nextCheckInSeconds: Int(Self.contactEmitDebounceSeconds)
        ))
    }

    private var contactKeyDescriptors: [CNKeyDescriptor] {
        [
            CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactIdentifierKey as CNKeyDescriptor
        ]
    }

    private func schedulePendingContactEmit() {
        if contactEmitDebounceTimer?.isValid == true {
            return
        }

        contactEmitDebounceTimer?.invalidate()
        contactEmitDebounceTimer = scheduleMainRunLoopTimer(
            timeInterval: Self.contactEmitDebounceSeconds,
            repeats: false
        ) { [weak self] _ in
            self?.flushPendingContactAdds()
        }
    }

    /// Re-fetches queued contacts after debounce; emits only contacts that look saved (not in-progress cards).
    private func flushPendingContactAdds() {
        let identifiers = Array(pendingContactIdentifiers)
        guard !identifiers.isEmpty else {
            return
        }

        do {
            let contacts = try fetchContacts(byIdentifiers: identifiers)
            guard !contacts.isEmpty else {
                emitSensorEvent(contactPendingEvent(
                    identity: identity,
                    reason: "contact_not_found_after_history",
                    pendingContactCount: identifiers.count,
                    readyContactCount: 0
                ))
                pendingContactIdentifiers.removeAll()
                pendingDiagnosticContactIdentifiers.subtract(identifiers)
                return
            }

            let readyContacts = contacts.filter { isReadyForFriendyPrompt($0) }
            let readyContactIdentifiers = Set(readyContacts.map(\.identifier))
            let stillWaiting = Set(contacts.filter { !isReadyForFriendyPrompt($0) }.map(\.identifier))
            pendingContactIdentifiers = stillWaiting
            pendingDiagnosticContactIdentifiers.subtract(readyContactIdentifiers)
            let newlyWaiting = stillWaiting.subtracting(pendingDiagnosticContactIdentifiers)

            if !newlyWaiting.isEmpty {
                emitSensorEvent(contactPendingEvent(
                    identity: identity,
                    reason: "waiting_for_saved_contact",
                    pendingContactCount: stillWaiting.count,
                    readyContactCount: readyContacts.count,
                    nextCheckInSeconds: Int(Self.contactEmitDebounceSeconds)
                ))
                pendingDiagnosticContactIdentifiers.formUnion(stillWaiting)
            }

            guard !readyContacts.isEmpty else {
                if !stillWaiting.isEmpty {
                    schedulePendingContactEmit()
                }
                return
            }

            let batchId = "history_batch_\(UUID().uuidString)"
            let tokenBeforeRef = "outbox:\(batchId):before"
            let tokenAfterRef = "outbox:\(batchId):after"
            let tokenAfter = pendingHistoryTokenAfter ?? (try? Data(contentsOf: tokenURL)) ?? Data()
            pendingHistoryTokenAfter = nil

            let detectedAt = Date()
            let observedAt = nowString()
            let calendar = queryCalendarContext(detectedAt: detectedAt)
            let events = readyContacts.enumerated().map { index, contact in
                contactAddedEvent(
                    identity: identity,
                    eventId: "sensor_evt_contact_\(UUID().uuidString)",
                    idempotencyKey: "contacts:\(identity.deviceId):\(contact.identifier):add",
                    historyBatchId: batchId,
                    historyBatchIndex: index,
                    historyBatchSize: readyContacts.count,
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
            emitSensorEvent(fatalSensorEvent(code: "pending_contact_emit_failed", message: error.localizedDescription, identity: identity))
        }
    }

    private func fetchContacts(byIdentifiers identifiers: [String]) throws -> [CNContact] {
        guard !identifiers.isEmpty else {
            return []
        }

        var contacts: [CNContact] = []
        let request = CNContactFetchRequest(keysToFetch: contactKeyDescriptors)
        request.predicate = CNContact.predicateForContacts(withIdentifiers: identifiers)
        try contactStore.enumerateContacts(with: request) { contact, _ in
            contacts.append(contact)
        }
        return contacts
    }

    private func fetchContactHistoryChanges(startingToken: Data) throws -> ContactHistoryFetchResult {
        let request = CNChangeHistoryFetchRequest()
        request.startingToken = startingToken
        request.additionalContactKeyDescriptors = contactKeyDescriptors

        let bridge = ContactsHistoryBridge(store: contactStore)
        let fetchResult = try bridge.fetchChangeHistory(request)
        let tokenAfter = fetchResult.currentHistoryToken

        var touchedContactIds = Set<String>()
        var addEventCount = 0
        var updateEventCount = 0
        var otherEventCount = 0
        let enumerator = fetchResult.value
        while let event = enumerator.nextObject() as? CNChangeHistoryEvent {
            if let add = event as? CNChangeHistoryAddContactEvent {
                addEventCount += 1
                touchedContactIds.insert(add.contact.identifier)
                continue
            }
            if let update = event as? CNChangeHistoryUpdateContactEvent {
                updateEventCount += 1
                touchedContactIds.insert(update.contact.identifier)
                continue
            }
            otherEventCount += 1
        }

        return ContactHistoryFetchResult(
            touchedContactIds: touchedContactIds,
            tokenAfter: tokenAfter,
            addEventCount: addEventCount,
            updateEventCount: updateEventCount,
            otherEventCount: otherEventCount
        )
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
    private func hasUsableDisplayName(_ contact: CNContact) -> Bool {
        let name = CNContactFormatter.string(from: contact, style: .fullName)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return !name.isEmpty && name != "Unnamed Contact"
    }

    /// True when the contact card looks saved enough to prompt (real name; not an empty in-progress add).
    private func isReadyForFriendyPrompt(_ contact: CNContact) -> Bool {
        hasUsableDisplayName(contact)
    }

    private func redactedContactPayload(_ contact: CNContact) -> [String: Any] {
        let phoneNumberHashes = contact.phoneNumbers.compactMap { normalizedPhoneHash($0.value.stringValue) }
        let emailHashes = contact.emailAddresses.compactMap { normalizedEmailHash(String($0.value)) }

        return [
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

        guard permission == "authorized" || permission == "fullAccess" else {
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

/// Starts the long-lived Contacts/Calendar watcher for the given state directory.
func runNativeMacosSensor(stateDir: String, identity: SensorIdentity) {
    NativeMacosSensor(stateDir: stateDir, identity: identity).start()
}

func calendarPermissionStatus(_ eventStore: EKEventStore) -> String {
    switch EKEventStore.authorizationStatus(for: .event) {
    case .authorized:
        return "authorized"
    case .fullAccess:
        return "fullAccess"
    case .writeOnly:
        return "writeOnly"
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

func emitContactsPermissionError(identity: SensorIdentity, status: CNAuthorizationStatus) {
    var event = commonSensorEvent("permission_error", identity: identity)
    event["idempotencyKey"] = "permission_error:\(identity.deviceId):\(identity.runId):contacts_permission_denied"
    event["code"] = "contacts_permission_denied"
    let statusLabel = contactsAuthorizationStatusLabel(status)
    var message =
        "Contacts permission denied (status=\(statusLabel)). " +
        "Enable \"Friendy macOS Sensor\" under System Settings → Privacy & Security → Contacts, then launch via " +
        "`open -n \"bin/Friendy macOS Sensor.app\" --args --state-dir <path>` or `npm run agent:friendy` " +
        "(do not run the .app/Contents/MacOS binary directly from Terminal)."
    if status == .notDetermined {
        message +=
            " If no prompt appeared, run `bin/friendy-macos-sensor --state-dir .friendy/macos-sensor-state` from Terminal.app (not Cursor) and click Allow."
    }
    event["message"] = message
    event["retryable"] = true
    emitSensorEvent(event)
}

private func contactsAuthorizationStatusLabel(_ status: CNAuthorizationStatus) -> String {
    switch status {
    case .notDetermined:
        return "notDetermined"
    case .restricted:
        return "restricted"
    case .denied:
        return "denied"
    case .authorized:
        return "authorized"
    case .limited:
        return "limited"
    @unknown default:
        return "unknown(\(status.rawValue))"
    }
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
