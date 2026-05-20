import { extractTags, type RelationshipRepository } from "./repository";
import type { ContactCandidateDetected, RelationshipMemory } from "./types";

/** Search hit with explanation text the agent can show directly to the user. */
export type MemorySearchResult = {
  memory: RelationshipMemory;
  score: number;
  reason: string;
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

    search_memories(userId: string, query: string): MemorySearchResult[] {
      const queryTags = extractTags(query);

      return repo
        .listMemories(userId)
        .map((memory) => scoreMemory(memory, queryTags, query))
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    },

    list_pending_candidates(userId: string) {
      return repo.listPendingCandidates(userId);
    },

    get_candidate(_userId: string, candidateId: string) {
      return repo.getCandidate(candidateId);
    },

    confirm_candidate(userId: string, candidateId: string, contextNote: string, eventId?: string) {
      const candidate = repo.getCandidate(candidateId);
      if (!candidate || candidate.userId !== userId) {
        throw new Error(`Candidate not found for user: ${candidateId}`);
      }
      return repo.confirmCandidate(candidateId, contextNote, eventId);
    },

    ignore_candidate(userId: string, candidateId: string) {
      const candidate = repo.getCandidate(candidateId);
      if (!candidate || candidate.userId !== userId) {
        throw new Error(`Candidate not found for user: ${candidateId}`);
      }
      repo.ignoreCandidate(candidateId);
      return { ignored: true };
    },

    create_manual_memory(userId: string, name: string, contextNote: string, contactMethod = "manual contact") {
      const memory: RelationshipMemory = {
        id: `memory_manual_${Date.now()}`,
        userId,
        displayName: name,
        primaryContactLabel: contactMethod,
        contextNote,
        tags: extractTags(contextNote),
        confidence: 0.6,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      return repo.addMemory(memory);
    }
  };
}

/**
 * Scores memories with deterministic lexical matching for the MVP.
 *
 * The goal is explainable "why this person" behavior before adding embeddings or an LLM reranker.
 */
function scoreMemory(memory: RelationshipMemory, queryTags: string[], rawQuery: string): MemorySearchResult {
  const haystack = [memory.displayName, memory.eventTitle ?? "", memory.contextNote, memory.tags.join(" ")]
    .join(" ")
    .toLowerCase();
  const matched = queryTags.filter((tag) => haystack.includes(tag));
  // Demo-specific event boost keeps vague dinner searches useful until event-term extraction is generalized.
  const eventBoost = memory.eventTitle && rawQuery.toLowerCase().includes("dinner") ? 2 : 0;
  const score = matched.length * 3 + eventBoost;

  return {
    memory,
    score,
    reason:
      matched.length > 0
        ? `Your saved note says "${memory.contextNote}" and matched: ${matched.join(", ")}.`
        : `This matched the event "${memory.eventTitle ?? "unknown"}".`
  };
}
