import type { RelationshipMemory } from "./types";

export type MemorySearchDocument = {
  memoryId: string;
  userId: string;
  text: string;
  fields: {
    displayName: string;
    eventTitle?: string;
    contextNote: string;
    relationshipContext?: string;
    tags: string[];
    dateText?: string;
  };
  updatedAt: string;
};

export type RetrievalCandidate = {
  memoryId: string;
  source: "field_lexical" | "document_lexical" | "fts" | "embedding";
  score: number;
  matchedTerms: string[];
};

export function buildMemorySearchDocument(memory: RelationshipMemory): MemorySearchDocument {
  const fields = {
    displayName: memory.displayName,
    eventTitle: emptyToUndefined(memory.eventTitle),
    contextNote: memory.contextNote,
    relationshipContext: emptyToUndefined(memory.relationshipContext),
    tags: memory.tags,
    dateText: emptyToUndefined(memory.dateContext?.rawText ?? memory.dateContext?.localDate)
  };

  return {
    memoryId: memory.id,
    userId: memory.userId,
    text: [
      ["Name", fields.displayName],
      ["Event", fields.eventTitle],
      ["Context", fields.contextNote],
      ["Relationship", fields.relationshipContext],
      ["Date", fields.dateText],
      ["Tags", fields.tags.join(", ")]
    ]
      .filter(([, value]) => String(value ?? "").trim().length > 0)
      .map(([label, value]) => `${label}: ${value}`)
      .join("\n"),
    fields,
    updatedAt: memory.updatedAt
  };
}

export function scoreMemorySearchDocument(
  document: MemorySearchDocument,
  terms: string[]
): RetrievalCandidate | undefined {
  const documentTokens = tokenize(document.text);
  const matchedTerms = terms.filter((term) => documentTokens.has(normalizeSearchToken(term)));
  if (matchedTerms.length === 0) {
    return undefined;
  }

  return {
    memoryId: document.memoryId,
    source: "document_lexical",
    score: matchedTerms.length * 3,
    matchedTerms
  };
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .map((part) => normalizeSearchToken(part))
      .filter(Boolean)
  );
}

function normalizeSearchToken(value: string): string {
  return value.toLowerCase().replace(/ing$/, "").replace(/ed$/, "").replace(/s$/, "");
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}
