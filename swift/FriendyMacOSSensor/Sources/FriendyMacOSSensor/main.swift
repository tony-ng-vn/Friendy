import Foundation

#if canImport(Contacts)
import Contacts
#endif

#if canImport(EventKit)
import EventKit
#endif

let sensorName = "macos_contacts_calendar"
let sensorVersion = "0.1.0"
let runId = "sensor_run_\(UUID().uuidString)"
let deviceId = Host.current().localizedName ?? "mac_local"

func emit(_ event: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(event),
          let data = try? JSONSerialization.data(withJSONObject: event, options: []),
          let line = String(data: data, encoding: .utf8) else {
        fputs("Failed to encode sensor event\n", stderr)
        exit(1)
    }

    print(line)
    fflush(stdout)
}

func commonEvent(_ type: String) -> [String: Any] {
    [
        "schemaVersion": 1,
        "eventId": "sensor_evt_\(UUID().uuidString)",
        "type": type,
        "sensorName": sensorName,
        "sensorVersion": sensorVersion,
        "runId": runId,
        "deviceId": deviceId,
        "emittedAt": ISO8601DateFormatter().string(from: Date())
    ]
}

func emitFatal(_ code: String, _ message: String) -> Never {
    var event = commonEvent("fatal_error")
    event["idempotencyKey"] = "fatal_error:\(deviceId):\(runId):\(code)"
    event["code"] = code
    event["message"] = message
    event["retryable"] = false
    emit(event)
    exit(1)
}

func stateDirectoryArgument(_ args: [String]) -> String? {
    guard let index = args.firstIndex(of: "--state-dir"), index + 1 < args.count else {
        return nil
    }

    return args[index + 1]
}

guard let stateDir = stateDirectoryArgument(CommandLine.arguments) else {
    emitFatal("missing_state_dir", "Usage: friendy-macos-sensor --state-dir <path>")
}

do {
    try FileManager.default.createDirectory(atPath: stateDir, withIntermediateDirectories: true)
} catch {
    emitFatal("state_dir_unwritable", "Failed to create state directory: \(error.localizedDescription)")
}

#if os(macOS) && canImport(Contacts) && canImport(EventKit)
emitFatal("sensor_scaffold_unimplemented", "Friendy macOS sensor scaffold built successfully; live Contacts monitoring is not implemented in this binary yet.")
#else
emitFatal("unsupported_platform", "Friendy macOS sensor requires macOS Contacts and EventKit frameworks.")
#endif
