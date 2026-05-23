import type { MessageInterpretation } from "./interpretation";
import type { ConversationState } from "./conversationState";
import type { AgentToolCall, ContactCandidate, InboundAgentMessage, RelationshipMemory } from "./types";

export type RouterRouteCapability = MessageInterpretation["intent"];

export type RouterActiveWorkflow = {
  kind: "pending_contact_confirmation";
  frameId: string;
  candidateId: string;
  displayName: string;
  lastFriendyPrompt: string;
  promptedAt: string;
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
      isActive?: boolean;
      lastFriendyPrompt?: string;
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
  conversationState: ConversationState;
  memories: RelationshipMemory[];
  availableTools: AgentToolCall[];
  availableRouteCapabilities: RouterRouteCapability[];
  recentAgentMessages?: RouterInputEnvelope["conversationState"]["recentAgentMessages"];
  recentEntityRefs?: RouterInputEnvelope["conversationState"]["recentEntityRefs"];
  lastListResultIds?: string[];
  lastToolErrors?: RouterInputEnvelope["conversationState"]["lastToolErrors"];
}): RouterInputEnvelope {
  const envelope: RouterInputEnvelope = {
    userText: normalizeAndTruncate(_input.message.text),
    conversationState: {
      activeWorkflow: buildActiveWorkflow(_input.conversationState),
      recentAgentMessages: boundedTextArray(_input.recentAgentMessages, MAX_RECENT_AGENT_MESSAGES),
      recentEntityRefs: boundedTextArray(_input.recentEntityRefs, MAX_RECENT_ENTITY_REFS),
      lastListResultIds: boundedTextArray(_input.lastListResultIds, MAX_LAST_LIST_RESULT_IDS),
      lastToolErrors: boundedTextArray(_input.lastToolErrors, MAX_LAST_TOOL_ERRORS)
    },
    domainStateSummary: {
      pendingCandidates: buildPendingCandidateSummary(_input.conversationState),
      ...buildKnownPeopleSummary(_input.message.text, _input.memories, _input.conversationState.pendingContactQueue)
    },
    availableTools: sortTools(_input.availableTools),
    availableRouteCapabilities: sortRouteCapabilities(_input.availableRouteCapabilities)
  };

  return enforceEnvelopeCap(envelope);
}

const MAX_TEXT_LENGTH = 240;
const MAX_PENDING_CANDIDATES = 12;
const MAX_RECENT_AGENT_MESSAGES = 6;
const MAX_RECENT_ENTITY_REFS = 12;
const MAX_LAST_LIST_RESULT_IDS = 20;
const MAX_LAST_TOOL_ERRORS = 6;
const MAX_IDS_PER_NAME = 12;
const MAX_ENVELOPE_BYTES = 8 * 1024;

const ROUTE_CAPABILITY_ORDER = [
  "capture_memory",
  "answer_pending_contact_prompt",
  "capture_pending_contact_context",
  "continue_recent_saved_contact",
  "explain_pending_workflow",
  "explain_agent_state",
  "conversation_repair",
  "duplicate_audit",
  "delete_memory_request",
  "list_people",
  "search_memory",
  "manual_memory_create",
  "update_memory",
  "delete_memory",
  "draft_message",
  "request_contact_create",
  "request_contact_edit",
  "request_contact_delete",
  "ignore_candidate",
  "clarify",
  "reject",
  "unknown"
] satisfies RouterRouteCapability[];

const routeCapabilityRank = new Map<RouterRouteCapability, number>(
  ROUTE_CAPABILITY_ORDER.map((capability, index) => [capability, index])
);

function buildActiveWorkflow(conversationState: ConversationState): RouterActiveWorkflow | undefined {
  const { activeFrame } = conversationState;
  if (!activeFrame) {
    return undefined;
  }

  return {
    kind: "pending_contact_confirmation",
    frameId: `frame_pending_contact_${sanitizeEnvelopeId(activeFrame.candidateId)}`,
    candidateId: sanitizeEnvelopeId(activeFrame.candidateId),
    displayName: normalizeAndTruncate(activeFrame.displayName),
    lastFriendyPrompt: normalizeAndTruncate(activeFrame.lastFriendyPrompt),
    promptedAt: activeFrame.openedAt
  };
}

function buildPendingCandidateSummary(
  conversationState: ConversationState
): RouterInputEnvelope["domainStateSummary"]["pendingCandidates"] {
  const activeFrame = conversationState.activeFrame;

  return conversationState.pendingContactQueue.slice(0, MAX_PENDING_CANDIDATES).map((candidate) => {
    const summary: RouterInputEnvelope["domainStateSummary"]["pendingCandidates"][number] = {
      candidateId: sanitizeEnvelopeId(candidate.candidateId),
      displayName: normalizeAndTruncate(candidate.displayName),
      status: candidate.status
    };

    if (candidate.candidateId === activeFrame?.candidateId) {
      summary.isActive = true;
      summary.lastFriendyPrompt = normalizeAndTruncate(activeFrame.lastFriendyPrompt);
    }

    return summary;
  });
}

function buildKnownPeopleSummary(
  userText: string,
  memories: RelationshipMemory[],
  pendingCandidates: ConversationState["pendingContactQueue"]
): Pick<RouterInputEnvelope["domainStateSummary"], "knownPeopleNamed" | "possibleDuplicates"> {
  const mentionedText = normalizeForMatch(userText);
  const grouped = new Map<
    string,
    {
      displayName: string;
      memoryIds: string[];
      candidateIds: string[];
    }
  >();

  for (const memory of memories) {
    addNameRecord(grouped, memory.displayName, "memoryIds", memory.id);
  }

  for (const candidate of pendingCandidates) {
    addNameRecord(grouped, candidate.displayName, "candidateIds", sanitizeEnvelopeId(candidate.candidateId));
  }

  const mentioned = [...grouped.entries()]
    .filter(([normalizedName]) => containsMentionedName(mentionedText, normalizedName))
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName));

  const knownPeopleNamed = mentioned.map(([, record]) => ({
    queryName: normalizeAndTruncate(record.displayName),
    memoryIds: sortedBoundedIds(record.memoryIds),
    candidateIds: sortedBoundedIds(record.candidateIds)
  }));

  const possibleDuplicates = mentioned
    .filter(([, record]) => record.memoryIds.length > 0 && record.candidateIds.length > 0)
    .map(([, record]) => ({
      displayName: normalizeAndTruncate(record.displayName),
      memoryIds: sortedBoundedIds(record.memoryIds),
      candidateIds: sortedBoundedIds(record.candidateIds),
      reason: "same_display_name" as const
    }));

  return { knownPeopleNamed, possibleDuplicates };
}

function addNameRecord(
  grouped: Map<string, { displayName: string; memoryIds: string[]; candidateIds: string[] }>,
  displayName: string,
  idType: "memoryIds" | "candidateIds",
  id: string
): void {
  const normalizedName = normalizeForMatch(displayName);
  if (!normalizedName) {
    return;
  }

  const existing = grouped.get(normalizedName);
  if (existing) {
    existing[idType].push(id);
    return;
  }

  grouped.set(normalizedName, {
    displayName,
    memoryIds: idType === "memoryIds" ? [id] : [],
    candidateIds: idType === "candidateIds" ? [id] : []
  });
}

function containsMentionedName(mentionedText: string, normalizedName: string): boolean {
  return ` ${mentionedText} `.includes(` ${normalizedName} `);
}

function normalizeAndTruncate(value: string, maxLength = MAX_TEXT_LENGTH): string {
  const normalized = redactSensitiveText(value.trim().replace(/\s+/g, " "));
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength).trim();
}

function sanitizeEnvelopeId(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ").replace(/_contact_[\w-]*$/gi, "");
  return normalized.length <= MAX_TEXT_LENGTH ? normalized : normalized.slice(0, MAX_TEXT_LENGTH).trim();
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted_email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted_phone]")
    .replace(/\bcontact[_-][\w-]+\b/gi, "[redacted_contact_identifier]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[redacted_hash]");
}

function normalizeForMatch(value: string): string {
  return normalizeAndTruncate(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function boundedTextArray(values: string[] | undefined, limit: number): string[] {
  return (values ?? []).slice(0, limit).map((value) => normalizeAndTruncate(value));
}

function sortedBoundedIds(ids: string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right)).slice(0, MAX_IDS_PER_NAME);
}

function sortTools(tools: AgentToolCall[]): AgentToolCall[] {
  return [...tools].sort((left, right) => left.localeCompare(right));
}

function sortRouteCapabilities(capabilities: RouterRouteCapability[]): RouterRouteCapability[] {
  return [...capabilities].sort((left, right) => {
    const leftRank = routeCapabilityRank.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = routeCapabilityRank.get(right) ?? Number.MAX_SAFE_INTEGER;

    return leftRank - rightRank || left.localeCompare(right);
  });
}

function enforceEnvelopeCap(envelope: RouterInputEnvelope): RouterInputEnvelope {
  const compacted = structuredClone(envelope);

  for (const key of ["recentAgentMessages", "recentEntityRefs", "lastListResultIds", "lastToolErrors"] as const) {
    if (JSON.stringify(compacted).length <= MAX_ENVELOPE_BYTES) {
      break;
    }

    compacted.conversationState[key] = [];
  }

  return compacted;
}
