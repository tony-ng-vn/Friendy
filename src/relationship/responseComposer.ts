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

type CandidateAmbiguityReplyInput = {
  candidates: Array<{ displayName: string }>;
};

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
    const savedContext = context ? phraseSavedContext(memory.displayName, context) : "";

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

  const summaries = matches.map((match) => summarizeMatch(match.memory)).join("; ");
  const prefix = `I found ${matches.length} possible matches: ${summaries}.`;

  if (ambiguous) {
    return `${prefix} Which person do you mean?`;
  }

  return prefix;
}

/** Formats structured people inventory results without using search diagnostics. */
export function composeListPeopleReply({ result, preferBullets = false }: ListPeopleReplyInput): string {
  if (result.unsupportedSources?.includes("apple_contacts") && result.people.length === 0) {
    return "I can list people from Friendy memory right now. Apple Contacts listing is not connected yet.";
  }

  if (result.people.length === 0) {
    return "I don't have any matching people in Friendy memory yet.";
  }

  const heading = result.appliedFilterLabel
    ? `I remember these people from ${result.appliedFilterLabel}:`
    : `I remember ${result.people.length === 1 ? "this person" : "these people"} in Friendy memory:`;
  const peopleLines = result.people.map((person) => formatListedPerson(person, preferBullets));
  const sections = [heading, "", ...peopleLines];

  const duplicateLines = result.duplicateGroups.map((group) => formatDuplicateGroup(group)).filter(Boolean);
  if (duplicateLines.length > 0) {
    sections.push("", "I also see possible duplicates:", "", ...duplicateLines);
  }

  if (result.unsupportedSources?.includes("apple_contacts")) {
    sections.push("", "Apple Contacts listing is not connected yet, so this is from Friendy memory only.");
  }

  return sections.join("\n");
}

function formatListedPerson(person: ListPeopleResult["people"][number], preferBullets: boolean): string {
  const summaries = person.memories.map((memory) => memory.summary).filter(Boolean);
  const summary = summaries.length > 0 ? ` - ${summaries.join("; ")}` : "";
  const prefix = preferBullets ? "- " : "";
  return `${prefix}${person.displayName}${summary}`;
}

function formatDuplicateGroup(group: ListPeopleResult["duplicateGroups"][number]): string {
  const prefix = "- ";
  if (group.displayNames.length === 1) {
    const count = group.memoryIds.length + group.pendingCandidateIds.length;
    return `${prefix}${group.displayNames[0]} appears ${count === 2 ? "twice" : `${count} times`}`;
  }

  return `${prefix}${group.displayNames.join(" / ")} may be the same person`;
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

export function composePendingContactReminder(displayName: string): string {
  return `I still need context for ${displayName} — what should I remember about them?`;
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

/** Sent when `agent:friendy` comes online so the owner knows the Mac runtime is listening. */
export function composeRuntimeStartupReply(): string {
  return "Friendy is running on your Mac. Reply start when you want me to watch for new contacts and ask before saving anything.";
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

function phraseSavedContext(displayName: string, context: string): string {
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
