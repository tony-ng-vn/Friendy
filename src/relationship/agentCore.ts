import type { AgentCoreResult, AgentToolCall, InboundAgentMessage } from "./types";
import type { MemorySearchResult, createRelationshipTools } from "./tools";

type RelationshipTools = ReturnType<typeof createRelationshipTools>;

export function createRelationshipAgent(tools: RelationshipTools) {
  return {
    handleMessage(message: InboundAgentMessage): AgentCoreResult {
      const normalized = message.text.trim();
      const lower = normalized.toLowerCase();
      const toolCalls: AgentToolCall[] = [];

      if (isConfirmationReply(lower)) {
        toolCalls.push("list_pending_candidates");
        const candidates = tools.list_pending_candidates(message.userId);
        const candidate = candidates[0];

        if (!candidate) {
          return reply(message, "I do not see a pending contact to confirm.", toolCalls);
        }

        const contextNote = cleanConfirmationNote(normalized);
        toolCalls.push("confirm_candidate");
        const memory = tools.confirm_candidate(message.userId, candidate.id, contextNote);

        return reply(
          message,
          `Saved. I'll remember ${memory.displayName} from ${memory.eventTitle ?? "that context"} as "${memory.contextNote}".`,
          toolCalls
        );
      }

      if (lower.startsWith("ignore")) {
        toolCalls.push("list_pending_candidates");
        const candidates = tools.list_pending_candidates(message.userId);
        const candidate = candidates[0];
        if (!candidate) {
          return reply(message, "I do not see a pending contact to ignore.", toolCalls);
        }

        toolCalls.push("ignore_candidate");
        tools.ignore_candidate(message.userId, candidate.id);
        return reply(message, `Ignored ${candidate.displayName}.`, toolCalls);
      }

      if (looksLikeManualMemory(lower)) {
        const parsed = parseManualMemory(normalized);
        toolCalls.push("create_manual_memory");
        const memory = tools.create_manual_memory(message.userId, parsed.name, parsed.contextNote, parsed.contactMethod);
        return reply(message, `Saved. I'll remember ${memory.displayName} as "${memory.contextNote}".`, toolCalls);
      }

      toolCalls.push("search_memories");
      const matches = tools.search_memories(message.userId, normalized);

      if (matches.length === 0) {
        return reply(
          message,
          "I do not have a confident match yet. Give me a name, event, date, or context you remember.",
          toolCalls
        );
      }

      if (isAmbiguous(matches)) {
        const names = matches.slice(0, 2).map((match) => `${match.memory.displayName} from ${match.memory.eventTitle}`);
        return reply(message, `I found two possible matches: ${names.join(" and ")}. Which dinner do you mean?`, toolCalls);
      }

      const top = matches[0];
      return reply(
        message,
        `Likely ${top.memory.displayName}. ${top.reason} Contact: ${top.memory.primaryContactLabel}.`,
        toolCalls
      );
    }
  };
}

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

function isConfirmationReply(value: string): boolean {
  return value === "yes" || value.startsWith("yes,") || value.startsWith("yep") || value.startsWith("yeah");
}

function cleanConfirmationNote(value: string): string {
  return value.replace(/^(yes|yep|yeah)\s*,?\s*/i, "").trim() || "met at event";
}

function looksLikeManualMemory(value: string): boolean {
  return value.startsWith("met ") || value.startsWith("remember ");
}

function parseManualMemory(value: string) {
  const cleaned = value.replace(/^(met|remember)\s+/i, "");
  const [namePart, ...contextParts] = cleaned.split(",");
  return {
    name: namePart.trim(),
    contextNote: contextParts.join(",").trim() || "manual memory",
    contactMethod: undefined
  };
}

function isAmbiguous(matches: MemorySearchResult[]): boolean {
  if (matches.length < 2) {
    return false;
  }
  return matches[0].score - matches[1].score <= 2;
}
