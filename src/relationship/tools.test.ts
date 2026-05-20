import { demoDetectedContact, demoLongEvent, demoShortEvent, demoUser } from "./fixtures";
import { createRelationshipRepository } from "./repository";
import { createRelationshipTools } from "./tools";

describe("relationship tools", () => {
  it("lists and confirms pending candidates through bounded tools", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(demoDetectedContact);

    expect(tools.list_pending_candidates(demoUser.id)).toHaveLength(1);

    const memory = tools.confirm_candidate(
      demoUser.id,
      candidate.id,
      "recruiting agents, played piano",
      demoShortEvent.id
    );

    expect(memory.eventTitle).toBe("Photon Residency Dinner");
    expect(tools.list_pending_candidates(demoUser.id)).toHaveLength(0);
  });

  it("searches memories by vague context", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(demoDetectedContact);
    tools.confirm_candidate(demoUser.id, candidate.id, "recruiting agents, played piano", demoShortEvent.id);

    const results = tools.search_memories(demoUser.id, "who was the piano person from dinner");

    expect(results[0].memory.displayName).toBe("Maya Chen");
    expect(results[0].reason).toContain("piano");
  });
});
