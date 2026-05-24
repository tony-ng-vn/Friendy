/**
 * Bounded state envelope passed to the LLM router alongside user text.
 *
 * Summarizes active workflows, pending candidates, name collisions, and tool surface area
 * without sending full repository rows. Enforces size caps and redacts contact identifiers
 * before serialization. Callers: `interpretedAgent`, `openAIInterpreter`.
 */
import type { MessageInterpretation } from "./interpretation";
import type { ConversationState } from "./conversationState";
import type { AppleContact } from "./contacts/macContactsAdapter";
import type { AgentToolCall, ContactCandidate, InboundAgentMessage, RelationshipMemory } from "./types";

export type RouterRouteCapability = MessageInterpretation["intent"];

/** Active pending-contact workflow projected for the interpreter. */
export type RouterActiveWorkflow = {
  kind: "pending_contact_confirmation";
  frameId: string;
  candidateId: string;
  displayName: string;
  lastFriendyPrompt: string;
  promptedAt: string;
};

/** Compact router context: user text, conversation hints, domain summary, and capabilities. */
export type RouterInputEnvelope = {
  userText: string;
  conversationState: {
    activeWorkflow?: RouterActiveWorkflow;
    recentAgentMessages: Array<{
      text: string;
      createdAt?: string;
      relatedCandidateId?: string;
      relatedMemoryIds?: string[];
    }>;
    recentEntityRefs: Array<{
      kind: "candidate" | "memory" | "person" | "event";
      id?: string;
      displayName: string;
    }>;
    lastListResultIds: string[];
    lastToolErrors: Array<{
      tool: string;
      code: string;
      shortMessage: string;
    }>;
  };
  domainStateSummary: {
    pendingCandidates: Array<{
      candidateId: string;
      displayName: string;
      status: "pending" | "prompted";
      isActive: boolean;
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
    linkedAppleContacts: RouterLinkedAppleContact[];
  };
  availableTools: AgentToolCall[];
  availableRouteCapabilities: RouterRouteCapability[];
};

export type RouterLinkedAppleContact = {
  personId: string;
  displayName: string;
  contactIdentifier: string;
  contact: Pick<
    AppleContact,
    | "identifier"
    | "givenName"
    | "familyName"
    | "middleName"
    | "nickname"
    | "organizationName"
    | "departmentName"
    | "jobTitle"
    | "note"
    | "phoneNumbers"
    | "emailAddresses"
    | "postalAddresses"
  >;
};

/** Interpreter input: inbound message plus optional structured router envelope. */
export type MessageInterpreterInput = {
  message: InboundAgentMessage;
  routerContext?: RouterInputEnvelope;
};

/**
 * Builds a capped, redacted router envelope from repository-backed conversation state.
 *
 * Name mentions in user text drive `knownPeopleNamed` / `possibleDuplicates` so the model
 * can disambiguate without loading every memory row.
 */
export function buildRouterInputEnvelope(_input: {
  message: InboundAgentMessage;
  conversationState: ConversationState;
  memories: RelationshipMemory[];
  availableTools: AgentToolCall[];
  availableRouteCapabilities: RouterRouteCapability[];
  linkedAppleContacts?: RouterLinkedAppleContact[];
  recentAgentMessages?: RouterInputEnvelope["conversationState"]["recentAgentMessages"];
  recentEntityRefs?: RouterInputEnvelope["conversationState"]["recentEntityRefs"];
  lastListResultIds?: string[];
  lastToolErrors?: RouterInputEnvelope["conversationState"]["lastToolErrors"];
}): RouterInputEnvelope {
  const envelope: RouterInputEnvelope = {
    userText: normalizeAndTruncate(_input.message.text),
    conversationState: {
      activeWorkflow: buildActiveWorkflow(_input.conversationState),
      recentAgentMessages: buildRecentAgentMessages(_input.recentAgentMessages),
      recentEntityRefs: buildRecentEntityRefs(_input.recentEntityRefs),
      lastListResultIds: boundedIdArray(_input.lastListResultIds, MAX_LAST_LIST_RESULT_IDS),
      lastToolErrors: buildLastToolErrors(_input.lastToolErrors)
    },
    domainStateSummary: {
      pendingCandidates: buildPendingCandidateSummary(_input.conversationState),
      ...buildKnownPeopleSummary(_input.message.text, _input.conversationState, _input.memories),
      linkedAppleContacts: buildLinkedAppleContacts(_input.linkedAppleContacts)
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
const MAX_LINKED_APPLE_CONTACTS = 6;
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
    frameId: activeFrame.frameId,
    candidateId: activeFrame.candidateId,
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
      candidateId: candidate.candidateId,
      displayName: normalizeAndTruncate(candidate.displayName),
      status: candidate.status === "prompted" ? "prompted" : "pending",
      isActive: candidate.candidateId === activeFrame?.candidateId
    };

    if (summary.isActive && activeFrame) {
      summary.lastFriendyPrompt = normalizeAndTruncate(activeFrame.lastFriendyPrompt);
    }

    return summary;
  });
}

function buildKnownPeopleSummary(
  userText: string,
  conversationState: ConversationState,
  memories: RelationshipMemory[]
): Pick<RouterInputEnvelope["domainStateSummary"], "knownPeopleNamed" | "possibleDuplicates"> {
  const matchNames = new Set<string>([normalizeForMatch(userText)]);
  const activeFrameName = conversationState.activeFrame?.displayName;
  if (activeFrameName) {
    matchNames.add(normalizeForMatch(activeFrameName));
  }
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

  for (const candidate of conversationState.pendingContactQueue) {
    addNameRecord(grouped, candidate.displayName, "candidateIds", candidate.candidateId);
  }

  const mentioned = [...grouped.entries()]
    .filter(([normalizedName]) => isMatchedName(matchNames, normalizedName))
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

function buildLinkedAppleContacts(
  contacts: RouterLinkedAppleContact[] | undefined
): RouterInputEnvelope["domainStateSummary"]["linkedAppleContacts"] {
  return (contacts ?? []).slice(0, MAX_LINKED_APPLE_CONTACTS).map((contact) => ({
    personId: truncateId(contact.personId),
    displayName: normalizeAndTruncate(contact.displayName),
    contactIdentifier: truncateId(contact.contactIdentifier),
    contact: {
      identifier: truncateId(contact.contact.identifier),
      givenName: truncateContactText(contact.contact.givenName),
      familyName: truncateContactText(contact.contact.familyName),
      middleName: truncateContactText(contact.contact.middleName),
      nickname: truncateContactText(contact.contact.nickname),
      organizationName: truncateContactText(contact.contact.organizationName),
      departmentName: truncateContactText(contact.contact.departmentName),
      jobTitle: truncateContactText(contact.contact.jobTitle),
      note: truncateContactText(contact.contact.note),
      phoneNumbers: contact.contact.phoneNumbers.slice(0, 6).map((item) => ({
        ...(item.label ? { label: truncateContactText(item.label) } : {}),
        value: truncateContactText(item.value)
      })),
      emailAddresses: contact.contact.emailAddresses.slice(0, 6).map((item) => ({
        ...(item.label ? { label: truncateContactText(item.label) } : {}),
        value: truncateContactText(item.value)
      })),
      postalAddresses: contact.contact.postalAddresses.slice(0, 3).map((item) => ({
        ...(item.label ? { label: truncateContactText(item.label) } : {}),
        ...(item.street ? { street: truncateContactText(item.street) } : {}),
        ...(item.city ? { city: truncateContactText(item.city) } : {}),
        ...(item.state ? { state: truncateContactText(item.state) } : {}),
        ...(item.postalCode ? { postalCode: truncateContactText(item.postalCode) } : {}),
        ...(item.country ? { country: truncateContactText(item.country) } : {})
      }))
    }
  }));
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

function isMatchedName(matchNames: Set<string>, normalizedName: string): boolean {
  for (const matchName of matchNames) {
    if (matchName === normalizedName || ` ${matchName} `.includes(` ${normalizedName} `)) {
      return true;
    }
  }

  return false;
}

function normalizeAndTruncate(value: string, maxLength = MAX_TEXT_LENGTH): string {
  const normalized = redactSensitiveText(value.trim().replace(/\s+/g, " "));
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength).trim();
}

function truncateContactText(value: string | undefined, maxLength = MAX_TEXT_LENGTH): string {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength).trim();
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted_email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted_phone]")
    .replace(/\bcontact[_-][\w-]*\d[\w-]*\b/gi, "[redacted_contact_identifier]")
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

function boundedIdArray(values: string[] | undefined, limit: number): string[] {
  const boundedIds: string[] = [];
  const seen = new Set<string>();

  for (const value of values ?? []) {
    const id = truncateId(value.trim());
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    boundedIds.push(id);
    if (boundedIds.length >= limit) {
      break;
    }
  }

  return boundedIds;
}

function truncateId(value: string): string {
  return value.length <= MAX_TEXT_LENGTH ? value : value.slice(0, MAX_TEXT_LENGTH).trim();
}

function buildRecentAgentMessages(
  messages: RouterInputEnvelope["conversationState"]["recentAgentMessages"] | undefined
): RouterInputEnvelope["conversationState"]["recentAgentMessages"] {
  return (messages ?? []).slice(0, MAX_RECENT_AGENT_MESSAGES).map((message) => ({
    text: normalizeAndTruncate(message.text),
    ...(message.createdAt ? { createdAt: message.createdAt } : {}),
    ...(message.relatedCandidateId ? { relatedCandidateId: message.relatedCandidateId } : {}),
    ...(message.relatedMemoryIds ? { relatedMemoryIds: sortedBoundedIds(message.relatedMemoryIds) } : {})
  }));
}

function buildRecentEntityRefs(
  refs: RouterInputEnvelope["conversationState"]["recentEntityRefs"] | undefined
): RouterInputEnvelope["conversationState"]["recentEntityRefs"] {
  return (refs ?? []).slice(0, MAX_RECENT_ENTITY_REFS).map((ref) => ({
    kind: ref.kind,
    ...(ref.id ? { id: ref.id } : {}),
    displayName: normalizeAndTruncate(ref.displayName)
  }));
}

function buildLastToolErrors(
  errors: RouterInputEnvelope["conversationState"]["lastToolErrors"] | undefined
): RouterInputEnvelope["conversationState"]["lastToolErrors"] {
  return (errors ?? []).slice(0, MAX_LAST_TOOL_ERRORS).map((error) => ({
    tool: normalizeAndTruncate(error.tool),
    code: normalizeAndTruncate(error.code),
    shortMessage: normalizeAndTruncate(error.shortMessage)
  }));
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
