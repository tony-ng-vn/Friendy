/** Cleans natural-language wrapper text around a memory delete/update target. */
export function cleanMemoryTargetQuery(query: string): string {
  let cleaned = query
    .trim()
    .replace(/^["'`/]+|["'`/]+$/g, "")
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ");

  let previous = "";
  while (cleaned && previous !== cleaned) {
    previous = cleaned;
    cleaned = cleaned
      .replace(/^(?:(?:can|could|would)\s+(?:you|u)\s+)?(?:help\s+me\s+)?(?:please\s+)?(?:delete|remove|forget)\s+/i, "")
      .replace(/\s+(?:from|in)\s+(?:your\s+|my\s+|friendy\s+)?memor(?:y|ies)$/i, "")
      .replace(/\s+memory$/i, "")
      .replace(/\s+for\s+me$/i, "")
      .replace(/\s+(?:please|pls|thanks|thank\s+you)$/i, "")
      .replace(/[?.!]+$/g, "")
      .trim()
      .replace(/\s+/g, " ");
  }

  return cleaned;
}
