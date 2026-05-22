/**
 * Deterministic user-facing copy for relationship-agent replies.
 *
 * Callers: `agentCore.ts`, `interpretedAgent.ts`, transports after tool execution.
 *
 * Format-only boundary: inputs are already-selected memories, matches, or structured intake
 * outcomes. This module must never choose matches, write memories, or expose raw search scores,
 * `reason` strings, or tool diagnostics — those stay in logs and tests.
 */
import type { MemorySearchResult } from "./tools";
import type { RelationshipMemory } from "./types";

type SaveConfirmationInput = {
  memories: RelationshipMemory[];
};

type SearchReplyInput = {
  matches: MemorySearchResult[];
  ambiguous?: boolean;
};

type IgnoreCandidateReplyInput = {
  candidateName?: string;
};

type CandidateAmbiguityReplyInput = {
  candidates: Array<{ displayName: string }>;
};

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

    if (event && context) {
      return `Saved. I'll remember ${memory.displayName} from ${event}: ${context}.`;
    }

    if (event) {
      return `Saved. I'll remember ${memory.displayName} from ${event}.`;
    }

    if (context) {
      return `Saved. I'll remember ${memory.displayName}: ${context}.`;
    }

    return `Saved. I'll remember ${memory.displayName}.`;
  }

  return `Saved. I'll remember ${memories.length} people: ${memories.map((memory) => memory.displayName).join(", ")}.`;
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
