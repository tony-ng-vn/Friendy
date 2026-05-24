import type { ExpressionFactBundle } from "./expressionFacts";

export type ExpressionValidationResult = { ok: true } | { ok: false; reasons: string[] };

const CERTAINTY_PHRASES = ["definitely", "that's them", "it was "];
const INVENTED_RELATIONSHIP_TERMS = ["boyfriend", "girlfriend", "married"];
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_REGEX = /(?:\+?\d[\d\s().-]{7,}\d)/;

/** Validates expression LLM output against the fact bundle and draft constraints. */
export function validateExpressionReply(input: {
  draft: string;
  bundle: ExpressionFactBundle;
  output: string;
}): ExpressionValidationResult {
  const reasons: string[] = [];
  const text = input.output.trim();

  if (!text) {
    reasons.push("empty_output");
  }

  if (text.length > input.bundle.maxLength) {
    reasons.push("too_long");
  }

  const lower = text.toLowerCase();
  for (const term of input.bundle.bannedTerms) {
    if (lower.includes(term.toLowerCase())) {
      reasons.push("banned_term");
      break;
    }
  }

  if (!input.bundle.allowMarkdown && /[#*`\[]/.test(text)) {
    reasons.push("markdown_not_allowed");
  }

  if (EMAIL_REGEX.test(text)) {
    reasons.push("contact_detail_not_allowed");
  } else if (hasDisallowedPhoneDetail(text, input.bundle.allowedContactHints)) {
    reasons.push("contact_detail_not_allowed");
  }

  if (input.bundle.requiresQuestion && !text.includes("?")) {
    reasons.push("missing_required_question");
  }

  if (!input.bundle.requiresQuestion && (text.match(/\?/g)?.length ?? 0) > 1) {
    reasons.push("extra_questions");
  }

  if (input.bundle.ambiguity && CERTAINTY_PHRASES.some((phrase) => lower.includes(phrase))) {
    reasons.push("ambiguous_certainty");
  }

  if (input.bundle.kind === "save_confirmation") {
    const requiredName = input.bundle.savedPeople[0]?.displayName;
    if (requiredName && !text.includes(requiredName)) {
      reasons.push("missing_required_name");
    }
  } else if (input.bundle.allowedPeopleNames.length > 0) {
    const mentionsAllowedPerson = input.bundle.allowedPeopleNames.some((name) => text.includes(name));
    const draftMentionsPerson = input.bundle.allowedPeopleNames.some((name) => input.draft.includes(name));
    if (draftMentionsPerson && !mentionsAllowedPerson) {
      reasons.push("missing_required_name");
    }
  }

  for (const term of INVENTED_RELATIONSHIP_TERMS) {
    if (lower.includes(term) && !includesAllowedSnippet(lower, input.bundle, term)) {
      reasons.push("invented_relationship_term");
      break;
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

function includesAllowedSnippet(text: string, bundle: ExpressionFactBundle, term: string): boolean {
  return (
    bundle.deterministicDraft.toLowerCase().includes(term) ||
    bundle.allowedContextSnippets.some((snippet) => snippet.toLowerCase().includes(term)) ||
    !text.includes(term)
  );
}

function hasDisallowedPhoneDetail(text: string, allowedContactHints: string[]): boolean {
  const sanitized = stripAllowedContactHints(text, allowedContactHints);
  return PHONE_REGEX.test(sanitized);
}

function stripAllowedContactHints(text: string, allowedContactHints: string[]): string {
  return allowedContactHints.reduce((remaining, hint) => {
    if (!hint) {
      return remaining;
    }

    return remaining.replace(new RegExp(escapeRegExp(hint), "gi"), "");
  }, text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
