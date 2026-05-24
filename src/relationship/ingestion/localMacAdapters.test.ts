import { describe, expect, it, vi } from "vitest";
import {
  parseMacCalendarEventsOutput,
  parseMacContactsSnapshotOutput,
  readMacCalendarEvents,
  readMacContactsSnapshot
} from "./localMacAdapters";
import { hashNormalizedContactMethod } from "./contactMethodRedaction";

describe("local macOS adapters", () => {
  it("parses Contacts output into a redacted contact snapshot", () => {
    const output = [
      "contact-1\tFriendy-101\t+1 (555) 010-0101\tfriendy101@example.com\t2026-05-20T19:30:00.000Z",
      "contact-2\tAlex Lee\t+15550100000|\t\t2026-05-20T18:00:00.000Z"
    ].join("\n");

    const snapshot = parseMacContactsSnapshotOutput({
      userId: "user_local",
      capturedAt: "2026-05-20T20:00:00.000Z",
      output
    });

    expect(snapshot.userId).toBe("user_local");
    expect(snapshot.contacts[0]).toMatchObject({
      stableId: "contact-1",
      displayName: "Friendy-101",
      phoneNumbers: ["ending in 0101"],
      emails: ["email at example.com"],
      phoneNumberHashes: [hashNormalizedContactMethod("phone", "+15550100101")],
      emailHashes: [hashNormalizedContactMethod("email", "friendy101@example.com")],
      updatedAt: "2026-05-20T19:30:00.000Z"
    });
    expect(snapshot.contacts[1]).toMatchObject({
      stableId: "contact-2",
      displayName: "Alex Lee",
      phoneNumbers: ["ending in 0000"],
      emails: [],
      updatedAt: "2026-05-20T18:00:00.000Z"
    });
    expect(JSON.stringify(snapshot)).not.toContain("+15550100101");
    expect(JSON.stringify(snapshot)).not.toContain("friendy101@example.com");
  });

  it("parses Calendar output into apple calendar events", () => {
    const output = [
      [
        "event-1",
        "Photon Residency Dinner",
        "2026-05-20T19:00:00.000Z",
        "2026-05-20T22:00:00.000Z",
        "America/Los_Angeles",
        "San Francisco",
        "short"
      ].join("\t")
    ].join("\n");

    const events = parseMacCalendarEventsOutput({ userId: "user_local", output });

    expect(events).toEqual([
      {
        id: "event-1",
        userId: "user_local",
        title: "Photon Residency Dinner",
        startsAt: "2026-05-20T19:00:00.000Z",
        endsAt: "2026-05-20T22:00:00.000Z",
        timezone: "America/Los_Angeles",
        location: "San Francisco",
        calendarSource: "apple_calendar",
        eventKind: "short"
      }
    ]);
  });

  it("fails clearly outside macOS before reading Contacts", () => {
    const execFileSync = vi.fn();

    expect(() =>
      readMacContactsSnapshot({
        userId: "user_local",
        capturedAt: "2026-05-20T20:00:00.000Z",
        platform: "linux",
        execFileSync
      })
    ).toThrow("macOS Contacts local check is only available on darwin");
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("fails clearly outside macOS before reading Calendar", () => {
    const execFileSync = vi.fn();

    expect(() =>
      readMacCalendarEvents({
        userId: "user_local",
        windowStart: "2026-05-20T00:00:00.000Z",
        windowEnd: "2026-05-21T00:00:00.000Z",
        platform: "linux",
        execFileSync
      })
    ).toThrow("macOS Calendar local check is only available on darwin");
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
