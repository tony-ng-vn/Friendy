/**
 * Lexical search document builder for relationship memories.
 *
 * Converts persisted {@link RelationshipMemory} rows into a flat text surface and field bag
 * used by in-memory and SQLite repository lexical search. Keeps
 * retrieval deterministic before embeddings or FTS are layered in.
 */
import type { RelationshipMemory } from "./types";

/** Flattened memory row used by lexical retrieval and optional FTS indexing. */
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

/** Scored retrieval hit with provenance so callers can merge lexical, FTS, and future embedding ranks. */
export type RetrievalCandidate = {
  memoryId: string;
  source: "field_lexical" | "document_lexical" | "fts" | "embedding";
  score: number;
  matchedTerms: string[];
};

/** Builds the labeled text document stored or scored during memory search. */
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

/**
 * Scores one document against normalized query terms using simple token overlap.
 *
 * Returns undefined when no terms match so callers can skip the row without a zero-score sentinel.
 */
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
  // Cheap English suffix stripping keeps lexical recall tolerant without a stemmer dependency.
  return value.toLowerCase().replace(/ing$/, "").replace(/ed$/, "").replace(/s$/, "");
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}
