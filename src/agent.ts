import { fixtureContactDelta } from "./mockData";
import {
  approveSession,
  confirmCandidate,
  extractTags,
  ignoreCandidate,
  loadContactDelta,
  type MemoryState
} from "./memoryStore";
import type { RelationshipMemory } from "./types";

export type AgentResult = {
  state: MemoryState;
  reply: string;
};

export type MemoryMatch = {
  memory: RelationshipMemory;
  score: number;
  reason: string;
};

export function handleAgentMessage(state: MemoryState, rawInput: string): AgentResult {
  const input = rawInput.trim();
  const lower = input.toLowerCase();
  const suggestedSession = state.sessions.find((session) => session.status === "suggested");

  if (lower === "start" && suggestedSession) {
    return {
      state,
      reply: `You have ${suggestedSession.title} tonight from 7-11 PM. Want me to remember new people you meet there?`
    };
  }

  if ((lower === "yes" || lower.includes("start tracking")) && suggestedSession) {
    const approved = approveSession(state, suggestedSession.calendarEventId ?? "");
    const withDelta = loadContactDelta(approved, fixtureContactDelta);
    return {
      state: withDelta,
      reply: `I found ${withDelta.candidates.length} new contacts since ${suggestedSession.title} started: ${withDelta.candidates
        .map((candidate) => candidate.displayName)
        .join(", ")}. Reply like "save Maya: played piano, AI recruiting founder" or "ignore Alex".`
    };
  }

  if (lower.startsWith("save ")) {
    return saveCandidateFromMessage(state, input);
  }

  if (lower.startsWith("ignore ")) {
    const name = lower.replace("ignore ", "").trim();
    const candidate = state.candidates.find((item) => item.displayName.toLowerCase().includes(name));
    if (!candidate) {
      return { state, reply: `I could not find a pending candidate for "${name}".` };
    }

    return {
      state: ignoreCandidate(state, candidate.id),
      reply: `Ignored ${candidate.displayName}.`
    };
  }

  const matches = searchMemories(state, input);
  if (matches.length === 0) {
    return {
      state,
      reply: "I do not have a confident match yet. Try a name, event, time, or context like piano, recruiting, or dinner."
    };
  }

  const top = matches[0];
  return {
    state,
    reply: `Likely ${top.memory.displayName}. ${top.reason} Contact: ${top.memory.contactLabel}.`
  };
}

function saveCandidateFromMessage(state: MemoryState, input: string): AgentResult {
  const match = input.match(/^save\s+([^:]+):\s*(.+)$/i);
  if (!match) {
    return {
      state,
      reply: 'Use this format: "save Maya: played piano, AI recruiting founder".'
    };
  }

  const [, nameFragment, contextNote] = match;
  const candidate = state.candidates.find((item) =>
    item.displayName.toLowerCase().includes(nameFragment.trim().toLowerCase())
  );

  if (!candidate) {
    return {
      state,
      reply: `I could not find a pending candidate for "${nameFragment.trim()}".`
    };
  }

  const next = confirmCandidate(state, candidate.id, contextNote.trim());
  return {
    state: next,
    reply: `Saved ${candidate.displayName}. I will remember: ${contextNote.trim()}.`
  };
}

export function searchMemories(state: MemoryState, query: string): MemoryMatch[] {
  const queryTags = extractTags(query);

  return state.memories
    .map((memory) => {
      const haystack = [memory.displayName, memory.eventTitle ?? "", memory.contextNote, memory.tags.join(" ")]
        .join(" ")
        .toLowerCase();

      const matchingTags = queryTags.filter((tag) => haystack.includes(tag));
      const eventBoost = memory.eventTitle && query.toLowerCase().includes("dinner") ? 2 : 0;
      const score = matchingTags.length * 3 + eventBoost;

      return {
        memory,
        score,
        reason:
          matchingTags.length > 0
            ? `Your saved note says "${memory.contextNote}" and matched: ${matchingTags.join(", ")}.`
            : `This was saved from ${memory.eventTitle ?? "an event"}.`
      };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
