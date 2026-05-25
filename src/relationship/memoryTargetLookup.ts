/**
 * Resolves a user-named memory target to one row, a short option list, or no match.
 *
 * Combines fuzzy display-name scoring with optional exact context-note matching when
 * the user quotes saved text. Ambiguity uses a score gap, not search-result collapse.
 */
import { rankDisplayNameMatches } from "./personNameMatch";
import { cleanMemoryTargetQuery } from "./targetQueryCleanup";
import type { RelationshipMemory } from "./types";

/** Single target, ambiguous options, or no qualifying memory for the query. */
export type MemoryTargetLookupResult =
  | { kind: "none"; query: string }
  | {
      kind: "single";
      memoryId: string;
      memoryIds?: string[];
      displayName: string;
      score: number;
      matchedVia: "exact" | "fuzzy" | "context";
    }
  | {
      kind: "ambiguous";
      options: Array<{ memoryId: string; memoryIds?: string[]; displayName: string; detail?: string; score: number }>;
      query: string;
    };

export type LookupMemoryTargetInput = {
  userId: string;
  query: string;
  memories: RelationshipMemory[];
  minScore?: number;
  ambiguityGap?: number;
  includeContext?: boolean;
  operation?: "delete" | "update";
  recentPeople?: Array<{ displayName: string; memoryIds: string[] }>;
};

type ScoredMemoryTarget = {
  memoryId: string;
  memoryIds?: string[];
  displayName: string;
  detail?: string;
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
  const query = cleanMemoryTargetQuery(input.query);

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
        options: contextMatches.map(({ memoryId, displayName, detail, score }) => ({
          memoryId,
          displayName,
          detail,
          score
        })),
        query,
      };
    }
  }

  const exactDuplicateDisplayNameDeleteTargets = findExactDuplicateDisplayNameDeleteTargets(
    query,
    userMemories,
    input.operation
  );
  if (exactDuplicateDisplayNameDeleteTargets) {
    return exactDuplicateDisplayNameDeleteTargets;
  }

  const recentMatch = lookupRecentListedPerson(query, input.recentPeople ?? []);
  if (recentMatch) {
    return recentMatch;
  }

  const rankedMatches = rankDisplayNameMatches(
    query,
    groupMemoryTargetsByDisplayName(userMemories).map((target) => target.displayName)
  );
  const groupedTargets = groupMemoryTargetsByDisplayName(userMemories);

  const qualified: ScoredMemoryTarget[] = [];
  for (const match of rankedMatches) {
    if (match.score < minScore) {
      continue;
    }

    for (const target of groupedTargets) {
      if (target.displayName !== match.displayName) {
        continue;
      }

      qualified.push({
        memoryId: target.memoryIds[0],
        memoryIds: target.memoryIds.length > 1 ? target.memoryIds : undefined,
        displayName: target.displayName,
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
      memoryIds: match.memoryIds,
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
      memoryIds: match.memoryIds,
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
        options: dedupeScoredTargetsByDisplayName(options).map(({ memoryId, memoryIds, displayName, score }) => ({
          memoryId,
          memoryIds,
          displayName,
          score,
        })),
        query,
      };
    }
  }

  return { kind: "none", query };
}

function findExactDuplicateDisplayNameDeleteTargets(
  query: string,
  memories: RelationshipMemory[],
  operation: LookupMemoryTargetInput["operation"]
): MemoryTargetLookupResult | undefined {
  if (operation !== "delete") {
    return undefined;
  }

  const normalizedQuery = normalizeDisplayName(query);
  const matches = memories.filter((memory) => normalizeDisplayName(memory.displayName) === normalizedQuery);
  if (matches.length <= 1) {
    return undefined;
  }

  return {
    kind: "ambiguous",
    query,
    options: matches.map((memory) => ({
      memoryId: memory.id,
      displayName: memory.displayName,
      detail: summarizeMemoryTarget(memory),
      score: 100
    }))
  };
}

function lookupRecentListedPerson(
  query: string,
  recentPeople: Array<{ displayName: string; memoryIds: string[] }>
): MemoryTargetLookupResult | undefined {
  const normalizedQuery = normalizeDisplayName(query);
  const ordinal = parseRecentListOrdinal(normalizedQuery);
  if (ordinal !== undefined) {
    const match = recentPeople[ordinal - 1];
    if (!match) {
      return undefined;
    }

    return {
      kind: "single",
      memoryId: match.memoryIds[0],
      memoryIds: match.memoryIds.length > 1 ? match.memoryIds : undefined,
      displayName: match.displayName,
      score: 100,
      matchedVia: "exact"
    };
  }

  const matches = recentPeople.filter((person) => normalizeDisplayName(person.displayName) === normalizedQuery);
  if (matches.length === 0) {
    return undefined;
  }

  const deduped = dedupeRecentPeople(matches);
  if (deduped.length === 1) {
    const [match] = deduped;
    return {
      kind: "single",
      memoryId: match.memoryIds[0],
      memoryIds: match.memoryIds.length > 1 ? match.memoryIds : undefined,
      displayName: match.displayName,
      score: 100,
      matchedVia: "exact"
    };
  }

  return {
    kind: "ambiguous",
    query,
    options: deduped.map((match) => ({
      memoryId: match.memoryIds[0],
      memoryIds: match.memoryIds.length > 1 ? match.memoryIds : undefined,
      displayName: match.displayName,
      score: 100
    }))
  };
}

function parseRecentListOrdinal(query: string): number | undefined {
  const match = query.match(/^(?:#|number\s+|no\.\s*)?(\d{1,2})$/i);
  if (!match?.[1]) {
    return undefined;
  }

  const value = Number.parseInt(match[1], 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function dedupeRecentPeople(
  people: Array<{ displayName: string; memoryIds: string[] }>
): Array<{ displayName: string; memoryIds: string[] }> {
  const groups = new Map<string, { displayName: string; memoryIds: string[] }>();
  for (const person of people) {
    const anchorMemoryId = person.memoryIds[0] ?? "";
    const key = anchorMemoryId
      ? `${normalizeDisplayName(person.displayName)}::${anchorMemoryId}`
      : normalizeDisplayName(person.displayName);
    const existing = groups.get(key);
    if (existing) {
      existing.memoryIds.push(...person.memoryIds.filter((id) => !existing.memoryIds.includes(id)));
      continue;
    }
    groups.set(key, { displayName: person.displayName, memoryIds: [...person.memoryIds] });
  }
  return [...groups.values()];
}

function groupMemoryTargetsByDisplayName(memories: RelationshipMemory[]): Array<{ displayName: string; memoryIds: string[] }> {
  const groups = new Map<string, { displayName: string; memoryIds: string[] }>();

  for (const memory of memories) {
    const key = normalizeDisplayName(memory.displayName);
    const existing = groups.get(key);
    if (existing) {
      existing.memoryIds.push(memory.id);
      continue;
    }

    groups.set(key, { displayName: memory.displayName, memoryIds: [memory.id] });
  }

  return [...groups.values()];
}

function dedupeScoredTargetsByDisplayName(targets: ScoredMemoryTarget[]): ScoredMemoryTarget[] {
  const seen = new Set<string>();
  const deduped: ScoredMemoryTarget[] = [];

  for (const target of targets) {
    const key = normalizeDisplayName(target.displayName);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(target);
  }

  return deduped;
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
      detail: summarizeMemoryTarget(memory),
      score: 100,
      matchedVia: "context" as const,
    }));
}

function summarizeMemoryTarget(memory: RelationshipMemory): string | undefined {
  const detail = memory.contextNote || memory.eventTitle || memory.relationshipContext;
  const normalized = detail?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 117).trimEnd()}...`;
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
