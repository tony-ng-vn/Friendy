import { ambiguousDinnerMemory, fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent, fixtureUser } from "./fixtures";
import { buildCandidateReviewPrompt, createRelationshipAgent } from "./agentCore";
import { createRelationshipRepository } from "./repository";
import { createRelationshipTools } from "./tools";

describe("relationship agent core", () => {
  it("confirms a pending candidate from a natural yes reply", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(fixtureDetectedContact);
    const agent = createRelationshipAgent(tools);

    const result = agent.handleMessage({
      userId: fixtureUser.id,
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

  it("saves a corrected event when the confirmation names a different overlapping event", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(fixtureDetectedContact);
    const agent = createRelationshipAgent(tools);

    const result = agent.handleMessage({
      userId: fixtureUser.id,
      platform: "terminal",
      text: "yes, actually at Photon Residency, recruiting agents",
      receivedAt: "2026-05-20T12:00:00.000Z"
    });

    const [memory] = repo.listMemories(fixtureUser.id);
    expect(result.toolCalls).toContain("confirm_candidate");
    expect(memory.eventTitle).toBe("Photon Residency");
    expect(memory.eventId).toBe(fixtureLongEvent.id);
    expect(memory.contextNote).toContain("recruiting agents");
    expect(repo.getCandidate(candidate.id)?.status).toBe("confirmed");
  });

  it("saves a no-event candidate with event context supplied during confirmation", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });
    const tools = createRelationshipTools(repo);
    tools.create_contact_candidate({
      ...fixtureDetectedContact,
      displayName: "Nina Park",
      detectedAt: "2026-06-01T12:00:00-07:00"
    });
    const agent = createRelationshipAgent(tools);

    const result = agent.handleMessage({
      userId: fixtureUser.id,
      platform: "terminal",
      text: "yes, met at SF AI Meetup, building robots",
      receivedAt: "2026-06-01T12:05:00.000Z"
    });

    const [memory] = repo.listMemories(fixtureUser.id);
    expect(result.toolCalls).toContain("confirm_candidate");
    expect(memory.displayName).toBe("Nina Park");
    expect(memory.eventTitle).toBe("SF AI Meetup");
    expect(memory.contextNote).toContain("building robots");
  });

  it("ignores a pending candidate without saving memory", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(fixtureDetectedContact);
    const agent = createRelationshipAgent(tools);

    const result = agent.handleMessage({
      userId: fixtureUser.id,
      platform: "terminal",
      text: "ignore",
      receivedAt: "2026-05-20T12:00:00.000Z"
    });

    expect(result.toolCalls).toEqual(["list_pending_candidates", "ignore_candidate"]);
    expect(result.outbound.text).toContain("Ignored Maya Chen");
    expect(repo.getCandidate(candidate.id)?.status).toBe("ignored");
    expect(repo.listMemories(fixtureUser.id)).toEqual([]);
  });

  it("retrieves a verified contact after confirmation by event and context search", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });
    const tools = createRelationshipTools(repo);
    tools.create_contact_candidate(fixtureDetectedContact);
    const agent = createRelationshipAgent(tools);

    agent.handleMessage({
      userId: fixtureUser.id,
      platform: "terminal",
      text: "yes, recruiting agents, played piano",
      receivedAt: "2026-05-20T12:00:00.000Z"
    });

    const searchResult = agent.handleMessage({
      userId: fixtureUser.id,
      platform: "terminal",
      text: "who was the recruiting agents person from Photon dinner?",
      receivedAt: "2026-05-20T12:05:00.000Z"
    });

    expect(searchResult.toolCalls).toContain("search_memories");
    expect(searchResult.outbound.text).toContain("I think that was Maya Chen");
    expect(searchResult.outbound.text).toContain("recruiting agents");
  });

  it("searches saved memories and returns a conversational confident match", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(fixtureDetectedContact);
    tools.confirm_candidate(fixtureUser.id, candidate.id, "recruiting agents, played piano", fixtureShortEvent.id);
    const agent = createRelationshipAgent(tools);

    const result = agent.handleMessage({
      userId: fixtureUser.id,
      platform: "terminal",
      text: "who was the piano person from dinner",
      receivedAt: "2026-05-20T12:05:00.000Z"
    });

    expect(result.toolCalls).toContain("search_memories");
    expect(result.outbound.text).toContain("I think that was Maya Chen");
    expect(result.outbound.text).toContain("played piano");
    expect(result.outbound.text).not.toContain("matched:");
    expect(result.outbound.text).not.toContain("manual contact");
  });

  it("saves a natural first-person meeting sentence as searchable memory", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const agent = createRelationshipAgent(tools);

    const saveResult = agent.handleMessage({
      userId: fixtureUser.id,
      platform: "terminal",
      text: "I met Amaya at Photon Residency II, and me and him sleep on the same bed cuz we ran out of bed :(",
      receivedAt: "2026-05-20T12:03:00.000Z"
    });

    expect(saveResult.outbound.text).toContain("Saved");
    expect(repo.listMemories(fixtureUser.id)[0]).toMatchObject({
      displayName: "Amaya"
    });
    expect(repo.listMemories(fixtureUser.id)[0].contextNote).toContain("Photon Residency II");

    const searchResult = agent.handleMessage({
      userId: fixtureUser.id,
      platform: "terminal",
      text: "who slept in the same bed at Photon?",
      receivedAt: "2026-05-20T12:04:00.000Z"
    });

    expect(searchResult.outbound.text).toContain("I think that was Amaya");
    expect(searchResult.outbound.text).not.toContain("matched:");
    expect(searchResult.outbound.text).not.toContain("manual contact");
  });

  it("asks a clarification question when search confidence is close", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent],
      memories: [ambiguousDinnerMemory]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(fixtureDetectedContact);
    tools.confirm_candidate(fixtureUser.id, candidate.id, "recruiting agents, dinner table", fixtureShortEvent.id);
    const agent = createRelationshipAgent(tools);

    const result = agent.handleMessage({
      userId: fixtureUser.id,
      platform: "terminal",
      text: "who was the person from dinner",
      receivedAt: "2026-05-20T12:10:00.000Z"
    });

    expect(result.outbound.text).toContain("I found 2");
    expect(result.outbound.text).toContain("Which person");
    expect(result.outbound.text).not.toContain("matched:");
    expect(result.outbound.text).not.toContain("manual contact");
  });
});

describe("candidate review prompt", () => {
  it("builds the proactive candidate review prompt for the top event match", () => {
    const prompt = buildCandidateReviewPrompt("Maya Chen", "Photon Residency Dinner");

    expect(prompt).toBe("I noticed you added Maya Chen during Photon Residency Dinner. Did you meet Maya Chen there?");
  });

  it("asks where they met when no event was matched", () => {
    const prompt = buildCandidateReviewPrompt("Nina Park");

    expect(prompt).toBe("I noticed you added Nina Park. Where did you meet them?");
  });
});
