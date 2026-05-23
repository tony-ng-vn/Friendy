import { describe, expect, it } from "vitest";
import { buildConversationState, type ConversationState } from "./conversationState";
import { fixtureDetectedContact, fixtureUser } from "./fixtures";
import { createRelationshipRepository } from "./repository";
import { buildRouterInputEnvelope, type MessageInterpreterInput } from "./routerInputEnvelope";
import { createRelationshipTools } from "./tools";
import type { ContactCandidateDetected, InboundAgentMessage, RelationshipMemory } from "./types";

const spaceId = "imessage_space_testing";

describe("router input envelope", () => {
  it("projects the active pending workflow with prompt text and frame id", () => {
    const { candidate, conversationState, input } = promptedCandidateHarness();

    const envelope = buildRouterInputEnvelope(input);

    expect(envelope.userText).toBe("Yes, I met Testing 3 during Friendy testing.");
    expect(envelope.conversationState).toEqual(conversationState);
    expect(envelope.domainStateSummary.activeWorkflow).toEqual({
      kind: "pending_contact_confirmation",
      frameId: `frame_pending_contact_${candidate.id}`,
      candidateId: candidate.id,
      displayName: "Testing 3",
      lastFriendyPrompt: "I noticed you added Testing 3. Where did you meet them?"
    });
  });

  it("redacts raw contact methods and contact identifiers from the JSON envelope", () => {
    const { input } = promptedCandidateHarness();

    const envelopeJson = JSON.stringify(buildRouterInputEnvelope(input));

    expect(envelopeJson).not.toContain("+15550101003");
    expect(envelopeJson).not.toContain("testing3@example.com");
    expect(envelopeJson).not.toContain("contact_testing_3");
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
      interpreterInput("Anyone in my contacts related to Testing 3?", conversationState, tools)
    );

    expect(envelope.domainStateSummary.knownPeopleNamed).toEqual([
      {
        queryName: "Testing 3",
        memoryIds: ["memory_testing_3"],
        candidateIds: [candidate.id]
      }
    ]);
    expect(envelope.domainStateSummary.possibleDuplicates).toEqual([
      {
        displayName: "Testing 3",
        memoryIds: ["memory_testing_3"],
        candidateIds: [candidate.id],
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
    input: interpreterInput("Yes, I met Testing 3 during Friendy testing.", conversationState, tools)
  };
}

function interpreterInput(
  text: string,
  conversationState: ConversationState,
  tools: ReturnType<typeof createRelationshipTools>
): MessageInterpreterInput {
  return {
    message: inboundMessage(text),
    routerContext: {
      userId: fixtureUser.id,
      spaceId,
      conversationState,
      tools
    }
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
