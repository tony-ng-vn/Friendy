import { fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent, fixtureUser } from "./fixtures";
import { createRelationshipRepository } from "./repository";
import type { CalendarEvent } from "./types";

describe("relationship repository", () => {
  it("creates a pending contact candidate with event matches", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });

    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
    const matches = repo.listEventMatches(candidate.id);

    expect(candidate.status).toBe("pending");
    expect(candidate.displayName).toBe("Maya Chen");
    expect(matches[0].eventTitle).toBe("Photon Residency Dinner");
  });

  it("creates a pending contact candidate during one clear event", () => {
    const clearEvent: CalendarEvent = {
      id: "event_ai_meetup",
      userId: fixtureUser.id,
      title: "AI Meetup",
      startsAt: "2026-05-15T20:00:00-07:00",
      endsAt: "2026-05-15T23:00:00-07:00",
      timezone: "America/Los_Angeles",
      calendarSource: "simulated",
      eventKind: "short"
    };
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [clearEvent]
    });

    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
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
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });

    const candidate = repo.createCandidateFromDetectedContact({
      ...fixtureDetectedContact,
      displayName: "No Event Person",
      detectedAt: "2026-06-01T12:00:00-07:00"
    });

    expect(candidate.status).toBe("pending");
    expect(repo.listEventMatches(candidate.id)).toEqual([]);
    expect(repo.listPendingCandidates(fixtureUser.id).map((item) => item.displayName)).toEqual(["No Event Person"]);
  });

  it("confirms a candidate into a relationship memory", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });

    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
    const memory = repo.confirmCandidate(candidate.id, "recruiting agents, played piano", fixtureShortEvent.id);

    expect(repo.getCandidate(candidate.id)?.status).toBe("confirmed");
    expect(memory.displayName).toBe("Maya Chen");
    expect(memory.eventTitle).toBe("Photon Residency Dinner");
    expect(memory.tags).toContain("piano");
  });

  it("marks a prompted candidate while keeping it reviewable for replies", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });

    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
    const prompted = repo.markCandidatePrompted(candidate.id, "interaction_prompt_1");

    expect(prompted).toMatchObject({
      id: candidate.id,
      status: "prompted",
      promptInteractionId: "interaction_prompt_1"
    });
    expect(repo.listPendingCandidates(fixtureUser.id).map((item) => item.id)).toEqual([candidate.id]);
  });

  it("rejects confirming ignored or already confirmed candidates", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });
    const ignored = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
    const confirmed = repo.createCandidateFromDetectedContact({
      ...fixtureDetectedContact,
      displayName: "Nina Park",
      phoneNumbers: ["+15550101021"],
      detectedAt: "2026-05-15T21:44:00-07:00"
    });

    repo.ignoreCandidate(ignored.id);
    repo.confirmCandidate(confirmed.id, "designer building notes", fixtureShortEvent.id);

    expect(() => repo.confirmCandidate(ignored.id, "should not save", fixtureShortEvent.id)).toThrow(
      "Candidate is not confirmable"
    );
    expect(() => repo.confirmCandidate(confirmed.id, "should not save twice", fixtureShortEvent.id)).toThrow(
      "Candidate is not confirmable"
    );
    expect(repo.listMemories(fixtureUser.id).map((memory) => memory.displayName)).toEqual(["Nina Park"]);
  });

  it("stores a corrected event title when confirmation chooses another event", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });
    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);

    const memory = repo.confirmCandidate(candidate.id, "recruiting agents, not dinner", undefined, {
      eventTitle: "Photon Residency"
    });

    expect(memory.eventTitle).toBe("Photon Residency");
    expect(memory.eventId).toBeUndefined();
  });

  it("ignores a candidate without creating a memory", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });

    const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
    repo.ignoreCandidate(candidate.id);

    expect(repo.getCandidate(candidate.id)?.status).toBe("ignored");
    expect(repo.listMemories()).toHaveLength(0);
  });

  it("stores interpreted agent interaction logs for later backend inspection", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });

    repo.addInteraction({
      id: "interaction_1",
      userId: fixtureUser.id,
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

    expect(repo.listInteractions(fixtureUser.id)).toEqual([
      expect.objectContaining({
        inboundText: "Who did I meet at the residency?",
        modelUsed: "nvidia/nemotron-3-super-120b-a12b:free",
        confidence: 0.88,
        latencyMs: 42
      })
    ]);
  });
});
