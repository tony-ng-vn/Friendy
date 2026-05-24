import { rankDisplayNameMatches } from "./personNameMatch";
import type { RelationshipMemory } from "./types";

export type MemoryTargetLookupResult =
  | { kind: "none"; query: string }
  | {
      kind: "single";
      memoryId: string;
      displayName: string;
      score: number;
      matchedVia: "exact" | "fuzzy" | "context";
    }
  | {
      kind: "ambiguous";
      options: Array<{ memoryId: string; displayName: string; score: number }>;
      query: string;
    };

export type LookupMemoryTargetInput = {
  userId: string;
  query: string;
  memories: RelationshipMemory[];
  minScore?: number;
  ambiguityGap?: number;
  includeContext?: boolean;
};

type ScoredMemoryTarget = {
  memoryId: string;
  displayName: string;
  score: number;
};

type ContextMemoryTarget = ScoredMemoryTarget & {
  matchedVia: "context";
};

function normalizeDisplayName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveMatchedVia(query: string, displayName: string, score: number): "exact" | "fuzzy" {
  if (score === 100 || normalizeDisplayName(query) === normalizeDisplayName(displayName)) {
    return "exact";
  }

  return "fuzzy";
}

/** Resolves fuzzy delete/update targets to a single memory, ambiguous options, or no match. */
export function lookupMemoryTarget(input: LookupMemoryTargetInput): MemoryTargetLookupResult {
  const minScore = input.minScore ?? 70;
  const ambiguityGap = input.ambiguityGap ?? 8;
  const query = input.query.trim();

  if (!query) {
    return { kind: "none", query: input.query };
  }

  const userMemories = input.memories.filter(
    (memory) => memory.userId === input.userId && !memory.deletedAt
  );

  if (input.includeContext) {
    const contextMatches = findExactContextMatches(query, userMemories);
    if (contextMatches.length === 1) {
      const match = contextMatches[0];
      return {
        kind: "single",
        memoryId: match.memoryId,
        displayName: match.displayName,
        score: match.score,
        matchedVia: match.matchedVia,
      };
    }

    if (contextMatches.length > 1) {
      return {
        kind: "ambiguous",
        options: contextMatches.map(({ memoryId, displayName, score }) => ({ memoryId, displayName, score })),
        query,
      };
    }
  }

  const rankedMatches = rankDisplayNameMatches(
    query,
    userMemories.map((memory) => memory.displayName)
  );

  const qualified: ScoredMemoryTarget[] = [];
  for (const match of rankedMatches) {
    if (match.score < minScore) {
      continue;
    }

    for (const memory of userMemories) {
      if (memory.displayName !== match.displayName) {
        continue;
      }

      qualified.push({
        memoryId: memory.id,
        displayName: memory.displayName,
        score: match.score,
      });
    }
  }

  qualified.sort((left, right) => right.score - left.score);

  if (qualified.length === 0) {
    return { kind: "none", query };
  }

  if (qualified.length === 1) {
    const match = qualified[0];
    return {
      kind: "single",
      memoryId: match.memoryId,
      displayName: match.displayName,
      score: match.score,
      matchedVia: resolveMatchedVia(query, match.displayName, match.score),
    };
  }

  const topScore = qualified[0].score;
  const gapToSecond = topScore - qualified[1].score;

  if (topScore >= 85 && gapToSecond >= ambiguityGap) {
    const match = qualified[0];
    return {
      kind: "single",
      memoryId: match.memoryId,
      displayName: match.displayName,
      score: match.score,
      matchedVia: resolveMatchedVia(query, match.displayName, match.score),
    };
  }

  if (topScore >= minScore && gapToSecond < ambiguityGap) {
    const options = qualified.filter((candidate) => topScore - candidate.score < ambiguityGap);
    if (options.length > 1) {
      return {
        kind: "ambiguous",
        options: options.map(({ memoryId, displayName, score }) => ({
          memoryId,
          displayName,
          score,
        })),
        query,
      };
    }
  }

  return { kind: "none", query };
}

function findExactContextMatches(query: string, memories: RelationshipMemory[]): ContextMemoryTarget[] {
  const normalizedQuery = normalizeContextText(query);
  if (!normalizedQuery) {
    return [];
  }

  return memories
    .filter((memory) => contextAliases(memory.contextNote).some((context) => normalizeContextText(context) === normalizedQuery))
    .map((memory) => ({
      memoryId: memory.id,
      displayName: memory.displayName,
      score: 100,
      matchedVia: "context" as const,
    }));
}

function contextAliases(contextNote: string): string[] {
  return contextNote
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeContextText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^context\s*:\s*/i, "")
    .replace(/\s+/g, " ");
}
