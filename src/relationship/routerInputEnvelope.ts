import type { ConversationState } from "./conversationState";
import type { MessageInterpretation } from "./interpretation";
import type { createRelationshipTools } from "./tools";
import type { InboundAgentMessage } from "./types";

export type RouterRouteCapability = MessageInterpretation["intent"];

export type RouterInputEnvelope = {
  userText: string;
  conversationState: ConversationState;
  domainStateSummary: {
    activeWorkflow?: {
      kind: "pending_contact_confirmation";
      frameId: string;
      candidateId: string;
      displayName: string;
      lastFriendyPrompt: string;
    };
    knownPeopleNamed: Array<{
      queryName: string;
      memoryIds: string[];
      candidateIds: string[];
    }>;
    possibleDuplicates: Array<{
      displayName: string;
      memoryIds: string[];
      candidateIds: string[];
      reason: "same_display_name";
    }>;
  };
  availableTools: string[];
  availableRouteCapabilities: RouterRouteCapability[];
};

export type MessageInterpreterInput = {
  message: InboundAgentMessage;
  routerContext?: {
    conversationState?: ConversationState;
    tools?: ReturnType<typeof createRelationshipTools>;
    userId?: string;
    spaceId?: string;
  };
};

export function buildRouterInputEnvelope(_input: MessageInterpreterInput): RouterInputEnvelope {
  throw new Error("buildRouterInputEnvelope not implemented");
}
