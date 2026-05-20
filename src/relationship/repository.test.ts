import { demoDetectedContact, demoLongEvent, demoShortEvent, demoUser } from "./fixtures";
import { createRelationshipRepository } from "./repository";

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
