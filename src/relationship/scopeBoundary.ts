export type ScopeCapability =
  | "relationship_recall"
  | "relationship_memory_write"
  | "candidate_confirmation"
  | "candidate_ignore"
  | "message_drafting"
  | "followup_planning"
  | "social_reasoning";

export type ScopeDecision =
  | {
      scope: "in_scope";
      capability: ScopeCapability;
      reason: string;
    }
  | {
      scope: "needs_clarification";
      reason: string;
      question: string;
    }
  | {
      scope: "out_of_scope";
      reason: string;
      redirect: string;
    };

export type ScopeBoundaryInput = {
  text: string;
  hasPendingCandidate: boolean;
};

const DEFAULT_REDIRECT =
  "I am here to help with people you know, relationship memory, and follow-ups. If this is about someone in your network, tell me who and I can help.";
const GENERAL_TASK_REDIRECT =
  "I am not the right tool for general tasks like that. I can help if it connects to someone you know or something you want to remember about them.";
const CODING_REDIRECT =
  "I cannot help with coding tasks. I can help you draft a reply to the person asking, or remember context about them.";
const RELATIONSHIP_THEORY_REDIRECT =
  "I am better at helping with your specific relationships than explaining relationships in general. If you mean someone specific, tell me who.";

/**
 * Classifies whether Friendy should handle a message before any relationship tools run.
 *
 * This is intentionally deterministic for the MVP. It blocks obvious general-assistant requests
 * while leaving relationship-specific interpretation to the existing agent layer.
 */
export function decideMessageScope({ text, hasPendingCandidate }: ScopeBoundaryInput): ScopeDecision {
  const normalized = text.trim();
  const lower = normalized.toLowerCase();

  if (lower.length === 0) {
    return clarify("empty_message", "What should I help you remember about someone?");
  }

  if (isAdversarialGeneralAssistantRequest(lower)) {
    return outOfScope("adversarial_general_assistant_request", DEFAULT_REDIRECT);
  }

  if (isIgnoreCandidate(lower)) {
    return inScope("candidate_ignore", "User is trying to ignore a pending relationship candidate.");
  }

  if (isCandidateConfirmation(lower)) {
    if (hasPendingCandidate) {
      return inScope("candidate_confirmation", "User is replying to a pending relationship candidate.");
    }

    return clarify("confirmation_without_candidate", "Who should I attach that relationship context to?");
  }

  if (isExplicitRelationshipMemory(lower)) {
    return inScope("relationship_memory_write", "User is explicitly asking Friendy to remember relationship context.");
  }

  if (isRelationshipDraft(lower)) {
    return inScope("message_drafting", "User is asking for help communicating with a specific person.");
  }

  if (isAmbiguousDraftRequest(lower)) {
    return clarify("missing_message_recipient", "Who is it for?");
  }

  if (isGenericRelationshipTheory(lower)) {
    return outOfScope("generic_relationship_theory", RELATIONSHIP_THEORY_REDIRECT);
  }

  if (isCodingTask(lower)) {
    return outOfScope("coding_task", CODING_REDIRECT);
  }

  if (isMathTask(lower)) {
    return outOfScope("math_task", GENERAL_TASK_REDIRECT);
  }

  if (isGeneralKnowledgeTask(lower) || isGenericAdviceTask(lower)) {
    return outOfScope("general_assistant_task", DEFAULT_REDIRECT);
  }

  if (hasPendingCandidate && isCandidateContextAnswer(lower)) {
    return inScope("candidate_confirmation", "User is replying with context for a pending relationship candidate.");
  }

  if (isFollowupPlanning(lower)) {
    return inScope("followup_planning", "User is asking about follow-up decisions for relationships.");
  }

  if (isSocialReasoning(lower)) {
    return inScope("social_reasoning", "User is asking for social reasoning around a relationship.");
  }

  if (isRelationshipRecall(lower)) {
    return inScope("relationship_recall", "User is asking Friendy to recall relationship memory.");
  }

  if (isRelationshipAdjacentButUnderspecified(lower)) {
    return clarify("underspecified_relationship_task", "What do you remember about them?");
  }

  if (isWeakPersonReference(lower)) {
    return inScope("relationship_recall", "User is weakly referring to a person in their relationship memory.");
  }

  return outOfScope("outside_relationship_memory_domain", DEFAULT_REDIRECT);
}

function inScope(capability: ScopeCapability, reason: string): ScopeDecision {
  return { scope: "in_scope", capability, reason };
}

function clarify(reason: string, question: string): ScopeDecision {
  return { scope: "needs_clarification", reason, question };
}

function outOfScope(reason: string, redirect: string): ScopeDecision {
  return { scope: "out_of_scope", reason, redirect };
}

function isIgnoreCandidate(text: string): boolean {
  return /^ignore\b/.test(text);
}

function isCandidateConfirmation(text: string): boolean {
  return (
    /^(yes|yeah|yep|correct|confirm|save|that'?s right|the\s+\w+\s+one)\b/.test(text) ||
    /^[1-3](?:\b|[,.])/.test(text) ||
    /^(?:the\s+)?(?:first|second|third)(?:\s+one)?(?:\b|[,.])/.test(text)
  );
}

function isExplicitRelationshipMemory(text: string): boolean {
  return /^(remember|met|i met|i remember)\b/.test(text) || /\b(i also met|also met|i met)\b/.test(text);
}

function isRelationshipDraft(text: string): boolean {
  return (
    /\b(help|draft|write|compose)\b.*\b(text|message|reply|dm|follow up|follow-up|tell)\b.*\b[A-Z]?[a-z]+\b/i.test(text) ||
    /\b(help|draft|write|compose)\b.*\btell\b\s+\w+/.test(text) ||
    /\btell\s+\w+\b.*\b(i can'?t|i cannot|sorry|thanks|thank you|follow up|follow-up)\b/.test(text)
  );
}

function isAmbiguousDraftRequest(text: string): boolean {
  return /\b(help|draft|write|compose)\b.*\b(text|message|reply|dm)\b/.test(text) && !/\b(to|tell)\s+\w+/.test(text);
}

function isAdversarialGeneralAssistantRequest(text: string): boolean {
  return /\b(ignore|forget|disregard)\b.*\b(instruction|previous|system|rules?)\b/.test(text);
}

function isGenericRelationshipTheory(text: string): boolean {
  return /\bwhat is (a )?relationship\??$/.test(text) || /\bdefine (a )?relationship\b/.test(text);
}

function isCodingTask(text: string): boolean {
  return /\b(write|debug|fix|build|code|implement|generate)\b.*\b(sql|python|react|javascript|typescript|app|script|function|bug|code)\b/.test(
    text
  );
}

function isMathTask(text: string): boolean {
  return (
    /\b(calculate|solve|what is|what's)\b.*\d+\s*([*x×+\-/]|percent|%)\s*\d+/.test(text) ||
    /\d+\s*([*x×+\-/])\s*\d+/.test(text)
  );
}

function isGeneralKnowledgeTask(text: string): boolean {
  return /\b(explain|summarize|research|who is the president|what is quantum|quantum mechanics)\b/.test(text);
}

function isGenericAdviceTask(text: string): boolean {
  return /\b(how do i|how can i|tips for)\b.*\b(charismatic|make friends|be popular|people like me)\b/.test(text);
}

function isCandidateContextAnswer(text: string): boolean {
  if (text.includes("?") || text.length > 140) {
    return false;
  }

  if (/^(who|what|where|when|why|how|should|can|could|would|write|debug|explain|calculate|remember)\b/.test(text)) {
    return false;
  }

  if (/^\w+\s+(was|is|likes?|liked|hates?|loves?|works?|builds?|does|did|has|had)\b/.test(text)) {
    return false;
  }

  return (
    /^(somewhere else|elsewhere|neither|none of those|not those)\b/.test(text) ||
    /^(met at|at|from|during)\s+\S+/.test(text) ||
    /^(?:the\s+)?(coffee|cafe|dinner|lunch|meetup|party|residency|conference|school|office|bar)\b/.test(text)
  );
}

function isFollowupPlanning(text: string): boolean {
  return /\b(who should i follow up|follow up with|follow-up with|not talked to|reach out)\b/.test(text);
}

function isSocialReasoning(text: string): boolean {
  return /\b(is|was|were)\b.*\b(mad|upset|cold|awkward)\b/.test(text) || /\bwhat should i say\b/.test(text);
}

function isRelationshipRecall(text: string): boolean {
  return (
    /\b(who|where|when|what)\b.*\b(met|meet|know|relationship|remember|saved)\b/.test(text) ||
    /\bdo i know\b/.test(text) ||
    /\bwho (likes|works|goes|is|was)\b/.test(text) ||
    /\b(who|find|show|list)\b.*\b(slept|sleep|bed|room|lead|founder|project|making|made|goes|school|class|from|at)\b/.test(
      text
    )
  );
}

function isRelationshipAdjacentButUnderspecified(text: string): boolean {
  return /\b(remember this|should i follow up|who was that person|that person from)\b/.test(text);
}

function isWeakPersonReference(text: string): boolean {
  return /\b(that person|someone)\b/.test(text);
}
