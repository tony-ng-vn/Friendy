import { vi } from "vitest";
import { fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent, fixtureUser } from "./fixtures";
import { createRelationshipRepository } from "./repository";
import { createRelationshipTools, normalizeMemorySearchQuery } from "./tools";
import type { ContactCandidateDetected, RelationshipMemory } from "./types";

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
    expect(normalizeMemorySearchQuery("Anyone in my contact that related to Friendy?")).toBe("friendy");
    expect(normalizeMemorySearchQuery("Who is connected to Friendy?")).toBe("friendy");
    expect(normalizeMemorySearchQuery("Do I know anyone associated with Friendy?")).toBe("friendy");
    expect(normalizeMemorySearchQuery("Find people associated with Friendy testing")).toBe("friendy testing");
    expect(normalizeMemorySearchQuery("People related to Friendy?")).toBe("friendy");
    expect(normalizeMemorySearchQuery("Who was from the Mac sensor debugging thing?")).toBe(
      "mac sensor debugging thing"
    );
    expect(normalizeMemorySearchQuery("Who did I save while debugging the Mac contact watcher?")).toBe(
      "debugging mac watcher"
    );
    expect(normalizeMemorySearchQuery("friendy friendy")).toBe("friendy");
  });

  it("searches saved memories from broad related-contact wording", () => {
    const tools = createToolsWithMemories([
      memory("Testing 1", "Testing Friendy", "Testing Friendy"),
      memory("Testing 12", "testing Friendy", "Met them during testing Friendy")
    ]);

    for (const query of [
      "Anyone in my contacts related to friendy?",
      "Anyone in my contact that related to Friendy?",
      "Who in my contacts is related to Friendy?",
      "Who in my contacts is connected to Friendy?",
      "Who do I know connected to Friendy?",
      "Do I know anyone associated with Friendy?",
      "Find contacts related to Friendy.",
      "Show people connected to Friendy testing.",
      "Anyone I met while testing Friendy?",
      "Who did I meet during my time testing Friendy?"
    ]) {
      const results = tools.search_memories(fixtureUser.id, query);

      expect(results.map((result) => result.memory.displayName)).toEqual(["Testing 1", "Testing 12"]);
    }
  });

  it("returns all saved memories for list-all contact recall queries", () => {
    const tools = createToolsWithMemories([
      memory("Testing 2", "testing Friendy", "Met during testing friendy"),
      memory("Maya", "Photon Residency", "building recruiting agents")
    ]);

    for (const query of [
      "Just give me all the people in my contact so far",
      "Do you know anyone in my contact?"
    ]) {
      const results = tools.search_memories(fixtureUser.id, query);

      expect(results.map((result) => result.memory.displayName)).toEqual(["Testing 2", "Maya"]);
      expect(results.every((result) => result.reason.includes("list-all"))).toBe(true);
    }
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

  it("merges repository retrieval candidates with field-aware search results", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      memories: [memory("Maya", "Demo Prep", "met at the builder dinner")]
    });
    const searchMemoryDocuments = vi.fn(() => [
      {
        memoryId: "memory_maya",
        source: "fts" as const,
        score: 9,
        matchedTerms: ["debugg", "week"]
      }
    ]);
    const tools = createRelationshipTools({
      ...repo,
      searchMemoryDocuments
    });

    const results = tools.search_memories(fixtureUser.id, "debugging week");

    expect(searchMemoryDocuments).toHaveBeenCalledWith(fixtureUser.id, "debugging week", ["debugg", "week"]);
    expect(results.map((result) => result.memory.displayName)).toEqual(["Maya"]);
    expect(results[0].reason).toContain("fts");
  });

  it("lists Friendy memory as structured people without using search results", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      memories: [
        memory("Testing 12", "testing Friendy", "Met them during testing Friendy"),
        memory("Sarah Fan", "Photon Residency II", "community lead at Photon Residency II")
      ]
    });
    const searchMemoryDocuments = vi.fn(() => {
      throw new Error("list_people must not call searchMemoryDocuments");
    });
    const tools = createRelationshipTools({
      ...repo,
      searchMemoryDocuments
    });
    const searchMemories = vi.spyOn(tools, "search_memories");

    const result = tools.list_people(fixtureUser.id, {
      source: "friendy_memory",
      limit: 20,
      dedupeByPerson: true
    });

    expect(result.people).toEqual([
      {
        displayName: "Testing 12",
        memories: [{ memoryId: "memory_testing_12", summary: "Met them during testing Friendy" }]
      },
      {
        displayName: "Sarah Fan",
        memories: [{ memoryId: "memory_sarah_fan", summary: "community lead at Photon Residency II" }]
      }
    ]);
    expect(result.duplicateGroups).toEqual([]);
    expect(result.pendingCandidates).toEqual([]);
    expect(searchMemories).not.toHaveBeenCalled();
    expect(searchMemoryDocuments).not.toHaveBeenCalled();
  });

  it("filters listed people by meaningful Friendy terms", () => {
    const tools = createToolsWithMemories([
      memory("Testing 12", "testing Friendy", "Met them during testing Friendy"),
      memory("Testing 3", "testing Friendy", "I met testing 3 during testing Friendy"),
      memory("Sarah Fan", "Photon Residency II", "community lead at Photon Residency II")
    ]);

    const result = tools.list_people(fixtureUser.id, {
      source: "friendy_memory",
      limit: 20,
      dedupeByPerson: true,
      filter: {
        rawText: "List me in bullet of all people I met testing friendy",
        exactTerms: ["testing", "friendy"],
        tags: ["testing", "friendy"]
      }
    });

    expect(result.appliedFilterLabel).toBe("testing friendy");
    expect(result.people.map((person) => person.displayName)).toEqual(["Testing 12", "Testing 3"]);
    expect(result.people.flatMap((person) => person.memories.map((item) => item.memoryId))).toEqual([
      "memory_testing_12",
      "memory_testing_3"
    ]);
  });

  it("limits listed Friendy memory results", () => {
    const tools = createToolsWithMemories([
      memory("Testing 12", "testing Friendy", "Met them during testing Friendy"),
      memory("Testing 3", "testing Friendy", "I met testing 3 during testing Friendy"),
      memory("Sarah Fan", "Photon Residency II", "community lead at Photon Residency II")
    ]);

    const result = tools.list_people(fixtureUser.id, {
      source: "friendy_memory",
      limit: 2,
      dedupeByPerson: true
    });

    expect(result.people.map((person) => person.displayName)).toEqual(["Testing 12", "Testing 3"]);
    expect(result.people).toHaveLength(2);
  });

  it("applies list limit after grouping duplicate memories into people", () => {
    const tools = createToolsWithMemories([
      memory("Testing 1", "testing Friendy", "Testing Friendy"),
      { ...memory("Testing 1", "testing Friendy", "retry during testing Friendy"), id: "memory_testing_1_retry" },
      memory("Testing 2", "testing Friendy", "second person during testing Friendy")
    ]);

    const result = tools.list_people(fixtureUser.id, {
      source: "friendy_memory",
      limit: 2,
      dedupeByPerson: true,
      filter: { exactTerms: ["testing", "friendy"] }
    });

    expect(result.people.map((person) => person.displayName)).toEqual(["Testing 1", "Testing 2"]);
    expect(result.people[0].memories.map((item) => item.memoryId)).toEqual([
      "memory_testing_1",
      "memory_testing_1_retry"
    ]);
    expect(result.duplicateGroups.map((group) => group.duplicateGroupId)).toEqual(["duplicate_testing_1"]);
  });

  it("filters listed people by whole normalized tokens instead of substrings", () => {
    const tools = createToolsWithMemories([
      memory("Art Lee", "Gallery opening", "artist building installations"),
      memory("Maya", "Cartwheel Summit", "startup founder")
    ]);

    const result = tools.list_people(fixtureUser.id, {
      source: "friendy_memory",
      limit: 20,
      dedupeByPerson: true,
      filter: { exactTerms: ["art"] }
    });

    expect(result.people.map((person) => person.displayName)).toEqual(["Art Lee"]);
  });

  it("groups exact duplicate display names without destructive merging", () => {
    const tools = createToolsWithMemories([
      memory("Testing 1", "testing Friendy", "Testing Friendy"),
      { ...memory("Testing 1", "", "im just testing for friendy at the moment"), id: "memory_testing_1_retry" }
    ]);

    const result = tools.list_people(fixtureUser.id, {
      source: "friendy_memory",
      limit: 20,
      dedupeByPerson: true,
      filter: { exactTerms: ["testing", "friendy"] }
    });

    expect(result.people).toHaveLength(1);
    expect(result.people[0]).toMatchObject({
      displayName: "Testing 1",
      duplicateGroupId: "duplicate_testing_1",
      memories: [
        { memoryId: "memory_testing_1", summary: "Testing Friendy" },
        { memoryId: "memory_testing_1_retry", summary: "im just testing for friendy at the moment" }
      ]
    });
    expect(result.duplicateGroups).toEqual([
      {
        duplicateGroupId: "duplicate_testing_1",
        reason: "same_display_name",
        displayNames: ["Testing 1"],
        memoryIds: ["memory_testing_1", "memory_testing_1_retry"],
        pendingCandidateIds: []
      }
    ]);
  });

  it("does not group unrelated from-suffix display names without shared context", () => {
    const tools = createToolsWithMemories([
      memory("Alex from Sales", "Pipeline Review", "account executive"),
      memory("Alex from Support", "Customer Review", "support lead")
    ]);

    const result = tools.list_people(fixtureUser.id, {
      source: "friendy_memory",
      limit: 20,
      dedupeByPerson: true
    });

    expect(result.people.map((person) => person.displayName)).toEqual(["Alex from Sales", "Alex from Support"]);
    expect(result.duplicateGroups).toEqual([]);
  });

  it("links pending candidates to same-name saved people when requested", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      memories: [memory("Testing 3", "testing Friendy", "I met testing 3 during testing Friendy")]
    });
    const tools = createRelationshipTools(repo);
    const pending = tools.create_contact_candidate(candidate("Testing 3", "contact_testing_3_pending"));
    repo.markCandidatePrompted(pending.id, "interaction_prompt_testing_3", {
      spaceId: "imessage_testing",
      promptedAt: "2026-05-20T11:59:00.000Z"
    });

    const result = tools.list_people(fixtureUser.id, {
      source: "friendy_memory",
      limit: 20,
      dedupeByPerson: true,
      includePending: true
    });

    expect(result.pendingCandidates).toEqual([
      {
        candidateId: pending.id,
        displayName: "Testing 3",
        status: "prompted"
      }
    ]);
    expect(result.people[0].pendingCandidateIds).toEqual([pending.id]);
    expect(result.duplicateGroups).toEqual([
      {
        duplicateGroupId: "duplicate_testing_3",
        reason: "pending_matches_saved",
        displayNames: ["Testing 3"],
        memoryIds: ["memory_testing_3"],
        pendingCandidateIds: [pending.id]
      }
    ]);
  });

  it("marks Apple Contacts sources unsupported without pretending to list them", () => {
    const tools = createToolsWithMemories([memory("Testing 12", "testing Friendy", "Met them during testing Friendy")]);

    expect(
      tools.list_people(fixtureUser.id, {
        source: "apple_contacts",
        limit: 20,
        dedupeByPerson: true
      })
    ).toEqual({
      people: [],
      duplicateGroups: [],
      pendingCandidates: [],
      unsupportedSources: ["apple_contacts"]
    });

    expect(
      tools.list_people(fixtureUser.id, {
        source: "both",
        limit: 20,
        dedupeByPerson: true
      })
    ).toMatchObject({
      people: [{ displayName: "Testing 12" }],
      unsupportedSources: ["apple_contacts"]
    });
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

function candidate(displayName: string, contactIdentifier: string): ContactCandidateDetected {
  return {
    ...fixtureDetectedContact,
    displayName,
    contactIdentifier,
    phoneNumbers: ["+15550101903"],
    emails: []
  };
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
