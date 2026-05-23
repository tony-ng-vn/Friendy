/**
 * Deterministic relationship-agent tools backed by {@link RelationshipRepository}.
 *
 * Callers: `agentCore.ts`, `interpretedAgent.ts`, `candidateIntake.ts`, evals, and tests.
 *
 * Search scoring is field-aware and intentionally transparent — weights favor person-specific
 * facts over shared event words. {@link MemorySearchResult.reason} is diagnostic text for logs
 * and tests; user-facing copy must come from `responseComposer.ts` and must never surface scores.
 */
import { randomUUID } from "node:crypto";
import { createCandidateId } from "./eventMapper";
import { isListPeopleRecall } from "./listPeopleRecall";
import { buildMemorySearchDocument, scoreMemorySearchDocument, type RetrievalCandidate } from "./memorySearchDocument";
import { extractTags, type RelationshipRepository } from "./repository";
import type { CalendarEvent, ContactCandidateDetected, RelationshipDateContext, RelationshipMemory } from "./types";

/** Search hit with diagnostic explanation text for logs and tests, not direct user-facing copy. */
export type MemorySearchResult = {
  memory: RelationshipMemory;
  /** Aggregate field-weight score used for ranking and ambiguity detection. */
  score: number;
  /** Lexical match summary — never show verbatim to users. */
  reason: string;
};

export type ListPeopleSource = "friendy_memory" | "apple_contacts" | "both";

export type ListPeopleRequest = {
  source: ListPeopleSource;
  limit: number;
  cursor?: string;
  dedupeByPerson?: boolean;
  includePending?: boolean;
};

export type InternalListPeopleRequest = ListPeopleRequest & {
  filter?: {
    rawText?: string;
    exactTerms?: string[];
    eventName?: string;
    topic?: string;
    tags?: string[];
  };
};

export type ListedPersonMemory = {
  memoryId: string;
  summary: string;
};

export type ListedPerson = {
  personId?: string;
  displayName: string;
  memories: ListedPersonMemory[];
  duplicateGroupId?: string;
  pendingCandidateIds?: string[];
};

export type DuplicateGroup = {
  duplicateGroupId: string;
  reason: "same_display_name" | "similar_display_name" | "same_contact_method" | "pending_matches_saved";
  displayNames: string[];
  memoryIds: string[];
  pendingCandidateIds: string[];
};

export type PendingCandidateSummary = {
  candidateId: string;
  displayName: string;
  status: "pending" | "prompted";
};

export type ListPeopleResult = {
  people: ListedPerson[];
  duplicateGroups: DuplicateGroup[];
  pendingCandidates: PendingCandidateSummary[];
  appliedFilterLabel?: string;
  nextCursor?: string;
  unsupportedSources?: ListPeopleSource[];
};

type SearchQueryAnalysis = {
  terms: string[];
  isEventWide: boolean;
  isListAll: boolean;
};

type InternalMemorySearchResult = MemorySearchResult & {
  coverage: number;
  eventScore: number;
  specificScore: number;
  matchedTerms: string[];
};

type CreateManualMemoryOptions = {
  eventTitle?: string;
  dateContext?: RelationshipDateContext;
  idempotencyKey?: string;
  createdFromInteractionId?: string;
};

type UpdateMemoryOptions = {
  reason: "user_correction" | "user_note_added";
  userText?: string;
  now?: string;
};

type DeleteMemoryOptions = {
  userText?: string;
  now?: string;
};

/**
 * Builds bounded tools for the relationship agent.
 *
 * Keeping these as small explicit actions makes the agent traceable: contact capture,
 * search, confirmation, ignore, and manual memory creation can each be tested independently.
 */
export function createRelationshipTools(repo: RelationshipRepository) {
  return {
    create_contact_candidate(contact: ContactCandidateDetected) {
      return repo.createCandidateFromDetectedContact(contact);
    },

    sync_calendar_events(userId: string, events: CalendarEvent[]) {
      const scopedEvents = events.filter((event) => event.userId === userId);
      return repo.addCalendarEvents(scopedEvents);
    },

    search_memories(userId: string, query: string): MemorySearchResult[] {
      const queryAnalysis = analyzeSearchQuery(query);
      if (queryAnalysis.isListAll) {
        return repo.listMemories(userId).map((memory) => ({
          memory,
          score: 1,
          reason: "list-all relationship recall"
        }));
      }

      const repositoryCandidates = groupRetrievalCandidates(
        repo.searchMemoryDocuments?.(userId, query, queryAnalysis.terms) ?? []
      );

      const scored = repo
        .listMemories(userId)
        .map((memory) => mergeRepositoryCandidates(scoreMemory(memory, queryAnalysis), repositoryCandidates.get(memory.id) ?? [], queryAnalysis))
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score || b.specificScore - a.specificScore);

      return selectSearchResults(scored, queryAnalysis).map(stripInternalScores);
    },

    list_pending_candidates(userId: string) {
      return repo.listPendingCandidates(userId);
    },

    get_candidate(_userId: string, candidateId: string) {
      return repo.getCandidate(candidateId);
    },

    list_candidate_event_matches(userId: string, candidateId: string) {
      const candidate = repo.getCandidate(candidateId);
      if (!candidate || candidate.userId !== userId) {
        throw new Error(`Candidate not found for user: ${candidateId}`);
      }
      return repo.listEventMatches(candidateId);
    },

    confirm_candidate(
      userId: string,
      candidateId: string,
      contextNote: string,
      eventId?: string,
      options: { eventTitle?: string; relationshipContext?: string } = {}
    ) {
      const candidate = repo.getCandidate(candidateId);
      if (!candidate || candidate.userId !== userId) {
        throw new Error(`Candidate not found for user: ${candidateId}`);
      }
      return repo.confirmCandidate(candidateId, contextNote, eventId, options);
    },

    ignore_candidate(userId: string, candidateId: string) {
      const candidate = repo.getCandidate(candidateId);
      if (!candidate || candidate.userId !== userId) {
        throw new Error(`Candidate not found for user: ${candidateId}`);
      }
      repo.ignoreCandidate(candidateId);
      return { ignored: true };
    },

    create_manual_memory(
      userId: string,
      name: string,
      contextNote: string,
      contactMethod = "manual contact",
      options: CreateManualMemoryOptions = {}
    ) {
      const contactIdentifier = options.idempotencyKey ?? `manual:${randomUUID()}`;
      const source = options.idempotencyKey ? "manual_imessage" : "manual";
      const candidateInput: ContactCandidateDetected = {
        userId,
        displayName: name,
        phoneNumbers: [contactMethod],
        emails: [],
        detectedAt: new Date(Date.now()).toISOString(),
        source,
        manualIdempotencyKey: options.idempotencyKey,
        createdFromInteractionId: options.createdFromInteractionId ?? interactionIdFromManualKey(options.idempotencyKey),
        contactIdentifier
      };
      const candidateId = createCandidateId(candidateInput);
      const existingMemory = repo.listMemories(userId).find((memory) => memory.candidateId === candidateId);
      if (existingMemory) {
        return existingMemory;
      }
      const candidate = repo.getCandidate(candidateId) ?? repo.createCandidateFromDetectedContact(candidateInput);

      return repo.confirmCandidate(candidate.id, contextNote, undefined, {
        eventTitle: options.eventTitle,
        dateContext: options.dateContext
      });
    },

    update_memory(userId: string, memoryId: string, contextNote: string, options: UpdateMemoryOptions) {
      const memory = repo.listMemories(userId).find((item) => item.id === memoryId);
      if (!memory) {
        throw new Error(`Memory not found for user: ${memoryId}`);
      }

      return repo.updateMemory(memoryId, {
        contextNote,
        reason: options.reason,
        userText: options.userText,
        updatedAt: options.now ?? new Date().toISOString()
      });
    },

    delete_memory(userId: string, memoryId: string, options: DeleteMemoryOptions = {}) {
      const memory = repo.listMemories(userId).find((item) => item.id === memoryId);
      if (!memory) {
        throw new Error(`Memory not found for user: ${memoryId}`);
      }

      return repo.deleteMemory(memoryId, {
        userText: options.userText,
        deletedAt: options.now ?? new Date().toISOString()
      });
    }
  };
}

function interactionIdFromManualKey(idempotencyKey: string | undefined): string | undefined {
  const prefix = "manual_imessage:";
  return idempotencyKey?.startsWith(prefix) ? idempotencyKey.slice(prefix.length) : undefined;
}

/**
 * Scores memories with deterministic field-aware matching for the MVP.
 *
 * Weight table (per matched query term):
 * - name 12, role 10, school 10, project 9, alias 7, free context 5, tags 4
 * - event 8 when query is event-wide; otherwise event 1 (and context suppressed if event matched)
 *
 * Specific person facts must outrank generic shared event words. Event-wide "who did I meet"
 * searches are the exception: those intentionally return every matching event memory.
 */
function scoreMemory(memory: RelationshipMemory, query: SearchQueryAnalysis): InternalMemorySearchResult {
  const fields = extractMemorySearchFields(memory);
  const matched = new Set<string>();
  let score = 0;
  let eventScore = 0;
  let specificScore = 0;
  const reasonParts: string[] = [];

  for (const term of query.terms) {
    const eventMatch = fieldIncludes(fields.event, term);
    if (eventMatch) {
      // Event-wide recall ("who did I meet at X") should surface every attendee memory;
      // narrow searches down-weight event tokens so "designer from dinner" prefers role over venue.
      const weight = query.isEventWide ? 8 : 1;
      score += weight;
      eventScore += weight;
      matched.add(term);
    }

    const nameScore = scoreSpecificField(fields.name, term, 12); // display name — strongest person signal
    const roleScore = scoreSpecificField(fields.role, term, 10);
    const projectScore = scoreSpecificField(fields.project, term, 9);
    const schoolScore = scoreSpecificField(fields.school, term, 10);
    const aliasScore = scoreSpecificField(fields.alias, term, 7);
    const tagScore = scoreSpecificField(fields.tags, term, 4); // lexical tags — weakest specific signal
    const contextScore = eventMatch ? 0 : scoreSpecificField(fields.context, term, 5);
    const termSpecificScore = nameScore + roleScore + projectScore + schoolScore + aliasScore + tagScore + contextScore;

    if (termSpecificScore > 0) {
      score += termSpecificScore;
      specificScore += termSpecificScore;
      matched.add(term);
    }
  }

  const documentCandidate = scoreMemorySearchDocument(buildMemorySearchDocument(memory), query.terms);
  const documentMatchedTerms = documentCandidate?.matchedTerms.filter((term) => !matched.has(term)) ?? [];
  if (documentCandidate && documentMatchedTerms.length > 0) {
    const documentScore = documentMatchedTerms.length * 3 * 0.6;
    score += documentScore;
    specificScore += documentScore;
    for (const term of documentMatchedTerms) {
      matched.add(term);
    }
    reasonParts.push(`document matched ${documentMatchedTerms.join(", ")}`);
  }

  const coverage = query.terms.length === 0 ? 0 : matched.size / query.terms.length;

  return {
    memory,
    score,
    coverage,
    eventScore,
    specificScore,
    matchedTerms: [...matched],
    reason:
      matched.size > 0
        ? [`Matched ${[...matched].join(", ")}.`, ...reasonParts].join(" ")
        : `No searchable field matched.`
  };
}

function mergeRepositoryCandidates(
  result: InternalMemorySearchResult,
  candidates: RetrievalCandidate[],
  query: SearchQueryAnalysis
): InternalMemorySearchResult {
  if (candidates.length === 0) {
    return result;
  }

  const matched = new Set(result.matchedTerms);
  let score = result.score;
  let specificScore = result.specificScore;
  const reasonParts: string[] = [];

  for (const candidate of candidates) {
    const newTerms = candidate.matchedTerms.filter((term) => !matched.has(term));
    if (newTerms.length === 0) {
      continue;
    }

    const weightedScore = candidate.score * retrievalSourceWeight(candidate.source);
    score += weightedScore;
    specificScore += weightedScore;
    for (const term of newTerms) {
      matched.add(term);
    }
    reasonParts.push(`${candidate.source} matched ${newTerms.join(", ")}`);
  }

  if (reasonParts.length === 0) {
    return result;
  }

  return {
    ...result,
    score,
    specificScore,
    coverage: query.terms.length === 0 ? 0 : matched.size / query.terms.length,
    matchedTerms: [...matched],
    reason: [result.reason, ...reasonParts].join(" ")
  };
}

function groupRetrievalCandidates(candidates: RetrievalCandidate[]): Map<string, RetrievalCandidate[]> {
  const grouped = new Map<string, RetrievalCandidate[]>();
  for (const candidate of candidates) {
    grouped.set(candidate.memoryId, [...(grouped.get(candidate.memoryId) ?? []), candidate]);
  }
  return grouped;
}

function retrievalSourceWeight(source: RetrievalCandidate["source"]): number {
  if (source === "document_lexical") {
    return 0.6;
  }
  if (source === "fts") {
    return 0.8;
  }
  if (source === "embedding") {
    return 0.7;
  }
  return 1;
}

function analyzeSearchQuery(rawQuery: string): SearchQueryAnalysis {
  const normalizedQuery = normalizeMemorySearchQuery(rawQuery);
  const termSource = normalizedQuery.length > 0 ? normalizedQuery : rawQuery;
  const terms = extractTags(termSource)
    .map((term) => normalizeSearchText(term))
    .filter((term) => term.length > 0 && !GENERIC_QUERY_TERMS.has(term));

  return {
    terms,
    isEventWide: /\b(who|show|list|everyone|all)\b.*\b(i\s+)?(met|meet|saved)\b/i.test(rawQuery),
    isListAll: isListPeopleRecall(rawQuery)
  };
}

/** Removes recall phrasing that carries intent but should not count as lexical memory clues. */
export function normalizeMemorySearchQuery(raw: string): string {
  const seen = new Set<string>();
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term) => !GENERIC_MEMORY_QUERY_TERMS.has(term))
    .filter((term) => {
      if (seen.has(term)) {
        return false;
      }
      seen.add(term);
      return true;
    })
    .join(" ");
}

function selectSearchResults(results: InternalMemorySearchResult[], query: SearchQueryAnalysis): InternalMemorySearchResult[] {
  if (query.isEventWide) {
    return results.slice(0, 10);
  }

  const covered = results.filter((result) => result.coverage >= minimumCoverage(query.terms.length));

  if (covered.length <= 1) {
    return covered;
  }

  const [top, second] = covered;
  // A 6-point gap means the winner is clearly ahead on field-weight totals; collapse to one
  // answer instead of asking the user to disambiguate near-ties (same threshold as agentCore).
  if (top.specificScore > 0 && top.score - second.score >= 6) {
    return [top];
  }

  return covered.slice(0, 3);
}

function stripInternalScores(result: InternalMemorySearchResult): MemorySearchResult {
  return {
    memory: result.memory,
    score: result.score,
    reason: result.reason
  };
}

/**
 * Minimum fraction of query terms that must match before a memory is returned.
 *
 * Single-term queries require full coverage; multi-term queries allow 50% so partial clues like
 * "CMU designer" still match when only one token hits, while unrelated one-token overlaps drop out.
 */
function minimumCoverage(termCount: number): number {
  if (termCount <= 1) {
    return 1;
  }

  return 0.5;
}

function scoreSpecificField(field: string, term: string, weight: number): number {
  return fieldIncludes(field, term) ? weight : 0;
}

function fieldIncludes(field: string, term: string): boolean {
  return searchTokens(field).has(term);
}

function searchTokens(value: string): Set<string> {
  return new Set(extractTags(value).map((token) => normalizeSearchText(token)).filter(Boolean));
}

function normalizeSearchText(value: string): string {
  const lower = value.toLowerCase();
  const irregular: Record<string, string> = {
    slept: "sleep"
  };

  if (irregular[lower]) {
    return irregular[lower];
  }

  return lower.replace(/ing$/, "").replace(/ed$/, "").replace(/s$/, "");
}

function extractMemorySearchFields(memory: RelationshipMemory) {
  const labels = extractLabeledContext(memory.contextNote);

  return {
    name: memory.displayName,
    event: [memory.eventTitle ?? "", labels.event].join(" "),
    role: labels.role,
    project: labels.project,
    school: [labels.school, labels.classYear].join(" "),
    alias: labels.alias,
    context: [labels.context, memory.relationshipContext ?? ""].join(" "),
    tags: memory.tags.join(" ")
  };
}

function extractLabeledContext(contextNote: string) {
  const fields = {
    event: "",
    role: "",
    project: "",
    school: "",
    classYear: "",
    alias: "",
    context: ""
  };

  for (const part of contextNote.split("|")) {
    const trimmed = part.trim();
    const match = trimmed.match(/^([a-z /]+):\s*(.+)$/i);

    if (!match) {
      fields.context = [fields.context, trimmed].filter(Boolean).join(" ");
      continue;
    }

    const [, label, value] = match;
    const normalizedLabel = label.toLowerCase();

    if (normalizedLabel === "event") {
      fields.event = [fields.event, value].filter(Boolean).join(" ");
    } else if (normalizedLabel === "role") {
      fields.role = [fields.role, value].filter(Boolean).join(" ");
    } else if (normalizedLabel === "project") {
      fields.project = [fields.project, value].filter(Boolean).join(" ");
    } else if (normalizedLabel === "school/company") {
      fields.school = [fields.school, value].filter(Boolean).join(" ");
    } else if (normalizedLabel === "class year") {
      fields.classYear = [fields.classYear, value].filter(Boolean).join(" ");
    } else if (normalizedLabel === "alias") {
      fields.alias = [fields.alias, value].filter(Boolean).join(" ");
    } else {
      fields.context = [fields.context, value].filter(Boolean).join(" ");
    }
  }

  return fields;
}

const GENERIC_QUERY_TERMS = new Set([
  "build",
  "building",
  "find",
  "go",
  "goe",
  "make",
  "making",
  "meet",
  "met",
  "remember",
  "search",
  "show",
  "work",
  "working"
]);

const GENERIC_MEMORY_QUERY_TERMS = new Set([
  "anyone",
  "anybody",
  "any",
  "people",
  "person",
  "someone",
  "somebody",
  "contact",
  "contacts",
  "related",
  "connected",
  "connection",
  "associated",
  "associate",
  "association",
  "about",
  "relevant",
  "that",
  "my",
  "mine",
  "in",
  "to",
  "with",
  "from",
  "who",
  "which",
  "find",
  "give",
  "show",
  "list",
  "tell",
  "did",
  "do",
  "i",
  "me",
  "add",
  "added",
  "save",
  "saved",
  "have",
  "know",
  "all",
  "every",
  "everyone",
  "everybody",
  "just",
  "so",
  "far",
  "while",
  "during",
  "was",
  "is",
  "the"
]);
