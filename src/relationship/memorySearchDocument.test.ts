import { describe, expect, it } from "vitest";
import { buildMemorySearchDocument, scoreMemorySearchDocument } from "./memorySearchDocument";
import type { RelationshipMemory } from "./types";

describe("memory search documents", () => {
  it("builds deterministic searchable text from accepted memory fields", () => {
    const document = buildMemorySearchDocument(memory());

    expect(document).toEqual({
      memoryId: "memory_testing_12",
      userId: "user_friendy",
      text: [
        "Name: Testing 12",
        "Event: testing Friendy",
        "Context: Met them during testing Friendy",
        "Relationship: debugged the Mac contact watcher together",
        "Date: during testing week",
        "Tags: testing, friendy"
      ].join("\n"),
      fields: {
        displayName: "Testing 12",
        eventTitle: "testing Friendy",
        contextNote: "Met them during testing Friendy",
        relationshipContext: "debugged the Mac contact watcher together",
        tags: ["testing", "friendy"],
        dateText: "during testing week"
      },
      updatedAt: "2026-05-22T12:00:00.000Z"
    });
  });

  it("excludes private contact, transport, and sensor identifiers", () => {
    const document = buildMemorySearchDocument(memory());

    expect(document.text).not.toContain("+1 (415) 605-6081");
    expect(document.text).not.toContain("testing@example.com");
    expect(document.text).not.toContain("candidate_testing_12");
    expect(document.text).not.toContain("event_private_1");
    expect(document.text).not.toContain("sensor_evt_private");
  });

  it("scores document lexical evidence without exposing raw private fields", () => {
    const document = buildMemorySearchDocument(memory());
    const candidate = scoreMemorySearchDocument(document, ["mac", "contact", "watcher"]);

    expect(candidate).toEqual({
      memoryId: "memory_testing_12",
      source: "document_lexical",
      score: 9,
      matchedTerms: ["mac", "contact", "watcher"]
    });
  });
});

function memory(): RelationshipMemory {
  return {
    id: "memory_testing_12",
    userId: "user_friendy",
    candidateId: "candidate_testing_12_sensor_evt_private",
    displayName: "Testing 12",
    primaryContactLabel: "+1 (415) 605-6081 testing@example.com",
    eventId: "event_private_1",
    eventTitle: "testing Friendy",
    dateContext: {
      rawText: "during testing week",
      localDate: "2026-05-22",
      startsAt: "2026-05-22T00:00:00.000Z",
      timezone: "America/Los_Angeles"
    },
    contextNote: "Met them during testing Friendy",
    relationshipContext: "debugged the Mac contact watcher together",
    tags: ["testing", "friendy"],
    confidence: 0.8,
    createdAt: "2026-05-22T12:00:00.000Z",
    updatedAt: "2026-05-22T12:00:00.000Z"
  };
}
