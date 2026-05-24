/**
 * Bridges relationship agent outputs into `expressionFacts` bundles.
 *
 * Returns undefined when the draft is empty or the reply kind should not be polished.
 */
import type { MemorySearchResult } from "./tools";
import type { RelationshipMemory } from "./types";
import {
  buildClarificationBundle,
  buildConversationRepairBundle,
  buildExplainAgentStateBundle,
  buildPendingContactExplanationBundle,
  buildSaveConfirmationBundle,
  buildSearchAmbiguousMatchesBundle,
  buildSearchNoMatchBundle,
  buildSearchSingleMatchBundle,
  type ConversationRepairBundle,
  type ExpressionFactBundle,
  type ExpressionReplyKind
} from "./expressionFacts";

/** Maps agent/tool outcomes into an expression bundle; returns undefined when polish is unsafe or unsupported. */
export type BuildExpressionFactBundleInput =
  | { kind: "save_confirmation"; draft: string; memories: RelationshipMemory[] }
  | { kind: "search_single_match"; draft: string; memory: RelationshipMemory; ambiguous?: boolean }
  | { kind: "search_ambiguous_matches"; draft: string; matches: MemorySearchResult[] }
  | { kind: "search_no_match"; draft: string; suggestedClueTypes?: string[] }
  | { kind: "clarification"; draft: string; questionIntent?: string }
  | {
      kind: "pending_contact_explanation";
      draft: string;
      activeDisplayName: string;
      queueNames?: string[];
    }
  | { kind: "conversation_repair"; draft: string; repairTopic: ConversationRepairBundle["repairTopic"] }
  | { kind: "explain_agent_state"; draft: string; workflowSummary: string };

const DEFAULT_CLUE_TYPES = ["name", "event", "project", "school", "date"];

const EXPRESSIVE_KINDS = new Set<ExpressionReplyKind>([
  "save_confirmation",
  "search_single_match",
  "search_ambiguous_matches",
  "search_no_match",
  "clarification",
  "pending_contact_explanation",
  "conversation_repair",
  "explain_agent_state"
]);

/** Maps composer/tool outputs into a grounded expression fact bundle, or undefined when unsupported. */
export function buildExpressionFactBundle(input: BuildExpressionFactBundleInput): ExpressionFactBundle | undefined {
  const draft = input.draft.trim();
  if (!draft || !EXPRESSIVE_KINDS.has(input.kind)) {
    return undefined;
  }

  switch (input.kind) {
    case "save_confirmation":
      if (input.memories.length === 0) {
        return undefined;
      }

      return buildSaveConfirmationBundle({
        draft,
        savedPeople: input.memories.map(toSavedPersonFacts)
      });

    case "search_single_match":
      return buildSearchSingleMatchBundle({
        draft,
        match: toSearchMatchFacts(input.memory),
        ambiguity: input.ambiguous
      });

    case "search_ambiguous_matches":
      if (input.matches.length < 2) {
        return undefined;
      }

      return buildSearchAmbiguousMatchesBundle({
        draft,
        matches: input.matches.map((match) => toSearchMatchFacts(match.memory))
      });

    case "search_no_match":
      return buildSearchNoMatchBundle({
        draft,
        suggestedClueTypes: input.suggestedClueTypes ?? DEFAULT_CLUE_TYPES
      });

    case "clarification":
      return buildClarificationBundle({
        draft,
        questionIntent: input.questionIntent ?? "general_clarification"
      });

    case "pending_contact_explanation":
      return buildPendingContactExplanationBundle({
        draft,
        activeDisplayName: input.activeDisplayName,
        queueNames: input.queueNames
      });

    case "conversation_repair":
      return buildConversationRepairBundle({
        draft,
        repairTopic: input.repairTopic
      });

    case "explain_agent_state":
      return buildExplainAgentStateBundle({
        draft,
        workflowSummary: input.workflowSummary
      });
  }
}

function toSavedPersonFacts(memory: RelationshipMemory) {
  return {
    displayName: memory.displayName,
    event: getMemoryEventTitle(memory),
    noteSnippet: summarizeMemoryNoteSnippet(memory)
  };
}

function toSearchMatchFacts(memory: RelationshipMemory) {
  const contactHint = toAllowedContactHint(memory.primaryContactLabel);

  return {
    displayName: memory.displayName,
    event: getMemoryEventTitle(memory),
    noteSnippet: summarizeMemoryNoteSnippet(memory),
    contactHint
  };
}

function getMemoryEventTitle(memory: RelationshipMemory): string | undefined {
  if (memory.eventTitle) {
    return memory.eventTitle;
  }

  const eventPart = memory.contextNote.split("|").find((part) => part.trim().toLowerCase().startsWith("event:"));
  return eventPart?.replace(/^event:\s*/i, "").trim() || undefined;
}

function summarizeMemoryNoteSnippet(memory: RelationshipMemory): string | undefined {
  const parts = memory.contextNote
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const fieldMatch = part.match(/^([a-z /]+):\s*(.+)$/i);
      if (fieldMatch) {
        const [, label, value] = fieldMatch;
        if (label.toLowerCase() === "event") {
          return "";
        }
        return value.trim();
      }

      return part.replace(/^User met\s+/i, "you met ").trim();
    })
    .filter(Boolean);

  return parts.slice(0, 2).join("; ") || undefined;
}

/** Only redacted last-four labels may appear in expression output; full numbers stay banned. */
function toAllowedContactHint(primaryContactLabel: string): string | undefined {
  const label = primaryContactLabel.trim();
  if (!label || label === "manual contact") {
    return undefined;
  }

  if (/ending in \d{4}/i.test(label)) {
    return label;
  }

  return undefined;
}
