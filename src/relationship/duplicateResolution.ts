/**
 * Deterministic parsing for duplicate-resolution replies during same-display-name workflows.
 *
 * Resolution transitions stay out of the LLM: same, different, ignore, and not sure map to
 * explicit workflow actions before normal candidate confirmation continues.
 */
export type DuplicateResolutionReply = "same" | "different" | "ignore" | "not_sure";

/**
 * Parses user text into a duplicate-resolution action when the reply is explicit enough.
 *
 * @returns Parsed action, or `undefined` when the text does not match known resolution phrases.
 */
export function parseDuplicateResolutionReply(value: string): DuplicateResolutionReply | undefined {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");

  if (!normalized) {
    return undefined;
  }

  if (isIgnoreReply(normalized)) {
    return "ignore";
  }

  if (isNotSureReply(normalized)) {
    return "not_sure";
  }

  if (isSameReply(normalized)) {
    return "same";
  }

  if (isDifferentReply(normalized)) {
    return "different";
  }

  return undefined;
}

function isIgnoreReply(normalized: string): boolean {
  return /^(ignore|skip|no thanks)$/.test(normalized);
}

function isNotSureReply(normalized: string): boolean {
  return /^(not sure|unsure|idk|i don'?t know)$/.test(normalized);
}

function isSameReply(normalized: string): boolean {
  return (
    normalized === "same" ||
    normalized === "same person" ||
    normalized.startsWith("yes same") ||
    normalized.startsWith("yes, same") ||
    /^(it(?:'s| is) the same person)$/.test(normalized)
  );
}

function isDifferentReply(normalized: string): boolean {
  return (
    normalized === "different" ||
    normalized === "different person" ||
    normalized.startsWith("no different") ||
    normalized.startsWith("no, different") ||
    /^(someone new|a different person)$/.test(normalized)
  );
}
