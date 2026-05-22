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

  return [
    /\b(give|show|list|tell)\b.*\b(all|every|everyone|everybody)\b.*\b(people|persons?|contacts?|network)\b/,
    /\b(give|show|list|tell)\b.*\b(everyone|everybody)\b.*\b(i\s+)?(know|met|saved|remember)\b/,
    /\b(all|every|everyone|everybody)\b.*\b(people|persons?|contacts?|network)\b.*\b(i|my|me|mine|know|met|saved|have|remember|so far)\b/,
    /\bwhat\b.*\b(people|persons?|contacts?)\b.*\b(do\s+i\s+|i\s+)?(know|have|met|saved|remember)\b/,
    /\bwho\b.*\b(do\s+i\s+|i\s+)(know|have|met|saved|remember)\b/,
    /\b(people|contacts?)\b.*\b(i\s+)?(know|have|met|saved|remember)\b.*\bso far\b/
  ].some((pattern) => pattern.test(normalized));
}
