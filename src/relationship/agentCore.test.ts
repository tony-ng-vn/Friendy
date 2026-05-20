import { ambiguousDinnerMemory, demoDetectedContact, demoLongEvent, demoShortEvent, demoUser } from "./fixtures";
import { buildCandidateReviewPrompt, createRelationshipAgent } from "./agentCore";
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

  it("saves a natural first-person meeting sentence as searchable memory", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const agent = createRelationshipAgent(tools);

    const saveResult = agent.handleMessage({
      userId: demoUser.id,
      platform: "terminal",
      text: "I met Amaya at Photon Residency II, and me and him sleep on the same bed cuz we ran out of bed :(",
      receivedAt: "2026-05-20T12:03:00.000Z"
    });

    expect(saveResult.outbound.text).toContain("Saved");
    expect(repo.listMemories(demoUser.id)[0]).toMatchObject({
      displayName: "Amaya"
    });
    expect(repo.listMemories(demoUser.id)[0].contextNote).toContain("Photon Residency II");

    const searchResult = agent.handleMessage({
      userId: demoUser.id,
      platform: "terminal",
      text: "who slept in the same bed at Photon?",
      receivedAt: "2026-05-20T12:04:00.000Z"
    });

    expect(searchResult.outbound.text).toContain("Likely Amaya");
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

describe("candidate review prompt", () => {
  it("builds the proactive candidate review prompt for the top event match", () => {
    const prompt = buildCandidateReviewPrompt("Maya Chen", "Photon Residency Dinner");

    expect(prompt).toBe("I noticed you added Maya Chen during Photon Residency Dinner. Did you meet Maya Chen there?");
  });
});
