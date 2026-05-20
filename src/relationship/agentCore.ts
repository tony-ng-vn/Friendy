import type { AgentCoreResult, AgentToolCall, InboundAgentMessage } from "./types";
import type { MemorySearchResult, createRelationshipTools } from "./tools";
import { isConfirmationReply, resolveCandidateConfirmation } from "./candidateConfirmation";
import {
  composeIgnoreCandidateReply,
  composeNoMatchReply,
  composeSaveConfirmation,
  composeSearchReply
} from "./responseComposer";

type RelationshipTools = ReturnType<typeof createRelationshipTools>;

/**
 * Creates the first relationship memory agent.
 *
 * This is a deterministic router around explicit tools, not a fully autonomous LLM loop yet.
 * That keeps the MVP debuggable while we prove the capture-confirm-search workflow.
 */
export function createRelationshipAgent(tools: RelationshipTools) {
  return {
    handleMessage(message: InboundAgentMessage): AgentCoreResult {
      const normalized = message.text.trim();
      const lower = normalized.toLowerCase();
      const toolCalls: AgentToolCall[] = [];

      if (isConfirmationReply(normalized)) {
        toolCalls.push("list_pending_candidates");
        const candidates = tools.list_pending_candidates(message.userId);
        const candidate = candidates[0];

        if (!candidate) {
          return reply(message, "I do not see a pending contact to confirm.", toolCalls);
        }

        toolCalls.push("list_candidate_event_matches");
        const eventMatches = tools.list_candidate_event_matches(message.userId, candidate.id);
        const confirmation = resolveCandidateConfirmation(normalized, eventMatches);
        toolCalls.push("confirm_candidate");
        const memory = tools.confirm_candidate(message.userId, candidate.id, confirmation.contextNote, confirmation.eventId, {
          eventTitle: confirmation.eventTitle
        });

        return reply(
          message,
          composeSaveConfirmation({ memories: [memory] }),
          toolCalls
        );
      }

      if (lower.startsWith("ignore")) {
        toolCalls.push("list_pending_candidates");
        const candidates = tools.list_pending_candidates(message.userId);
        const candidate = candidates[0];
        if (!candidate) {
          return reply(message, composeIgnoreCandidateReply(), toolCalls);
        }

        toolCalls.push("ignore_candidate");
        tools.ignore_candidate(message.userId, candidate.id);
        return reply(message, composeIgnoreCandidateReply({ candidateName: candidate.displayName }), toolCalls);
      }

      if (looksLikeManualMemory(lower)) {
        const parsed = parseManualMemory(normalized);
        toolCalls.push("create_manual_memory");
        const memory = tools.create_manual_memory(message.userId, parsed.name, parsed.contextNote, parsed.contactMethod);
        return reply(message, composeSaveConfirmation({ memories: [memory] }), toolCalls);
      }

      toolCalls.push("search_memories");
      const matches = tools.search_memories(message.userId, normalized);

      if (matches.length === 0) {
        return reply(message, composeNoMatchReply(), toolCalls);
      }

      if (!isEventWideRecallQuery(normalized) && isAmbiguous(matches)) {
        return reply(message, composeSearchReply({ matches: matches.slice(0, 2), ambiguous: true }), toolCalls);
      }

      const top = matches[0];
      return reply(message, composeSearchReply({ matches: [top] }), toolCalls);
    }
  };
}

/** Builds the proactive iMessage prompt shown after a new contact is mapped to event context. */
export function buildCandidateReviewPrompt(name: string, eventTitle?: string): string {
  if (eventTitle) {
    return `I noticed you added ${name} during ${eventTitle}. Did you meet ${name} there?`;
  }

  return `I noticed you added ${name}. Where did you meet them?`;
}

function reply(message: InboundAgentMessage, text: string, toolCalls: AgentToolCall[]): AgentCoreResult {
  return {
    outbound: {
      userId: message.userId,
      platform: message.platform,
      spaceId: message.spaceId,
      text
    },
    toolCalls
  };
}

function looksLikeManualMemory(value: string): boolean {
  return (
    value.startsWith("met ") ||
    value.startsWith("remember ") ||
    value.startsWith("i met ") ||
    value.startsWith("i remember ")
  );
}

function parseManualMemory(value: string) {
  const cleaned = value.replace(/^(i\s+)?(met|remember)\s+/i, "").trim();
  const [namePart, ...contextParts] = splitManualMemory(cleaned);

  return {
    name: namePart.trim(),
    contextNote: contextParts.join(",").trim() || "manual memory",
    contactMethod: undefined
  };
}

function splitManualMemory(value: string): string[] {
  const [beforeComma, ...afterCommaParts] = value.split(",");
  const afterComma = afterCommaParts.join(",").trim();
  const eventMatch = beforeComma.match(/^(.+?)\s+(at|during|from)\s+(.+)$/i);

  if (!eventMatch) {
    return [beforeComma, afterComma].filter(Boolean);
  }

  const [, name, preposition, eventContext] = eventMatch;
  // Preserve the event phrase as context so later vague searches can match where the user met them.
  const context = [`${preposition} ${eventContext}`, afterComma].filter(Boolean).join(", ");

  return [name, context];
}

function isAmbiguous(matches: MemorySearchResult[]): boolean {
  if (matches.length < 2) {
    return false;
  }
  // Close scores mean the agent should ask a narrowing question instead of pretending certainty.
  return matches[0].score - matches[1].score <= 6;
}

function isEventWideRecallQuery(text: string): boolean {
  return /\b(who|show|list|everyone|all)\b.*\b(i\s+)?(met|meet|saved)\b/i.test(text);
}
