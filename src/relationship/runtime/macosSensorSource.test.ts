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
    expect(eventSource).toContain('commonSensorEvent("contact_added"');
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
});

function readSwift(filename: string): string {
  return readFileSync(join(swiftSourceRoot, filename), "utf8");
}
