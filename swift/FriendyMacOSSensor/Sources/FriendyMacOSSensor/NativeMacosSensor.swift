import Foundation

#if os(macOS) && canImport(Contacts) && canImport(EventKit)
import Contacts
import EventKit

func runNativeMacosSensor(stateDir: String, identity: SensorIdentity) {
    let contactStore = CNContactStore()
    let eventStore = EKEventStore()

    switch CNContactStore.authorizationStatus(for: .contacts) {
    case .authorized:
        emitSensorEvent(readySensorEvent(identity: identity, baselineCreated: false, calendarPermissionStatus: calendarPermissionStatus(eventStore)))
        NotificationCenter.default.addObserver(
            forName: .CNContactStoreDidChange,
            object: contactStore,
            queue: nil
        ) { _ in
            // The live implementation will create a CNChangeHistoryFetchRequest from the saved token,
            // fetch CNChangeHistoryAddContactEvent values, query EventKit, and emit contact_added.
            _ = CNChangeHistoryFetchRequest()
        }
        RunLoop.current.run()
    case .notDetermined:
        contactStore.requestAccess(for: .contacts) { granted, _ in
            if granted {
                emitSensorEvent(readySensorEvent(identity: identity, baselineCreated: false, calendarPermissionStatus: calendarPermissionStatus(eventStore)))
            } else {
                emitContactsPermissionError(identity: identity)
            }
            exit(granted ? 0 : 1)
        }
        RunLoop.current.run()
    default:
        emitContactsPermissionError(identity: identity)
        exit(1)
    }
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
        return "unknown"
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
