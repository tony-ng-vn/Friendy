/**
 * Deterministic user-facing copy for relationship-agent replies.
 *
 * Callers: `agentCore.ts`, `interpretedAgent.ts`, transports after tool execution.
 *
 * Format-only boundary: inputs are already-selected memories, matches, or structured intake
 * outcomes. This module must never choose matches, write memories, or expose raw search scores,
 * `reason` strings, or tool diagnostics — those stay in logs and tests.
 */
import type { ListPeopleResult, MemorySearchResult } from "./tools";
import type { RelationshipMemory } from "./types";

type SaveConfirmationInput = {
  memories: RelationshipMemory[];
};

type SearchReplyInput = {
  matches: MemorySearchResult[];
  ambiguous?: boolean;
};

type ListPeopleReplyInput = {
  result: ListPeopleResult;
  preferBullets?: boolean;
};

type IgnoreCandidateReplyInput = {
  candidateName?: string;
};

type MemoryMutationReplyInput = {
  memory: RelationshipMemory;
};

type DeleteAllMemoryConfirmReplyInput = {
  count: number;
};

type DeleteAllMemoryReplyInput = {
  count: number;
};

type CandidateAmbiguityReplyInput = {
  candidates: Array<{ displayName: string }>;
};

/** Setup control verbs surfaced as user-facing start/pause/resume copy. */
export type OnboardingControlReplyKind = "started" | "paused" | "resumed";

/**
 * Formats saved memories for the user without exposing storage details.
 *
 * This boundary is intentionally deterministic: retrieval and memory writes happen before this
 * module, so wording cannot invent contacts, change rankings, or hide tool behavior.
 */
export function composeSaveConfirmation({ memories }: SaveConfirmationInput): string {
  if (memories.length === 0) {
    return "I need a name or context before I can save that.";
  }

  if (memories.length === 1) {
    const memory = memories[0];
    const event = getEventTitle(memory);
    const context = summarizeMemoryContext(memory);
    const savedContext = context ? phraseSavedContext(memory.displayName, context, event) : "";

    if (event && savedContext) {
      return `Got it, saved ${memory.displayName} from ${event}. I'll remember ${savedContext}.`;
    }

    if (event) {
      return `Got it, saved ${memory.displayName} from ${event}.`;
    }

    if (savedContext) {
      return `Got it, saved ${memory.displayName}. I'll remember ${savedContext}.`;
    }

    return `Got it, saved ${memory.displayName}.`;
  }

  return `Got it, saved ${memories.length} people: ${memories.map((memory) => memory.displayName).join(", ")}.`;
}

/** Follow-up question after the first memory for a person is saved. */
export function composeAdditionalMemoryFollowUpQuestion(displayName: string): string {
  return `Anything else you want to remember about ${displayName}?`;
}

/** Appends the optional additional-memory prompt after a save confirmation. */
export function composeSaveConfirmationWithAdditionalMemoryPrompt({
  memories,
  displayName
}: SaveConfirmationInput & { displayName: string }): string {
  const confirmation = composeSaveConfirmation({ memories });
  const followUp = composeAdditionalMemoryFollowUpQuestion(displayName);
  return `${confirmation}\n\n${followUp}`;
}

/** Closes the additional-memory loop when the user declines. */
export function composeAdditionalMemoryCaptureComplete(displayName: string): string {
  return `Sounds good — I'll keep what you shared about ${displayName}.`;
}

/** Asks for concrete detail when the user says yes without content. */
export function composeAdditionalMemoryPromptForDetail(displayName: string): string {
  return `What else should I remember about ${displayName}?`;
}

/**
 * Formats deterministic search results as a conversational answer.
 *
 * The input matches already came from the search tool. This function must never use raw scoring
 * reasons because those are implementation diagnostics, not user-facing memory.
 */
export function composeSearchReply({ matches, ambiguous = false }: SearchReplyInput): string {
  if (matches.length === 0) {
    return composeNoMatchReply();
  }

  if (matches.length === 1) {
    return composeSingleSearchMatch(matches[0].memory);
  }

  if (ambiguous) {
    const summaries = matches.map((match) => summarizeMatch(match.memory)).join("; ");
    const prefix = `I found ${matches.length} possible matches: ${summaries}.`;
    return `${prefix} Which person do you mean?`;
  }

  return [`I found ${matches.length} people:`, "", ...matches.map((match) => formatSearchListMatch(match.memory))].join("\n");
}

/** Formats everything saved about one person after a targeted lookup request. */
export function composePersonLookupReply(person: ListPeopleResult["people"][number]): string {
  const contexts = person.memories.map((memory) => memory.summary.trim()).filter(Boolean);
  const context = contexts.length > 0 ? contexts.join("; ") : "no context saved yet";
  return `Here's what I remember about ${person.displayName}:\n\n- ${person.displayName} - ${context}`;
}

/** Formats structured people inventory results without using search diagnostics. */
export function composeListPeopleReply({ result, preferBullets = false }: ListPeopleReplyInput): string {
  const hasAppleContactsUnsupported = result.unsupportedSources?.includes("apple_contacts") ?? false;
  const hasNoStructuredResults =
    result.people.length === 0 && result.pendingCandidates.length === 0 && result.duplicateGroups.length === 0;

  if (hasAppleContactsUnsupported && hasNoStructuredResults) {
    return "I can list people from Friendy memory right now. Apple Contacts listing is not connected yet.";
  }

  const sections: string[] = [];

  if (result.people.length === 0) {
    sections.push(
      result.appliedFilterLabel
        ? "I don't have any matching people in Friendy memory yet."
        : "I don't have any saved people in Friendy memory yet."
    );
  } else {
    const heading = result.appliedFilterLabel
      ? `I remember these people from ${result.appliedFilterLabel}:`
      : `I remember ${result.people.length === 1 ? "this person" : "these people"} in Friendy memory:`;
    const peopleLines = result.people.map((person, index) => formatListedPerson(person, index));
    sections.push(heading, "", ...peopleLines);
  }

  const duplicateLines = result.duplicateGroups.map((group) => formatDuplicateGroup(group)).filter(Boolean);
  if (duplicateLines.length > 0) {
    sections.push("", "I also see possible duplicates:", "", ...duplicateLines);
  }

  const pendingLines = result.pendingCandidates.map((candidate) => formatPendingCandidate(candidate));
  if (pendingLines.length > 0) {
    sections.push("", "I also see pending contacts not saved as memories yet:", "", ...pendingLines);
  }

  if (hasAppleContactsUnsupported) {
    sections.push("", "Apple Contacts listing is not connected yet, so this is from Friendy memory only.");
  }

  return sections.join("\n");
}

function formatListedPerson(person: ListPeopleResult["people"][number], index: number): string {
  const contexts = person.memories.map((memory) => memory.summary.trim()).filter(Boolean);
  const context = contexts.length > 0 ? contexts.join("; ") : "no context saved";
  return `${index + 1}. ${person.displayName} - ${context}`;
}

function formatDuplicateGroup(group: ListPeopleResult["duplicateGroups"][number]): string {
  const prefix = "- ";
  if (group.displayNames.length === 1) {
    const count = group.memoryIds.length + group.pendingCandidateIds.length;
    return `${prefix}${group.displayNames[0]} appears ${count === 2 ? "twice" : `${count} times`}`;
  }

  return `${prefix}${group.displayNames.join(" / ")} may be the same person`;
}

function formatPendingCandidate(candidate: ListPeopleResult["pendingCandidates"][number]): string {
  return `- ${candidate.displayName}`;
}

function formatSearchListMatch(memory: RelationshipMemory): string {
  const context = getEventTitle(memory) || summarizeMemoryContext(memory) || "no context saved";
  return `- ${memory.displayName} - ${context}`;
}

/** Formats a no-match reply that asks for one more useful clue. */
export function composeNoMatchReply(): string {
  return "I don't have enough to confidently find them yet. Give me a name, event, date, project, school, or another clue.";
}

/** Formats the safe fallback when a confirmation could apply to multiple pending candidates. */
export function composeCandidateAmbiguityReply({ candidates }: CandidateAmbiguityReplyInput): string {
  const names = candidates.map((candidate) => candidate.displayName).join(", ");
  return `I found multiple pending contacts: ${names}. Which one do you mean?`;
}

/** Formats the no-pending-candidate reply for confirmation attempts. */
export function composeNoPendingCandidateReply(): string {
  return "I do not see a pending contact to confirm.";
}

/** Answers whether Friendy has unsaved pending contacts and lists their display names. */
export function composePendingContactsInventoryReply({
  candidates
}: {
  candidates: Array<{ displayName: string }>;
}): string {
  if (candidates.length === 0) {
    return composeNoPendingCandidateReply();
  }

  if (candidates.length === 1) {
    const name = candidates[0].displayName;
    if (name === "Unnamed Contact") {
      return "Yes — I have 1 unsaved contact waiting. Contacts hasn't given me the name yet.";
    }

    return `Yes — I have 1 unsaved contact waiting: ${name}.`;
  }

  const names = candidates.map((candidate) => candidate.displayName).join(", ");
  return `Yes — I have ${candidates.length} unsaved contacts waiting: ${names}.`;
}

/** Explains which contact is waiting for meeting context when the user asks mid-prompt. */
export function composePendingCandidateInquiryReply({
  candidates,
  activeDisplayName
}: {
  candidates: Array<{ displayName: string }>;
  activeDisplayName?: string;
}): string {
  if (candidates.length === 0) {
    return composeNoPendingCandidateReply();
  }

  if (activeDisplayName) {
    if (activeDisplayName === "Unnamed Contact") {
      return "I'm asking about a new contact you just added — Contacts hasn't given me the name yet. What should I remember about them?";
    }

    const nextCandidate = candidates.find((candidate) => candidate.displayName !== activeDisplayName);
    const suffix = nextCandidate ? ` ${nextCandidate.displayName} is next.` : "";
    return `I'm asking about ${activeDisplayName} — what should I remember about them?${suffix}`;
  }

  if (candidates.length > 1) {
    return composeCandidateAmbiguityReply({ candidates });
  }

  const name = candidates[0].displayName;
  if (name === "Unnamed Contact") {
    return "I'm asking about a new contact you just added — Contacts hasn't given me the name yet. Where did you meet them?";
  }

  return `I'm asking about ${name}, the contact you just added. Where did you meet them?`;
}

/** Short nudge when a prompted contact still lacks relationship context. */
export function composePendingContactReminder(displayName: string): string {
  return `I still need context for ${displayName} — what should I remember about them?`;
}

type PendingContactsFooterInput = {
  items: Array<{ displayName: string; promptHint?: string }>;
};

/** Formats a capped pending-contact footer for eligible search interrupts. */
export function composePendingContactsFooter({ items }: PendingContactsFooterInput): string {
  if (items.length === 0) {
    return "";
  }

  const visible = items.slice(0, 3);
  const hiddenCount = Math.max(0, items.length - visible.length);
  const header =
    items.length === 1
      ? "Also, I still have 1 unsaved contact waiting for context:"
      : `Also, I still have ${items.length} unsaved contacts waiting for context:`;
  const lines = visible.map(
    (item) => `- ${item.displayName} - ${item.promptHint || "what should I remember about them?"}`
  );

  if (hiddenCount > 0) {
    lines.push(`and ${hiddenCount} more`);
  }

  return [header, ...lines].join("\n");
}

/** Keeps model-provided or deterministic clarification questions short and chat-native. */
export function composeClarificationReply(question?: string): string {
  return question?.trim() || "What do you remember about them?";
}

/** Formats ignore confirmations for pending contact candidates. */
export function composeIgnoreCandidateReply({ candidateName }: IgnoreCandidateReplyInput = {}): string {
  if (!candidateName) {
    return "I don't see a pending contact to ignore right now.";
  }

  return `Ignored ${candidateName}.`;
}

/** Formats successful user-requested memory corrections. */
export function composeMemoryUpdateReply({ memory }: MemoryMutationReplyInput): string {
  const context = summarizeMemoryContext(memory);
  return context ? `Got it, updated ${memory.displayName}. I'll remember ${context}.` : `Got it, updated ${memory.displayName}.`;
}

/** Formats explicit user-requested memory deletes without exposing storage internals. */
export function composeMemoryDeleteReply({ memory }: MemoryMutationReplyInput): string {
  return `Deleted ${memory.displayName} from Friendy memory.`;
}

/** Formats the confirmation gate for deleting all saved relationship memories. */
export function composeDeleteAllMemoryConfirmReply({ count }: DeleteAllMemoryConfirmReplyInput): string {
  return `I found ${count} saved ${count === 1 ? "person" : "people"} in Friendy memory. Delete everyone from Friendy memory?\nReply yes to confirm or no to cancel.`;
}

/** Formats clear-memory requests when there is nothing saved yet. */
export function composeNoSavedMemoryReply(): string {
  return "You haven't saved anyone in Friendy memory yet.";
}

/** Formats explicit bulk-delete completion after the user confirms. */
export function composeDeleteAllMemoryReply({ count }: DeleteAllMemoryReplyInput): string {
  return `Deleted ${count} ${count === 1 ? "person" : "people"} from Friendy memory.`;
}

type ExplainAgentStateReplyInput = {
  displayName?: string;
  savedMemories: Array<{ displayName: string; contextNote: string }>;
  pendingFrame?: { displayName: string; lastFriendyPrompt: string };
};

/** Explains why Friendy may still prompt when saved memory already exists. */
export function composeExplainAgentStateReply({
  displayName,
  savedMemories,
  pendingFrame
}: ExplainAgentStateReplyInput): string {
  const name = displayName ?? pendingFrame?.displayName ?? "that contact";
  const saved = savedMemories.filter((memory) => memory.displayName.toLowerCase() === name.toLowerCase());
  const parts: string[] = [];

  if (saved.length > 0) {
    parts.push(`I already have ${name} saved in Friendy memory.`);
  }

  if (pendingFrame) {
    parts.push(`I also still have a pending contact for ${pendingFrame.displayName} waiting for relationship context.`);
  }

  if (parts.length === 0) {
    return composeClarificationReply(`What should I clarify about ${name}?`);
  }

  parts.push("Those can both be true: saved memory and a separate pending contact prompt.");
  return parts.join(" ");
}

type ConversationRepairReplyInput = {
  displayName?: string;
  savedMemories: Array<{ displayName: string; contextNote: string }>;
  pendingFrame?: { displayName: string };
};

/** Grounds repair replies in pending versus saved state instead of generic apologies. */
export function composeConversationRepairReply({
  displayName,
  savedMemories,
  pendingFrame
}: ConversationRepairReplyInput): string {
  return composeExplainAgentStateReply({
    displayName,
    savedMemories,
    pendingFrame: pendingFrame
      ? {
          displayName: pendingFrame.displayName,
          lastFriendyPrompt: `I noticed you added ${pendingFrame.displayName}. Where did you meet them?`
        }
      : undefined
  });
}

type DuplicateAuditReplyInput = {
  duplicateGroups: Array<{
    displayNames: string[];
    memoryIds: string[];
    pendingCandidateIds?: string[];
  }>;
};

/** Formats duplicate audit results from deterministic grouping. */
export function composeDuplicateAuditReply({ duplicateGroups }: DuplicateAuditReplyInput): string {
  if (duplicateGroups.length === 0) {
    return "I don't see duplicate people in Friendy memory right now.";
  }

  const lines = duplicateGroups.map((group) => {
    const name = group.displayNames[0] ?? "Someone";
    const count = group.memoryIds.length + (group.pendingCandidateIds?.length ?? 0);
    return `- ${name} appears ${count === 2 ? "twice" : `${count} times`}`;
  });

  return ["I see possible duplicates:", "", ...lines].join("\n");
}

type DeleteMemoryConfirmReplyInput = {
  matches: Array<{ displayName: string }>;
};

/** Asks for explicit confirmation before deleting a resolved memory target. */
export function composeDeleteMemoryConfirmReply({ matches }: DeleteMemoryConfirmReplyInput): string {
  if (matches.length === 1) {
    return composeDeleteMemorySingleConfirmReply({ displayName: matches[0].displayName });
  }

  return `Which one should I delete - ${matches.map((match) => match.displayName).join(" or ")}?`;
}

type DeleteMemorySingleConfirmReplyInput = {
  displayName: string;
};

/** Confirmation copy for a single high-confidence delete target. */
export function composeDeleteMemorySingleConfirmReply({ displayName }: DeleteMemorySingleConfirmReplyInput): string {
  return `Do you want me to forget ${displayName}?\nReply yes to confirm or no to cancel.`;
}

type DeleteMemoryDisambiguationReplyInput = {
  query: string;
  options: Array<{ displayName: string; detail?: string }>;
};

/** Numbered disambiguation prompt when delete lookup returns multiple plausible targets. */
export function composeDeleteMemoryDisambiguationReply({
  query,
  options
}: DeleteMemoryDisambiguationReplyInput): string {
  const safeOptions = options.map((option) => ({
    displayName: sanitizeUserFacingOptionText(option.displayName),
    detail: option.detail ? sanitizeUserFacingOptionText(option.detail) : undefined
  }));
  const allSameName =
    safeOptions.length > 1 && safeOptions.every((option) => option.displayName === safeOptions[0]?.displayName);
  const optionLines = safeOptions.map((option, index) => {
    const detail = option.detail ? ` - ${option.detail}` : "";
    return `${index + 1}. ${option.displayName}${detail}`;
  });
  const header = allSameName
    ? `I found multiple people named ${safeOptions[0]?.displayName ?? sanitizeUserFacingOptionText(query)}:`
    : `I found multiple possible matches for "${query}":`;

  return [header, ...optionLines, "Which one do you want to delete, or should I delete both?"].join("\n");
}

function sanitizeUserFacingOptionText(value: string): string {
  return value
    .replace(/\s*\((?:candidate|memory|apple_contact|contact)[_-][^)]+\)/gi, "")
    .replace(/\b(?:candidate|memory|apple_contact|contact)[_-][\w-]+\b/gi, "")
    .replace(/\s+-\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type UpdateMemoryConfirmReplyInput = {
  displayName: string;
  proposedContextNote: string;
  mode?: "replace" | "append";
};

/** Confirmation copy before applying a user-requested memory note update. */
export function composeUpdateMemoryConfirmReply({
  displayName,
  proposedContextNote,
  mode = "replace"
}: UpdateMemoryConfirmReplyInput): string {
  if (mode === "append") {
    return `I found ${displayName}. Add "${proposedContextNote}" to this memory?\nReply yes to confirm or no to cancel.`;
  }

  return `I found ${displayName}. Update the note to "${proposedContextNote}"?\nReply yes to confirm or no to cancel.`;
}

type UpdateMemoryDisambiguationReplyInput = {
  query: string;
  options: Array<{ displayName: string; detail?: string }>;
};

/** Numbered disambiguation prompt when update lookup returns multiple plausible targets. */
export function composeUpdateMemoryDisambiguationReply({
  query,
  options
}: UpdateMemoryDisambiguationReplyInput): string {
  const countLabel = options.length === 2 ? "two" : String(options.length);
  const optionLines = options.map((option, index) => {
    const detail = option.detail ? ` — ${option.detail}` : "";
    return `${index + 1}. ${option.displayName}${detail}`;
  });
  const pickHint =
    options.length === 2
      ? "Reply 1 or 2, or say cancel."
      : `Reply ${options.map((_, index) => String(index + 1)).join(" or ")}, or say cancel.`;

  return [`I found ${countLabel} possible matches for "${query}":`, ...optionLines, pickHint].join("\n");
}

type SameOrDifferentPendingReplyInput = {
  displayName: string;
};

/** Asks whether a new same-name contact is the same saved person or a different person. */
export function composeDuplicateResolutionPrompt({ displayName }: SameOrDifferentPendingReplyInput): string {
  return `I already have ${displayName} saved in Friendy memory, and I'm also waiting on context for a new ${displayName} contact. Is this the same person or a different one? Reply same, different, ignore, or not sure.`;
}

/** @deprecated Use composeDuplicateResolutionPrompt for same-name workflows. */
export function composeSameOrDifferentPendingReply(input: SameOrDifferentPendingReplyInput): string {
  return composeDuplicateResolutionPrompt(input);
}

/** Sent when `agent:friendy` comes online so the owner knows the Mac runtime is listening. */
export function composeRuntimeStartupReply(): string {
  return "Friendy is running on your Mac. Reply start when you want me to watch for new contacts and ask before saving anything.";
}

/** Tells the user the runtime is waiting for explicit start before doing agent work. */
export function composeOnboardingStartRequiredReply(): string {
  return "If you want to start please send me 'start'";
}

/** Formats start/pause/resume setup controls without exposing internal runtime state. */
export function composeOnboardingControlReply(kind: OnboardingControlReplyKind): string {
  if (kind === "started") {
    return "Great. Friendy is on. Add a new contact on your Mac, and I'll ask before saving anything.";
  }

  if (kind === "paused") {
    return 'Contact memory is paused. I won\'t prompt you about new contacts until you reply "resume".';
  }

  return "Friendy is back on. I'll ask before saving any new contact memories.";
}

function composeSingleSearchMatch(memory: RelationshipMemory): string {
  const event = getEventTitle(memory);
  const clue = summarizeMemoryContext(memory);
  const contact = formatContact(memory.primaryContactLabel);
  const context = [event ? `you met them at ${event}` : "", clue ? `the clue was ${clue}` : ""]
    .filter(Boolean)
    .join(", and ");

  if (!context) {
    return `I think that was ${memory.displayName}. ${contact}`;
  }

  return `I think that was ${memory.displayName}. You told me ${context}. ${contact}`;
}

function summarizeMatch(memory: RelationshipMemory): string {
  const event = getEventTitle(memory);
  const clue = summarizeMemoryContext(memory);
  const parts = [memory.displayName, event ? `from ${event}` : "", clue ? `(${clue})` : ""].filter(Boolean);
  return parts.join(" ");
}

function summarizeMemoryContext(memory: RelationshipMemory): string {
  const parts = memory.contextNote
    .split("|")
    .map((part) => normalizeContextPart(part, memory.displayName, getEventTitle(memory)))
    .filter((part) => part.text.length > 0)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3)
    .map((part) => part.text);

  return parts.join("; ");
}

function phraseSavedContext(displayName: string, context: string, eventTitle?: string): string {
  const firstPersonMeeting = context.match(/^i\s+met\s+(?:them|him|her)\b\s*(.*)$/i);
  if (firstPersonMeeting) {
    const suffix = firstPersonMeeting[1]?.trim();
    return suffix ? `you met ${displayName} ${suffix}` : `you met ${displayName}`;
  }

  const firstPersonEventOnly = context.match(/^i\s+met\s+(?:at|in|during|from|while)\b\s*(.*)$/i);
  if (firstPersonEventOnly) {
    const suffix = firstPersonEventOnly[1]?.trim();
    return suffix ? `you met ${displayName} at ${suffix}` : `you met ${displayName}`;
  }

  const prepositionalMeeting = context.match(/^(at|in|during|from|while)\s+(.+)$/i);
  if (prepositionalMeeting) {
    return `you met ${displayName} ${prepositionalMeeting[1].toLowerCase()} ${prepositionalMeeting[2].trim()}`;
  }

  if (eventTitle && normalizeContextComparable(context).startsWith(normalizeContextComparable(eventTitle))) {
    return `you met ${displayName} at ${lowercaseFirst(context)}`;
  }

  const thirdPersonRole = context.match(/^they\s+(?:were|are)\s+(.+)$/i);
  if (thirdPersonRole) {
    return `${displayName} is ${thirdPersonRole[1].trim()}`;
  }

  if (/^they\b/i.test(context)) {
    return context;
  }

  if (/^(?:works?|worked|knows?|knew|met|talked|needs?|need|we talked)\b/i.test(context)) {
    return `${displayName} ${context}`;
  }

  if (/^(?:community lead|member|founder|designer|engineer|operator|mentor|friend|collaborator|classmate)\b/i.test(context)) {
    return `${displayName} is ${withIndefiniteArticle(context)}`;
  }

  return context;
}

function withIndefiniteArticle(context: string): string {
  if (/^(?:a|an|the)\s+/i.test(context)) {
    return context;
  }

  return /^[aeiou]/i.test(context) ? `an ${context}` : `a ${context}`;
}

function lowercaseFirst(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^[A-Z]{2}/.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed[0].toLowerCase()}${trimmed.slice(1)}`;
}

function normalizeContextComparable(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function normalizeContextPart(
  part: string,
  displayName: string,
  eventTitle?: string
): { text: string; priority: number } {
  const trimmed = part.trim();

  if (!trimmed) {
    return { text: "", priority: 100 };
  }

  if (eventTitle && trimmed.toLowerCase() === `event: ${eventTitle}`.toLowerCase()) {
    return { text: "", priority: 100 };
  }

  const fieldMatch = trimmed.match(/^([a-z /]+):\s*(.+)$/i);
  if (fieldMatch) {
    const [, label, value] = fieldMatch;
    const cleanValue = value.trim();

    if (label.toLowerCase() === "event") {
      return { text: "", priority: 100 };
    }

    if (label.toLowerCase() === "role") {
      return { text: `they were the ${cleanValue}`, priority: 1 };
    }

    if (label.toLowerCase() === "school/company") {
      return { text: `school or company: ${cleanValue}`, priority: 3 };
    }

    if (label.toLowerCase() === "class year") {
      return { text: `class year ${cleanValue}`, priority: 4 };
    }

    if (label.toLowerCase() === "project") {
      return { text: cleanValue, priority: 2 };
    }

    if (label.toLowerCase() === "alias") {
      return { text: `also called ${cleanValue}`, priority: 5 };
    }

    return { text: cleanValue, priority: 10 };
  }

  const text = trimmed
    .replace(/^User met\s+/i, "you met ")
    .replace(new RegExp(`^${escapeRegExp(displayName)}\\s+`, "i"), "")
    .trim();

  return { text, priority: 6 };
}

function getEventTitle(memory: RelationshipMemory): string | undefined {
  if (memory.eventTitle) {
    return memory.eventTitle;
  }

  const eventPart = memory.contextNote.split("|").find((part) => part.trim().toLowerCase().startsWith("event:"));
  return eventPart?.replace(/^event:\s*/i, "").trim() || undefined;
}

function formatContact(primaryContactLabel: string): string {
  if (!primaryContactLabel || primaryContactLabel === "manual contact") {
    return "I don't have a contact link saved yet.";
  }

  return `You can reach them at ${primaryContactLabel}.`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
