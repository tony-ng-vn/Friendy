import { describe, expect, it } from "vitest";
import {
  detectNewContactMethods,
  fixtureAfterContactSnapshot,
  fixtureBeforeContactSnapshot,
  normalizeContactMethod
} from "./contactSnapshot";
import { fixtureUser } from "../fixtures";

describe("contact snapshot diff", () => {
  it("detects newly added phone and email methods with deterministic detectedAt", () => {
    const detections = detectNewContactMethods(fixtureBeforeContactSnapshot, fixtureAfterContactSnapshot);

    expect(detections.map((item) => item.displayName)).toEqual(["Maya Chen", "Nina Park"]);
    expect(detections[0]).toMatchObject({
      userId: fixtureUser.id,
      displayName: "Maya Chen",
      phoneNumbers: ["+15550101020"],
      emails: [],
      detectedAt: "2026-05-15T21:42:00-07:00",
      source: "contacts_delta"
    });
    expect(detections[1]).toMatchObject({
      displayName: "Nina Park",
      phoneNumbers: [],
      emails: ["nina@example.com"],
      detectedAt: "2026-06-01T12:00:00-07:00"
    });
  });

  it("does not create detections for name-only edits", () => {
    const detections = detectNewContactMethods(
      {
        userId: fixtureUser.id,
        capturedAt: "2026-05-15T20:00:00-07:00",
        contacts: [
          {
            stableId: "contact_alex",
            displayName: "Alex",
            phoneNumbers: ["+15550101001"],
            emails: [],
            updatedAt: "2026-05-15T20:00:00-07:00"
          }
        ]
      },
      {
        userId: fixtureUser.id,
        capturedAt: "2026-05-15T21:00:00-07:00",
        contacts: [
          {
            stableId: "contact_alex",
            displayName: "Alex Lee",
            phoneNumbers: ["+15550101001"],
            emails: [],
            updatedAt: "2026-05-15T21:00:00-07:00"
          }
        ]
      }
    );

    expect(detections).toEqual([]);
  });

  it("does not create detections for duplicate contact methods", () => {
    const detections = detectNewContactMethods(
      {
        userId: fixtureUser.id,
        capturedAt: "2026-05-15T20:00:00-07:00",
        contacts: [
          {
            stableId: "contact_alex",
            displayName: "Alex",
            phoneNumbers: ["+1 (555) 010-1001"],
            emails: ["ALEX@EXAMPLE.COM"],
            updatedAt: "2026-05-15T20:00:00-07:00"
          }
        ]
      },
      {
        userId: fixtureUser.id,
        capturedAt: "2026-05-15T21:00:00-07:00",
        contacts: [
          {
            stableId: "contact_alex",
            displayName: "Alex",
            phoneNumbers: ["15550101001", "+1 555 010 1001"],
            emails: ["alex@example.com", "alex@example.com"],
            updatedAt: "2026-05-15T21:00:00-07:00"
          }
        ]
      }
    );

    expect(detections).toEqual([]);
  });

  it("normalizes contact methods for duplicate detection", () => {
    expect(normalizeContactMethod("phone", "+1 (555) 010-1001")).toBe("+15550101001");
    expect(normalizeContactMethod("email", "  MAYA@Example.COM ")).toBe("maya@example.com");
  });
});
