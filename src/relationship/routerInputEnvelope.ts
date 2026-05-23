import type { MessageInterpretation } from "./interpretation";
import type { AgentToolCall, ContactCandidate, InboundAgentMessage, RelationshipMemory } from "./types";

export type RouterRouteCapability = MessageInterpretation["intent"];

export type RouterActiveWorkflow = {
  kind: "pending_contact_confirmation";
  frameId: string;
  candidateId: string;
  displayName: string;
  lastFriendyPrompt: string;
};

export type RouterInputEnvelope = {
  userText: string;
  conversationState: {
    activeWorkflow?: RouterActiveWorkflow;
    recentAgentMessages: string[];
    recentEntityRefs: string[];
    lastListResultIds: string[];
    lastToolErrors: string[];
  };
  domainStateSummary: {
    pendingCandidates: Array<{
      candidateId: string;
      displayName: string;
      status: ContactCandidate["status"];
    }>;
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
  availableTools: AgentToolCall[];
  availableRouteCapabilities: RouterRouteCapability[];
};

export type MessageInterpreterInput = {
  message: InboundAgentMessage;
  routerContext?: RouterInputEnvelope;
};

export function buildRouterInputEnvelope(_input: {
  message: InboundAgentMessage;
  conversationState: {
    activeFrame?: {
      frameId: string;
      candidateId: string;
      displayName: string;
      lastFriendyPrompt: string;
    };
    pendingContactQueue: Array<{
      candidateId: string;
      displayName: string;
      status: ContactCandidate["status"];
    }>;
  };
  memories: RelationshipMemory[];
  availableTools: AgentToolCall[];
  availableRouteCapabilities: RouterRouteCapability[];
}): RouterInputEnvelope {
  throw new Error("buildRouterInputEnvelope not implemented");
}
