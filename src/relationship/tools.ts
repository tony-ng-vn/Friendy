import { randomUUID } from "node:crypto";
import { extractTags, type RelationshipRepository } from "./repository";
import type { CalendarEvent, ContactCandidateDetected, RelationshipDateContext, RelationshipMemory } from "./types";

/** Search hit with diagnostic explanation text for logs and tests, not direct user-facing copy. */
export type MemorySearchResult = {
  memory: RelationshipMemory;
  score: number;
  reason: string;
};

type SearchQueryAnalysis = {
  terms: string[];
  isEventWide: boolean;
};

type InternalMemorySearchResult = MemorySearchResult & {
  coverage: number;
  eventScore: number;
  specificScore: number;
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

      const scored = repo
        .listMemories(userId)
        .map((memory) => scoreMemory(memory, queryAnalysis))
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
      options: { eventTitle?: string; dateContext?: RelationshipDateContext } = {}
    ) {
      const manualId = randomUUID();
      const candidate = repo.createCandidateFromDetectedContact({
        userId,
        displayName: name,
        phoneNumbers: [contactMethod],
        emails: [],
        detectedAt: new Date(Date.now()).toISOString(),
        source: "manual",
        contactIdentifier: `manual:${manualId}`
      });

      return repo.confirmCandidate(candidate.id, contextNote, undefined, {
        eventTitle: options.eventTitle,
        dateContext: options.dateContext
      });
    }
  };
}

/**
 * Scores memories with deterministic field-aware matching for the MVP.
 *
 * Specific person facts such as role, project, school, and context need to outrank generic shared
 * event words. Event-wide "who did I meet" searches are the exception: those intentionally return
 * every matching event memory instead of collapsing to one top person.
 */
function scoreMemory(memory: RelationshipMemory, query: SearchQueryAnalysis): InternalMemorySearchResult {
  const fields = extractMemorySearchFields(memory);
  const matched = new Set<string>();
  let score = 0;
  let eventScore = 0;
  let specificScore = 0;

  for (const term of query.terms) {
    const eventMatch = fieldIncludes(fields.event, term);
    if (eventMatch) {
      const weight = query.isEventWide ? 8 : 1;
      score += weight;
      eventScore += weight;
      matched.add(term);
    }

    const nameScore = scoreSpecificField(fields.name, term, 12);
    const roleScore = scoreSpecificField(fields.role, term, 10);
    const projectScore = scoreSpecificField(fields.project, term, 9);
    const schoolScore = scoreSpecificField(fields.school, term, 10);
    const aliasScore = scoreSpecificField(fields.alias, term, 7);
    const tagScore = scoreSpecificField(fields.tags, term, 4);
    const contextScore = eventMatch ? 0 : scoreSpecificField(fields.context, term, 5);
    const termSpecificScore = nameScore + roleScore + projectScore + schoolScore + aliasScore + tagScore + contextScore;

    if (termSpecificScore > 0) {
      score += termSpecificScore;
      specificScore += termSpecificScore;
      matched.add(term);
    }
  }

  const coverage = query.terms.length === 0 ? 0 : matched.size / query.terms.length;

  return {
    memory,
    score,
    coverage,
    eventScore,
    specificScore,
    reason: matched.size > 0 ? `Matched ${[...matched].join(", ")}.` : `No searchable field matched.`
  };
}

function analyzeSearchQuery(rawQuery: string): SearchQueryAnalysis {
  const terms = extractTags(rawQuery)
    .map((term) => normalizeSearchText(term))
    .filter((term) => term.length > 0 && !GENERIC_QUERY_TERMS.has(term));

  return {
    terms,
    isEventWide: /\b(who|show|list|everyone|all)\b.*\b(i\s+)?(met|meet|saved)\b/i.test(rawQuery)
  };
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
