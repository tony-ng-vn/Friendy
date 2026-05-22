import { fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent, fixtureUser } from "./fixtures";
import { createRelationshipRepository } from "./repository";
import { createRelationshipTools, normalizeMemorySearchQuery } from "./tools";
import type { RelationshipMemory } from "./types";

describe("relationship tools", () => {
  it("lists and confirms pending candidates through bounded tools", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(fixtureDetectedContact);

    expect(tools.list_pending_candidates(fixtureUser.id)).toHaveLength(1);

    const memory = tools.confirm_candidate(
      fixtureUser.id,
      candidate.id,
      "recruiting agents, played piano",
      fixtureShortEvent.id
    );

    expect(memory.eventTitle).toBe("Photon Residency Dinner");
    expect(tools.list_pending_candidates(fixtureUser.id)).toHaveLength(0);
  });

  it("does not let one user confirm another user's candidate", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(fixtureDetectedContact);

    expect(() =>
      tools.confirm_candidate("user_other", candidate.id, "wrong user confirmation", fixtureShortEvent.id)
    ).toThrow(`Candidate not found for user: ${candidate.id}`);
    expect(repo.listMemories()).toEqual([]);
  });

  it("creates manual memories through confirmed synthetic candidates", () => {
    const repo = createRelationshipRepository({ users: [fixtureUser] });
    const tools = createRelationshipTools(repo);

    const memory = tools.create_manual_memory(
      fixtureUser.id,
      "Amaya",
      "met at Photon Residency, recruiting agents founder",
      "manual contact"
    );

    expect(memory.candidateId).toBeDefined();
    expect(repo.getCandidate(memory.candidateId!)).toMatchObject({
      displayName: "Amaya",
      source: "manual",
      status: "confirmed"
    });
    expect(repo.listMemories(fixtureUser.id)).toEqual([memory]);
  });

  it("returns the existing manual memory when the same interaction is retried", () => {
    const repo = createRelationshipRepository({ users: [fixtureUser] });
    const tools = createRelationshipTools(repo);

    const first = tools.create_manual_memory(
      fixtureUser.id,
      "Amaya",
      "met at Photon Residency, recruiting agents founder",
      "manual contact",
      { idempotencyKey: "manual_imessage:interaction_123" }
    );
    const second = tools.create_manual_memory(
      fixtureUser.id,
      "Amaya",
      "met at Photon Residency, recruiting agents founder",
      "manual contact",
      { idempotencyKey: "manual_imessage:interaction_123" }
    );

    expect(second).toEqual(first);
    expect(repo.listMemories(fixtureUser.id)).toEqual([first]);
    expect(repo.getCandidate(first.candidateId!)).toMatchObject({
      source: "manual_imessage",
      manualIdempotencyKey: "manual_imessage:interaction_123",
      createdFromInteractionId: "interaction_123",
      status: "confirmed"
    });
  });

  it("searches memories by vague context", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(fixtureDetectedContact);
    tools.confirm_candidate(fixtureUser.id, candidate.id, "recruiting agents, played piano", fixtureShortEvent.id);

    const results = tools.search_memories(fixtureUser.id, "who was the piano person from dinner");

    expect(results[0].memory.displayName).toBe("Maya Chen");
    expect(results[0].reason).toContain("piano");
  });

  it("normalizes broad relationship recall queries to useful clues", () => {
    expect(normalizeMemorySearchQuery("Anyone in my contacts related to friendy?")).toBe("friendy");
    expect(normalizeMemorySearchQuery("Who is connected to Friendy?")).toBe("friendy");
    expect(normalizeMemorySearchQuery("People related to Friendy?")).toBe("friendy");
    expect(normalizeMemorySearchQuery("Who was from the Mac sensor debugging thing?")).toBe(
      "mac sensor debugging thing"
    );
    expect(normalizeMemorySearchQuery("friendy friendy")).toBe("friendy");
  });

  it("searches saved memories from broad related-contact wording", () => {
    const tools = createToolsWithMemories([
      memory("Testing 1", "Testing Friendy", "Testing Friendy"),
      memory("Testing 12", "testing Friendy", "Met them during testing Friendy")
    ]);

    const results = tools.search_memories(fixtureUser.id, "Anyone in my contacts related to friendy?");

    expect(results.map((result) => result.memory.displayName)).toEqual(["Testing 1", "Testing 12"]);
  });

  it("uses generated retrieval documents for accepted memory fields outside the old field scorer", () => {
    const tools = createToolsWithMemories([
      {
        ...memory("Maya", "Demo Prep", "met at the builder dinner"),
        dateContext: {
          rawText: "during Mac contact watcher debugging week",
          localDate: "2026-05-22",
          startsAt: "2026-05-22T00:00:00.000Z",
          timezone: "America/Los_Angeles"
        }
      },
      memory("Nina", "Demo Prep", "met at the builder dinner")
    ]);

    const results = tools.search_memories(fixtureUser.id, "debugging week");

    expect(results.map((result) => result.memory.displayName)).toEqual(["Maya"]);
    expect(results[0].reason).toContain("document");
  });

  it("updates a memory through a bounded tool and records a revision", () => {
    const { repo, tools, memory } = seededMemoryHarness("building recruiting agents");

    const updated = tools.update_memory(memory.userId, memory.id, "working on hiring workflows", {
      reason: "user_correction",
      userText: "Actually Maya was working on hiring workflows.",
      now: "2026-05-22T12:00:00.000Z"
    });

    expect(updated.contextNote).toBe("working on hiring workflows");
    expect(tools.search_memories(memory.userId, "hiring workflows")[0].memory.id).toBe(memory.id);
    expect(repo.listMemoryRevisions(memory.id).at(-1)).toMatchObject({
      reason: "user_correction",
      userText: "Actually Maya was working on hiring workflows."
    });
  });

  it("soft deletes a memory through a bounded tool", () => {
    const { repo, tools, memory } = seededMemoryHarness("building recruiting agents");

    const deleted = tools.delete_memory(memory.userId, memory.id, {
      userText: "forget Maya",
      now: "2026-05-22T12:00:00.000Z"
    });

    expect(deleted.deletedAt).toBe("2026-05-22T12:00:00.000Z");
    expect(tools.search_memories(memory.userId, "recruiting agents")).toEqual([]);
    expect(repo.listMemoryRevisions(memory.id).at(-1)).toMatchObject({
      reason: "deleted",
      userText: "forget Maya"
    });
  });

  it("ranks role and project matches above generic shared event matches", () => {
    const tools = createToolsWithMemories([
      memory("Maya", "Photon Residency II", "event: Photon Residency II | I met Maya at Photon Residency II dinner, founder working on recruiting agents | role: founder"),
      memory("Nina Park", "Photon Residency II", "event: Photon Residency II | I also met Nina Park who was the designer building an AI note-taking tool | role: designer")
    ]);

    const results = tools.search_memories(fixtureUser.id, "Find the recruiting agents founder from Photon");

    expect(results.map((result) => result.memory.displayName)).toEqual(["Maya"]);
  });

  it("ranks specific project searches above memories that only share generic making language", () => {
    const tools = createToolsWithMemories([
      memory("Leo", "Photon Residency II", "event: Photon Residency II | I met Leo at Photon Residency II, making devtools for agents | project: devtools for agents"),
      memory("Rina", "Photon Residency II", "event: Photon Residency II | I also met Rina who goes to CMU, class 2027 and making AI infra dashboard | school/company: CMU | class year: 2027 | project: AI infra dashboard")
    ]);

    const results = tools.search_memories(fixtureUser.id, "Who was making devtools?");

    expect(results.map((result) => result.memory.displayName)).toEqual(["Leo"]);
  });

  it("keeps school and event-wide searches working after field-aware ranking", () => {
    const tools = createToolsWithMemories([
      memory("Leo", "Photon Residency II", "event: Photon Residency II | I met Leo at Photon Residency II, making devtools for agents | project: devtools for agents"),
      memory("Rina", "Photon Residency II", "event: Photon Residency II | I also met Rina who goes to CMU, class 2027 and making AI infra dashboard | school/company: CMU | class year: 2027 | project: AI infra dashboard"),
      memory("Nina Park", "Photon Residency II", "event: Photon Residency II | I also met Nina Park who was the designer building an AI note-taking tool | role: designer")
    ]);

    expect(tools.search_memories(fixtureUser.id, "Who goes to CMU?").map((result) => result.memory.displayName)).toEqual([
      "Rina"
    ]);

    expect(
      tools.search_memories(fixtureUser.id, "Who did I meet at Photon Residency II?").map((result) => result.memory.displayName)
    ).toEqual(["Leo", "Rina", "Nina Park"]);
  });
});

function createToolsWithMemories(memories: RelationshipMemory[]) {
  const repo = createRelationshipRepository({
    users: [fixtureUser],
    memories
  });

  return createRelationshipTools(repo);
}

function seededMemoryHarness(contextNote: string) {
  const repo = createRelationshipRepository({
    users: [fixtureUser],
    calendarEvents: [fixtureLongEvent, fixtureShortEvent]
  });
  const tools = createRelationshipTools(repo);
  const candidate = tools.create_contact_candidate(fixtureDetectedContact);
  const memory = tools.confirm_candidate(fixtureUser.id, candidate.id, contextNote, fixtureShortEvent.id);

  return { repo, tools, memory };
}

function memory(displayName: string, eventTitle: string, contextNote: string): RelationshipMemory {
  return {
    id: `memory_${displayName.replace(/\s+/g, "_").toLowerCase()}`,
    userId: fixtureUser.id,
    displayName,
    primaryContactLabel: "manual contact",
    eventTitle,
    contextNote,
    tags: [],
    confidence: 0.8,
    createdAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:00:00.000Z"
  };
}
