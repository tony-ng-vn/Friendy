import { demoDetectedContact, demoLongEvent, demoShortEvent, demoUser } from "./fixtures";
import { createRelationshipRepository } from "./repository";
import type { CalendarEvent } from "./types";

describe("relationship repository", () => {
  it("creates a pending contact candidate with event matches", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });

    const candidate = repo.createCandidateFromDetectedContact(demoDetectedContact);
    const matches = repo.listEventMatches(candidate.id);

    expect(candidate.status).toBe("pending");
    expect(candidate.displayName).toBe("Maya Chen");
    expect(matches[0].eventTitle).toBe("Photon Residency Dinner");
  });

  it("creates a pending contact candidate during one clear event", () => {
    const clearEvent: CalendarEvent = {
      id: "event_ai_meetup",
      userId: demoUser.id,
      title: "AI Meetup",
      startsAt: "2026-05-15T20:00:00-07:00",
      endsAt: "2026-05-15T23:00:00-07:00",
      timezone: "America/Los_Angeles",
      calendarSource: "simulated",
      eventKind: "short"
    };
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [clearEvent]
    });

    const candidate = repo.createCandidateFromDetectedContact(demoDetectedContact);
    const matches = repo.listEventMatches(candidate.id);

    expect(candidate.status).toBe("pending");
    expect(matches).toEqual([
      expect.objectContaining({
        eventTitle: "AI Meetup",
        rank: 1
      })
    ]);
  });

  it("keeps candidates pending when no calendar event overlaps", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });

    const candidate = repo.createCandidateFromDetectedContact({
      ...demoDetectedContact,
      displayName: "No Event Person",
      detectedAt: "2026-06-01T12:00:00-07:00"
    });

    expect(candidate.status).toBe("pending");
    expect(repo.listEventMatches(candidate.id)).toEqual([]);
    expect(repo.listPendingCandidates(demoUser.id).map((item) => item.displayName)).toEqual(["No Event Person"]);
  });

  it("confirms a candidate into a relationship memory", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });

    const candidate = repo.createCandidateFromDetectedContact(demoDetectedContact);
    const memory = repo.confirmCandidate(candidate.id, "recruiting agents, played piano", demoShortEvent.id);

    expect(repo.getCandidate(candidate.id)?.status).toBe("confirmed");
    expect(memory.displayName).toBe("Maya Chen");
    expect(memory.eventTitle).toBe("Photon Residency Dinner");
    expect(memory.tags).toContain("piano");
  });

  it("stores a corrected event title when confirmation chooses another event", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });
    const candidate = repo.createCandidateFromDetectedContact(demoDetectedContact);

    const memory = repo.confirmCandidate(candidate.id, "recruiting agents, not dinner", undefined, {
      eventTitle: "Photon Residency"
    });

    expect(memory.eventTitle).toBe("Photon Residency");
    expect(memory.eventId).toBeUndefined();
  });

  it("ignores a candidate without creating a memory", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });

    const candidate = repo.createCandidateFromDetectedContact(demoDetectedContact);
    repo.ignoreCandidate(candidate.id);

    expect(repo.getCandidate(candidate.id)?.status).toBe("ignored");
    expect(repo.listMemories()).toHaveLength(0);
  });

  it("stores interpreted agent interaction logs for later backend inspection", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });

    repo.addInteraction({
      id: "interaction_1",
      userId: demoUser.id,
      platform: "imessage",
      spaceId: "space_123",
      inboundText: "Who did I meet at the residency?",
      interpretedIntentJson: {
        intent: "search_memory",
        query: "people met at residency"
      },
      outboundText: "You met Amaya.",
      toolCalls: ["search_memories"],
      modelUsed: "nvidia/nemotron-3-super-120b-a12b:free",
      confidence: 0.88,
      latencyMs: 42,
      error: "",
      createdAt: "2026-05-20T12:30:00.000Z"
    });

    expect(repo.listInteractions(demoUser.id)).toEqual([
      expect.objectContaining({
        inboundText: "Who did I meet at the residency?",
        modelUsed: "nvidia/nemotron-3-super-120b-a12b:free",
        confidence: 0.88,
        latencyMs: 42
      })
    ]);
  });
});
