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
});
