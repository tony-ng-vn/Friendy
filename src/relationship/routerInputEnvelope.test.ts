import { describe, expect, it } from "vitest";
import { buildConversationState, type ConversationState } from "./conversationState";
import { fixtureDetectedContact, fixtureUser } from "./fixtures";
import { createRelationshipRepository } from "./repository";
import { buildRouterInputEnvelope, type RouterRouteCapability } from "./routerInputEnvelope";
import { createRelationshipTools } from "./tools";
import type { AgentToolCall, ContactCandidateDetected, InboundAgentMessage, RelationshipMemory } from "./types";

const spaceId = "imessage_space_testing";
const availableTools: AgentToolCall[] = ["confirm_candidate", "ignore_candidate", "list_pending_candidates"];
const availableRouteCapabilities: RouterRouteCapability[] = [
  "answer_pending_contact_prompt",
  "duplicate_audit",
  "delete_memory_request"
];

describe("router input envelope", () => {
  it("projects the active pending workflow with prompt text and frame id", () => {
    const { candidate, input } = promptedCandidateHarness();

    const envelope = buildRouterInputEnvelope(input);
    const safeCandidateId = candidate.id.replace(/_contact[\w-]*/gi, "");

    expect(envelope.userText).toBe("Yes, I met Testing 3 during Friendy testing.");
    expect(envelope.conversationState.activeWorkflow).toEqual({
      kind: "pending_contact_confirmation",
      frameId: `frame_pending_contact_${safeCandidateId}`,
      candidateId: safeCandidateId,
      displayName: "Testing 3",
      lastFriendyPrompt: "I noticed you added Testing 3. Where did you meet them?",
      promptedAt: "2026-05-20T11:59:00.000Z"
    });
    expect(envelope.conversationState.recentAgentMessages).toEqual([]);
    expect(envelope.conversationState.recentEntityRefs).toEqual([]);
    expect(envelope.conversationState.lastListResultIds).toEqual([]);
    expect(envelope.conversationState.lastToolErrors).toEqual([]);
    expect(envelope.domainStateSummary.pendingCandidates).toEqual([
      {
        candidateId: safeCandidateId,
        displayName: "Testing 3",
        status: "prompted",
        isActive: true,
        lastFriendyPrompt: "I noticed you added Testing 3. Where did you meet them?"
      }
    ]);
    expect(envelope.availableTools).toEqual(availableTools);
    expect(envelope.availableRouteCapabilities).toEqual(availableRouteCapabilities);
  });

  it("redacts raw contact methods and contact identifiers from the JSON envelope", () => {
    const { input } = promptedCandidateHarness();

    const envelopeJson = JSON.stringify(buildRouterInputEnvelope(input));

    expect(envelopeJson).not.toContain("+15550101003");
    expect(envelopeJson).not.toContain("testing3@example.com");
    expect(envelopeJson).not.toContain("contact_testing_3");
  });

  it("defaults compact conversation and pending summaries to empty arrays", () => {
    const conversationState = buildConversationState({
      userId: fixtureUser.id,
      spaceId,
      pendingCandidates: []
    });

    const envelope = buildRouterInputEnvelope(routerBuilderInput("What can you do?", conversationState, []));

    expect(envelope.conversationState.activeWorkflow).toBeUndefined();
    expect(envelope.conversationState.recentAgentMessages).toEqual([]);
    expect(envelope.conversationState.recentEntityRefs).toEqual([]);
    expect(envelope.conversationState.lastListResultIds).toEqual([]);
    expect(envelope.conversationState.lastToolErrors).toEqual([]);
    expect(envelope.domainStateSummary.pendingCandidates).toEqual([]);
    expect(envelope.domainStateSummary.knownPeopleNamed).toEqual([]);
    expect(envelope.domainStateSummary.possibleDuplicates).toEqual([]);
    expect(envelope.availableTools).toEqual(availableTools);
    expect(envelope.availableRouteCapabilities).toEqual(availableRouteCapabilities);
  });

  it("summarizes same-name saved people and possible duplicates", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      memories: [memory("Testing 3", "I met Testing 3 during testing Friendy")]
    });
    const tools = createRelationshipTools(repo);
    const candidate = tools.create_contact_candidate(testing3Candidate());
    repo.markCandidatePrompted(candidate.id, "interaction_prompt_testing_3", {
      spaceId,
      promptedAt: "2026-05-20T11:59:00.000Z"
    });
    const conversationState = buildConversationState({
      userId: fixtureUser.id,
      spaceId,
      pendingCandidates: repo.listPendingCandidates(fixtureUser.id)
    });

    const envelope = buildRouterInputEnvelope(
      routerBuilderInput("Anyone in my contacts related to Testing 3?", conversationState, repo.listMemories(fixtureUser.id))
    );
    const safeCandidateId = candidate.id.replace(/_contact[\w-]*/gi, "");

    expect(envelope.domainStateSummary.knownPeopleNamed).toEqual([
      {
        queryName: "Testing 3",
        memoryIds: ["memory_testing_3"],
        candidateIds: [safeCandidateId]
      }
    ]);
    expect(envelope.domainStateSummary.possibleDuplicates).toEqual([
      {
        displayName: "Testing 3",
        memoryIds: ["memory_testing_3"],
        candidateIds: [safeCandidateId],
        reason: "same_display_name"
      }
    ]);
  });
});

function promptedCandidateHarness() {
  const repo = createRelationshipRepository({ users: [fixtureUser] });
  const tools = createRelationshipTools(repo);
  const candidate = tools.create_contact_candidate(testing3Candidate());
  repo.markCandidatePrompted(candidate.id, "interaction_prompt_testing_3", {
    spaceId,
    promptedAt: "2026-05-20T11:59:00.000Z"
  });
  const conversationState = buildConversationState({
    userId: fixtureUser.id,
    spaceId,
    pendingCandidates: repo.listPendingCandidates(fixtureUser.id)
  });

  return {
    candidate,
    conversationState,
    input: routerBuilderInput(
      "Yes, I met Testing 3 during Friendy testing.",
      conversationState,
      repo.listMemories(fixtureUser.id)
    )
  };
}

function routerBuilderInput(
  text: string,
  conversationState: ConversationState,
  memories: RelationshipMemory[]
): Parameters<typeof buildRouterInputEnvelope>[0] {
  return {
    message: inboundMessage(text),
    conversationState,
    memories,
    availableTools,
    availableRouteCapabilities
  };
}

function inboundMessage(text: string): InboundAgentMessage {
  return {
    interactionId: "interaction_testing_3_reply",
    userId: fixtureUser.id,
    platform: "imessage",
    spaceId,
    text,
    receivedAt: "2026-05-20T12:00:00.000Z"
  };
}

function testing3Candidate(): ContactCandidateDetected {
  return {
    ...fixtureDetectedContact,
    displayName: "Testing 3",
    phoneNumbers: ["+15550101003"],
    emails: ["testing3@example.com"],
    contactIdentifier: "contact_testing_3"
  };
}

function memory(displayName: string, contextNote: string): RelationshipMemory {
  return {
    id: "memory_testing_3",
    userId: fixtureUser.id,
    displayName,
    primaryContactLabel: "manual contact",
    contextNote,
    tags: [],
    confidence: 0.8,
    createdAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:00:00.000Z"
  };
}
