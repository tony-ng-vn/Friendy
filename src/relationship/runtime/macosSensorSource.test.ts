import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const swiftSourceRoot = join("swift", "FriendyMacOSSensor", "Sources", "FriendyMacOSSensor");

describe("macOS sensor Swift source contract", () => {
  it("keeps the executable entrypoint thin and moves sensor behavior into named source files", () => {
    for (const filename of ["main.swift", "SensorCLI.swift", "SensorEvents.swift", "NativeMacosSensor.swift"]) {
      expect(existsSync(join(swiftSourceRoot, filename)), `${filename} should exist`).toBe(true);
    }

    expect(readSwift("main.swift")).toContain("runSensorCLI(arguments: CommandLine.arguments)");
  });

  it("supports a redacted contact_added fixture mode for runtime smoke testing", () => {
    const cliSource = readSwift("SensorCLI.swift");
    const eventSource = readSwift("SensorEvents.swift");

    expect(cliSource).toContain("--emit-fixture");
    expect(cliSource).toContain("contact_added");
    expect(cliSource).toContain("contact_batch");
    expect(eventSource).toContain('commonSensorEvent("contact_added"');
    expect(eventSource).toContain("historyBatchCompleteFixtureEvent");
    expect(eventSource).toContain('"phoneNumberHashes"');
    expect(eventSource).toContain('"phoneNumberHints"');
    expect(eventSource).toContain('"emailHashes"');
    expect(eventSource).toContain('"emailHints"');
    expect(eventSource).not.toContain('"phoneNumbers"');
    expect(eventSource).not.toContain('"emails"');
  });

  it("keeps Contacts and EventKit usage behind a macOS-only native sensor source", () => {
    const nativeSource = readSwift("NativeMacosSensor.swift");

    expect(nativeSource).toContain("#if os(macOS) && canImport(Contacts) && canImport(EventKit)");
    expect(nativeSource).toContain("CNContactStore");
    expect(nativeSource).toContain("CNChangeHistoryFetchRequest");
    expect(nativeSource).toContain("CNContactStoreDidChange");
    expect(nativeSource).toContain("EKEventStore");
  });

  it("documents crash-safe Contacts token and outbox handling in native source", () => {
    const nativeSource = readSwift("NativeMacosSensor.swift");
    const eventSource = readSwift("SensorEvents.swift");

    expect(nativeSource).toContain("contacts-history-token.data");
    expect(nativeSource).toContain("contactStore.currentHistoryToken");
    expect(nativeSource).toContain("saveBaselineToken");
    expect(nativeSource).toContain("baselineCreated: true");
    expect(nativeSource).toContain("CNChangeHistoryFetchRequest");
    expect(nativeSource).toContain("startingToken");
    expect(nativeSource).toContain("CNChangeHistoryAddContactEvent");
    expect(nativeSource).toContain("writeHistoryBatchOutbox");
    expect(nativeSource).toContain("waitForAckAndAdvanceToken");
    expect(nativeSource).toContain("history_reset");
    expect(eventSource).toContain("historyBatchCompleteEvent");
    expect(eventSource).toContain("contactAddedEvent");
  });

  it("replays pending outbox batches until Node acks and then advances the token", () => {
    const nativeSource = readSwift("NativeMacosSensor.swift");

    expect(nativeSource).toContain('let tokenAfterPath = payload["tokenAfterPath"] as? String');
    expect(nativeSource).toContain("Data(contentsOf: URL(fileURLWithPath: tokenAfterPath))");
    expect(nativeSource).toContain("waitForAckAndAdvanceToken(batchId: historyBatchId, tokenAfter: tokenAfter, ackPath: ackPath");
    expect(nativeSource).toContain('removeItem(at: self.outboxDir.appendingPathComponent("\\(batchId)-after-token.data"))');
  });

  it("keeps Calendar permission degradation non-fatal while Contacts denial exits", () => {
    const nativeSource = readSwift("NativeMacosSensor.swift");

    expect(nativeSource).toContain("requestCalendarPermissionIfNeeded");
    expect(nativeSource).toContain("requestFullAccessToEvents");
    expect(nativeSource).toContain("requestAccess(to: .event");
    expect(nativeSource).toContain('guard permission == "authorized" else');
    expect(nativeSource).toContain('"permissionStatus": permission');
    expect(nativeSource).toContain("emitContactsPermissionError");
    expect(nativeSource).toContain("exit(1)");
    expect(nativeSource).toContain('return "unavailable"');
    expect(nativeSource).not.toContain('return "unknown"');
  });

  it("sorts EventKit matches deterministically before applying the raw candidate cap", () => {
    const nativeSource = readSwift("NativeMacosSensor.swift");

    expect(nativeSource).toContain("sortedCalendarEvents(events)");
    expect(nativeSource).toContain("left.startDate != right.startDate");
    expect(nativeSource).toContain("left.endDate != right.endDate");
    expect(nativeSource).toContain("left.calendar.calendarIdentifier");
    expect(nativeSource.indexOf("sortedCalendarEvents(events).prefix(20)")).toBeGreaterThan(
      nativeSource.indexOf("let events = eventStore.events(matching: predicate)")
    );
  });
});

function readSwift(filename: string): string {
  return readFileSync(join(swiftSourceRoot, filename), "utf8");
}
