/**
 * Detects broad read-only inventory requests for saved people.
 *
 * This is intentionally narrower than all relationship recall. It should catch obvious roster
 * requests without model help, while leaving event, related-person, and clue-based search to the
 * search route.
 */
export function isBroadPeopleInventoryRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\bu\b/g, "you");
  return isListPeopleRecall(text) && !hasSpecificInventoryFilter(normalized);
}

function hasSpecificInventoryFilter(normalized: string): boolean {
  const match = normalized.match(/\b(?:i\s+)?(?:know|have|met|saved|remember)\s+(.+)$/);
  if (!match?.[1]) {
    return false;
  }

  const tail = match[1].replace(/[?.!]+$/g, "").trim();
  if (
    tail === "so far" ||
    /^(?:yet|so far)?\s*(?:in|from)?\s*my\s+(?:contact|contacts|network)$/.test(tail)
  ) {
    return false;
  }

  return tail.length > 0;
}

/**
 * Detects broad read-only requests to list saved people.
 *
 * This is an intent/operator detector, not a keyword search query. It keeps phrases like
 * "all", "everyone", and "so far" from being treated as meeting context while a candidate
 * prompt is open, and lets retrieval decide how many saved memories to return.
 */
export function isListPeopleRecall(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\bu\b/g, "you");
  if (/\b(related|connected|connection|associated|association)\b/.test(normalized)) {
    return false;
  }

  if (isEventRecallQuestion(normalized)) {
    return false;
  }

  return [
    /\b(?:give|show|list|tell)\b(?:\s+me)?\s+\b(?:everyone|everybody)\b\s*$/,
    /\b(give|show|list|tell)\b.*\b(all|every|everyone|everybody)\b.*\b(people|persons?|contacts?|network)\b/,
    /\b(give|show|list|tell)\b.*\b(everyone|everybody)\b.*\b(i\s+)?(know|met|saved|remember)\b/,
    /\b(all|every|everyone|everybody)\b.*\b(people|persons?|contacts?|network)\b.*\b(i|my|me|mine|know|met|saved|have|remember|so far)\b/,
    /\bwhat\b.*\bare\b.*\b(all|every|everyone|everybody|the)\b.*\b(people|persons?|contacts?)\b.*\b(i\s+)?(know|have|met|saved|remember)\b/,
    /\bwho\b.*\bare\b.*\b(all|every|everyone|everybody|the)\b.*\b(people|persons?|contacts?)\b.*\b(i\s+)?(know|have|met|saved|remember)\b/,
    /\bwhat\b.*\b(people|persons?|contacts?)\b.*\b(do\s+i\s+|i\s+)?(know|have|met|saved|remember)\b/,
    /\bwhat\b.*\b(people|persons?|contacts?)\b.*\bdo\s+you\s+(know|have|remember)\b.*\b(my|mine|contacts?|network)\b/,
    /\bwhat\b.*\bdo\s+you\s+(know|remember)\b/,
    /\bwho\b.*\b(do\s+i\s+|i\s+)(know|have|met|saved|remember)\b/,
    /\b(people|contacts?)\b.*\b(i\s+)?(know|have|met|saved|remember)\b.*\bso far\b/,
    /\bdo\s+you\s+know\b.*\b(anyone|anybody|someone|somebody|people|persons?|contacts?)\b.*\b(my|mine|contacts?|network)\b/,
    /\bdo\s+you\s+know\b.*\bmy\b.*\b(people|persons?|contacts?|network)\b/
  ].some((pattern) => pattern.test(normalized));
}

/**
 * Person name from "list detail about {name}" / "what do you know about {name}" style requests.
 */
export function extractPersonFromDetailListCommand(text: string): string | undefined {
  const trimmed = text.trim();
  const patterns = [
    /^(?:give|show|list|tell)(?:\s+me)?(?:\s+all)?(?:\s+the)?\s+(?:detail|details|info|information)\s+about\s+(.+?)[.?!]*$/i,
    /^(?:give|show|list|tell)(?:\s+me)?\s+(?:everything|all)\s+(?:you\s+)?(?:know|remember)\s+about\s+(.+?)[.?!]*$/i,
    /^(?:what\s+do\s+you\s+know\s+about|who\s+is|tell\s+me\s+about)\s+(.+?)[.?!]*$/i
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const name = match?.[1]?.trim();
    if (name && name.length >= 2 && !/\b(?:people|persons?|contacts?|network|everyone|everybody)\b/i.test(name)) {
      return name;
    }
  }

  return undefined;
}

/**
 * Person name from "list me all the {name}" / "list everyone named {name}" style requests.
 */
export function extractFilteredPersonListCommand(text: string): string | undefined {
  const trimmed = text.trim();
  const patterns = [
    /^(?:(?:can|could|would)\s+(?:you|u)\s+)?(?:please\s+)?(?:give|show|list|tell)(?:\s+me)?\s+all\s+memor(?:y|ies)(?:\s+you\s+(?:have|remember))?\s+for\s+(.+?)[.?!]*$/i,
    /^(?:(?:can|could|would)\s+(?:you|u)\s+)?(?:please\s+)?(?:give|show|list|tell)(?:\s+me)?\s+all\s+(?:the\s+)?(.+?)[.?!]*$/i,
    /^(?:(?:can|could|would)\s+(?:you|u)\s+)?(?:please\s+)?(?:give|show|list|tell)(?:\s+me)?\s+(?:every|everyone|everybody)\s+(?:named|called)\s+(.+?)[.?!]*$/i,
    /^(?:(?:can|could|would)\s+(?:you|u)\s+)?(?:please\s+)?(?:give|show|list|tell)(?:\s+me)?\s+(?:the\s+)?\d+\s+(.+?)(?:\s+(?:you(?:'re| are)|that|i)\b.+)?[.?!]*$/i
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const name = match?.[1]?.trim();
    if (!name || name.length < 2) {
      continue;
    }
    if (/\b(?:people|persons?|contacts?|network|everyone|everybody)\b/i.test(name)) {
      continue;
    }
    if (/^(?:all|every|everyone|everybody)\b/i.test(name)) {
      continue;
    }
    return name;
  }

  return undefined;
}

/**
 * Person name after a list/show/tell command (e.g. "List Nathan"), when the request is not broad inventory.
 */
export function extractNamedPersonFromListCommand(text: string): string | undefined {
  const filteredListPerson = extractFilteredPersonListCommand(text);
  if (filteredListPerson) {
    return undefined;
  }

  if (isBroadPeopleInventoryRequest(text) || isEventRecallQuestion(text)) {
    return undefined;
  }

  const detailPerson = extractPersonFromDetailListCommand(text);
  if (detailPerson) {
    return detailPerson;
  }

  const match = text.trim().match(/^(?:give|show|list|tell)(?:\s+me)?\s+(.+?)[.?!]*$/i);
  if (!match?.[1]) {
    return undefined;
  }

  const tail = match[1].trim();
  if (
    /^(?:all|every|everyone|everybody)\b/i.test(tail) ||
    /\b(?:people|persons?|contacts?|network)\b/i.test(tail)
  ) {
    return undefined;
  }

  return tail.length >= 2 ? tail : undefined;
}

/** True when the user asks who they met at/during a specific event (not a full roster). */
export function isEventRecallQuestion(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\bu\b/g, "you");
  return (
    /\bwho\b.*\b(?:did\s+i\s+)?(?:meet|met|add|added|save|saved)\b.*\b(?:at|during|from|while)\b.+/.test(
      normalized
    ) ||
    /\b(?:what|which)\b.*\b(?:people|persons?|contacts?)\b.*\b(?:did\s+i\s+|i\s+)?(?:meet|met|add|added|save|saved)\b.*\b(?:at|during|from|while)\b.+/.test(
      normalized
    ) ||
    /\banyone\b.*\b(?:i\s+)?(?:met|meet|added|saved)\b.*\b(?:at|during|from|while)\b.+/.test(normalized)
  );
}
