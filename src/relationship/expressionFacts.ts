export type ExpressionReplyKind =
  | "save_confirmation"
  | "search_single_match"
  | "search_ambiguous_matches"
  | "search_no_match"
  | "clarification"
  | "pending_contact_explanation"
  | "conversation_repair"
  | "explain_agent_state";

export const GLOBAL_BANNED_EXPRESSION_TERMS = [
  "candidate",
  "route",
  "intent",
  "tool",
  "score",
  "confidence",
  "schema",
  "model",
  "memory object",
  "database",
  "repository",
  "manual contact",
  "matched"
] as const;

export type ExpressionFactBundleBase = {
  kind: ExpressionReplyKind;
  deterministicDraft: string;
  maxLength: number;
  allowMarkdown: boolean;
  allowBullets: boolean;
  bannedTerms: string[];
  allowedPeopleNames: string[];
  allowedEventNames: string[];
  allowedContextSnippets: string[];
  allowedContactHints: string[];
  ambiguity: boolean;
  requiresQuestion: boolean;
  requiredQuestionText?: string;
  styleHint?: "neutral" | "repair" | "excited_save";
};

export type SaveConfirmationBundle = ExpressionFactBundleBase & {
  kind: "save_confirmation";
  savedPeople: Array<{ displayName: string; event?: string; noteSnippet?: string }>;
};

export type SearchSingleMatchBundle = ExpressionFactBundleBase & {
  kind: "search_single_match";
  match: { displayName: string; event?: string; noteSnippet?: string; contactHint?: string };
};

export type SearchAmbiguousMatchesBundle = ExpressionFactBundleBase & {
  kind: "search_ambiguous_matches";
  matches: Array<{ displayName: string; event?: string; noteSnippet?: string }>;
};

export type SearchNoMatchBundle = ExpressionFactBundleBase & {
  kind: "search_no_match";
  suggestedClueTypes: string[];
};

export type ClarificationBundle = ExpressionFactBundleBase & {
  kind: "clarification";
  questionIntent: string;
};

export type PendingContactExplanationBundle = ExpressionFactBundleBase & {
  kind: "pending_contact_explanation";
  activeDisplayName: string;
  queueNames?: string[];
};

export type ConversationRepairBundle = ExpressionFactBundleBase & {
  kind: "conversation_repair";
  repairTopic: "stale_prompt" | "duplicate_confusion" | "other";
};

export type ExplainAgentStateBundle = ExpressionFactBundleBase & {
  kind: "explain_agent_state";
  workflowSummary: string;
};

export type ExpressionFactBundle =
  | SaveConfirmationBundle
  | SearchSingleMatchBundle
  | SearchAmbiguousMatchesBundle
  | SearchNoMatchBundle
  | ClarificationBundle
  | PendingContactExplanationBundle
  | ConversationRepairBundle
  | ExplainAgentStateBundle;

const DEFAULT_MAX_LENGTH = 280;

function baseBundle(input: {
  kind: ExpressionReplyKind;
  draft: string;
  allowedPeopleNames?: string[];
  allowedEventNames?: string[];
  allowedContextSnippets?: string[];
  allowedContactHints?: string[];
  ambiguity?: boolean;
  requiresQuestion?: boolean;
  requiredQuestionText?: string;
  styleHint?: ExpressionFactBundleBase["styleHint"];
  maxLength?: number;
  allowBullets?: boolean;
}): ExpressionFactBundleBase {
  return {
    kind: input.kind,
    deterministicDraft: input.draft,
    maxLength: input.maxLength ?? DEFAULT_MAX_LENGTH,
    allowMarkdown: false,
    allowBullets: input.allowBullets ?? false,
    bannedTerms: [...GLOBAL_BANNED_EXPRESSION_TERMS],
    allowedPeopleNames: input.allowedPeopleNames ?? [],
    allowedEventNames: input.allowedEventNames ?? [],
    allowedContextSnippets: input.allowedContextSnippets ?? [],
    allowedContactHints: input.allowedContactHints ?? [],
    ambiguity: input.ambiguity ?? false,
    requiresQuestion: input.requiresQuestion ?? input.draft.includes("?"),
    requiredQuestionText: input.requiredQuestionText,
    styleHint: input.styleHint
  };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter(Boolean) as string[])];
}

/** Builds a grounded fact bundle for a single search match reply. */
export function buildSearchSingleMatchBundle(input: {
  draft: string;
  match: SearchSingleMatchBundle["match"];
  ambiguity?: boolean;
  requiresQuestion?: boolean;
}): SearchSingleMatchBundle {
  const snippets = [input.match.noteSnippet].filter(Boolean) as string[];
  const contactHints = [input.match.contactHint].filter(Boolean) as string[];
  const events = [input.match.event].filter(Boolean) as string[];

  return {
    ...baseBundle({
      kind: "search_single_match",
      draft: input.draft,
      allowedPeopleNames: [input.match.displayName],
      allowedEventNames: events,
      allowedContextSnippets: snippets,
      allowedContactHints: contactHints,
      ambiguity: input.ambiguity,
      requiresQuestion: input.requiresQuestion
    }),
    kind: "search_single_match",
    match: input.match
  };
}

/** Builds a grounded fact bundle for save confirmation replies. */
export function buildSaveConfirmationBundle(input: {
  draft: string;
  savedPeople: SaveConfirmationBundle["savedPeople"];
  styleHint?: ExpressionFactBundleBase["styleHint"];
}): SaveConfirmationBundle {
  return {
    ...baseBundle({
      kind: "save_confirmation",
      draft: input.draft,
      allowedPeopleNames: input.savedPeople.map((person) => person.displayName),
      allowedEventNames: uniqueStrings(input.savedPeople.map((person) => person.event)),
      allowedContextSnippets: uniqueStrings(input.savedPeople.map((person) => person.noteSnippet)),
      styleHint: input.styleHint ?? "excited_save"
    }),
    kind: "save_confirmation",
    savedPeople: input.savedPeople
  };
}

/** Builds a grounded fact bundle for ambiguous search results. */
export function buildSearchAmbiguousMatchesBundle(input: {
  draft: string;
  matches: SearchAmbiguousMatchesBundle["matches"];
  requiresQuestion?: boolean;
}): SearchAmbiguousMatchesBundle {
  const visibleMatches = input.matches.slice(0, 3);

  return {
    ...baseBundle({
      kind: "search_ambiguous_matches",
      draft: input.draft,
      allowedPeopleNames: visibleMatches.map((match) => match.displayName),
      allowedEventNames: uniqueStrings(visibleMatches.map((match) => match.event)),
      allowedContextSnippets: uniqueStrings(visibleMatches.map((match) => match.noteSnippet)),
      ambiguity: true,
      requiresQuestion: input.requiresQuestion ?? true,
      allowBullets: true
    }),
    kind: "search_ambiguous_matches",
    matches: visibleMatches
  };
}

/** Builds a grounded fact bundle for no-match search replies. */
export function buildSearchNoMatchBundle(input: {
  draft: string;
  suggestedClueTypes: string[];
}): SearchNoMatchBundle {
  return {
    ...baseBundle({
      kind: "search_no_match",
      draft: input.draft,
      allowedContextSnippets: input.suggestedClueTypes,
      requiresQuestion: input.draft.includes("?")
    }),
    kind: "search_no_match",
    suggestedClueTypes: input.suggestedClueTypes
  };
}

/** Builds a grounded fact bundle for clarification prompts. */
export function buildClarificationBundle(input: {
  draft: string;
  questionIntent: string;
}): ClarificationBundle {
  return {
    ...baseBundle({
      kind: "clarification",
      draft: input.draft,
      requiresQuestion: true
    }),
    kind: "clarification",
    questionIntent: input.questionIntent
  };
}

/** Builds a grounded fact bundle for pending-contact explanation replies. */
export function buildPendingContactExplanationBundle(input: {
  draft: string;
  activeDisplayName: string;
  queueNames?: string[];
}): PendingContactExplanationBundle {
  const queueNames = input.queueNames ?? [];

  return {
    ...baseBundle({
      kind: "pending_contact_explanation",
      draft: input.draft,
      allowedPeopleNames: uniqueStrings([input.activeDisplayName, ...queueNames])
    }),
    kind: "pending_contact_explanation",
    activeDisplayName: input.activeDisplayName,
    queueNames
  };
}

/** Builds a grounded fact bundle for conversation repair replies. */
export function buildConversationRepairBundle(input: {
  draft: string;
  repairTopic: ConversationRepairBundle["repairTopic"];
}): ConversationRepairBundle {
  return {
    ...baseBundle({
      kind: "conversation_repair",
      draft: input.draft,
      styleHint: "repair"
    }),
    kind: "conversation_repair",
    repairTopic: input.repairTopic
  };
}

/** Builds a grounded fact bundle for explain-agent-state replies. */
export function buildExplainAgentStateBundle(input: {
  draft: string;
  workflowSummary: string;
}): ExplainAgentStateBundle {
  return {
    ...baseBundle({
      kind: "explain_agent_state",
      draft: input.draft,
      allowedContextSnippets: [input.workflowSummary]
    }),
    kind: "explain_agent_state",
    workflowSummary: input.workflowSummary
  };
}
