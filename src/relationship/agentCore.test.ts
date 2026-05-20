import { ambiguousDinnerMemory, demoDetectedContact, demoLongEvent, demoShortEvent, demoUser } from "./fixtures";
import { createRelationshipAgent } from "./agentCore";
import { createRelationshipRepository } from "./repository";
import { createRelationshipTools } from "./tools";

describe("relationship agent core", () => {
  it("confirms a pending candidate from a natural yes reply", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(demoDetectedContact);
    const agent = createRelationshipAgent(tools);

    const result = agent.handleMessage({
      userId: demoUser.id,
      platform: "terminal",
      text: "yes, recruiting agents, played piano",
      receivedAt: "2026-05-20T12:00:00.000Z"
    });

    expect(result.toolCalls).toContain("list_pending_candidates");
    expect(result.toolCalls).toContain("confirm_candidate");
    expect(result.outbound.text).toContain("Saved");
    expect(result.outbound.text).toContain("Maya Chen");
    expect(repo.getCandidate(candidate.id)?.status).toBe("confirmed");
  });

  it("searches saved memories and returns a confident match", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(demoDetectedContact);
    tools.confirm_candidate(demoUser.id, candidate.id, "recruiting agents, played piano", demoShortEvent.id);
    const agent = createRelationshipAgent(tools);

    const result = agent.handleMessage({
      userId: demoUser.id,
      platform: "terminal",
      text: "who was the piano person from dinner",
      receivedAt: "2026-05-20T12:05:00.000Z"
    });

    expect(result.toolCalls).toContain("search_memories");
    expect(result.outbound.text).toContain("Likely Maya Chen");
    expect(result.outbound.text).toContain("played piano");
  });

  it("asks a clarification question when search confidence is close", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent],
      memories: [ambiguousDinnerMemory]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(demoDetectedContact);
    tools.confirm_candidate(demoUser.id, candidate.id, "recruiting agents, dinner table", demoShortEvent.id);
    const agent = createRelationshipAgent(tools);

    const result = agent.handleMessage({
      userId: demoUser.id,
      platform: "terminal",
      text: "who was the person from dinner",
      receivedAt: "2026-05-20T12:10:00.000Z"
    });

    expect(result.outbound.text).toContain("I found two");
    expect(result.outbound.text).toContain("Which dinner");
  });
});
