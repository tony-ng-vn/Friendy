// CLI for `friendy-macos-sensor`: `--state-dir` for live monitoring or `--emit-fixture` for contract smoke lines.

import Foundation

/// Parsed flags for state directory and optional fixture emission.
struct SensorCLIOptions {
    let stateDir: String
    let emitFixture: String?
    let eventLogPath: String?
}

/// Entry: validates args, ensures state dir exists, then runs native sensor or prints fixture NDJSON.
func runSensorCLI(arguments: [String]) {
    let identity = SensorIdentity.current()

    guard let options = parseSensorCLIOptions(arguments) else {
        emitSensorEvent(fatalSensorEvent(
            code: "missing_state_dir",
            message: "Usage: friendy-macos-sensor --state-dir <path> [--emit-fixture contact_batch|contact_added|ready]",
            identity: identity
        ))
        exit(1)
    }

    do {
        try FileManager.default.createDirectory(atPath: options.stateDir, withIntermediateDirectories: true)
    } catch {
        emitSensorEvent(fatalSensorEvent(
            code: "state_dir_unwritable",
            message: "Failed to create state directory: \(error.localizedDescription)",
            identity: identity
        ))
        exit(1)
    }

    if let fixture = options.emitFixture {
        emitFixtureEvent(fixture, identity: identity)
        return
    }

    sensorEventLogPath = options.eventLogPath
    runNativeMacosSensor(stateDir: options.stateDir, identity: identity)
}

func parseSensorCLIOptions(_ arguments: [String]) -> SensorCLIOptions? {
    guard let stateDir = valueAfter("--state-dir", in: arguments) else {
        return nil
    }

    return SensorCLIOptions(
        stateDir: stateDir,
        emitFixture: valueAfter("--emit-fixture", in: arguments),
        eventLogPath: valueAfter("--event-log", in: arguments)
    )
}

func valueAfter(_ flag: String, in arguments: [String]) -> String? {
    guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else {
        return nil
    }

    return arguments[index + 1]
}

func emitFixtureEvent(_ fixture: String, identity: SensorIdentity) {
    if fixture == "contact_batch" {
        emitSensorEvent(contactAddedFixtureEvent(identity: identity))
        emitSensorEvent(historyBatchCompleteFixtureEvent(identity: identity))
        return
    }

    if fixture == "contact_added" {
        emitSensorEvent(contactAddedFixtureEvent(identity: identity))
        return
    }

    if fixture == "ready" {
        emitSensorEvent(readySensorEvent(identity: identity, baselineCreated: false, calendarPermissionStatus: "authorized"))
        return
    }

    emitSensorEvent(fatalSensorEvent(
        code: "unknown_fixture",
        message: "Unknown fixture \(fixture). Supported fixtures: contact_batch, contact_added, ready.",
        identity: identity
    ))
    exit(1)
}
