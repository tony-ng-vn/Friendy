/**
 * Deterministic follow-up capture after the first pending-contact memory is saved.
 *
 * Keeps a short loop: ask for more facts about the same person until the user declines.
 */

function normalizeAdditionalMemoryReply(text: string): string {
  return text
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase()
    .replace(/[\u2018\u2019`´]/g, "'")
    .replace(/[.!]+$/g, "");
}

/** User ended the optional additional-memory loop. */
export function isAdditionalMemoryDecline(text: string): boolean {
  const normalized = normalizeAdditionalMemoryReply(text);
  if (!normalized) {
    return false;
  }

  if (
    /^(no|nope|nah|none|nothing|nothing else|that'?s all|thats all|that'?s it|thats it|that is it|all set|all good|i'?m good|im good|done|no thanks|no thank you)$/.test(
      normalized
    )
  ) {
    return true;
  }

  return /\b(nothing else|that'?s all|that'?s it|no more)\b/.test(normalized);
}

/** Affirmative without new content — prompt for what to add. */
export function isBareAdditionalMemoryAffirmative(text: string): boolean {
  const normalized = normalizeAdditionalMemoryReply(text);
  return /^(yes|yeah|yep|yup|sure|ok|okay)$/.test(normalized);
}

/** User switched from optional follow-up capture into a new search, list, update, or delete task. */
export function isAdditionalMemoryTaskSwitch(text: string): boolean {
  const normalized = normalizeAdditionalMemoryReply(text);
  return (
    /\?$/.test(text.trim()) ||
    /^(who|what|where|when|which|list|show|find|search)\b/.test(normalized) ||
    /^(can|could|would)\s+(you|u)\s+(change|update|delete|remove|forget|list|show|find|search)\b/.test(normalized) ||
    /^(change|update|delete|remove|forget)\b/.test(normalized)
  );
}

/** Enough signal to store another episodic memory for the same person. */
export function hasSubstantiveAdditionalMemoryContent(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 4) {
    return false;
  }

  if (isAdditionalMemoryDecline(trimmed) || isBareAdditionalMemoryAffirmative(trimmed) || isAdditionalMemoryTaskSwitch(trimmed)) {
    return false;
  }

  return true;
}
