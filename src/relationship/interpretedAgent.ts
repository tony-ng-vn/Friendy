import { buildSearchQueryFromInterpretation, type MessageInterpretation } from "./interpretation";
import { isConfirmationReply } from "./candidateConfirmation";
import { createCandidateIntake, type CandidateIgnoreResult, type CandidateReplyResult } from "./candidateIntake";
import type { MessageInterpreter } from "./openRouterInterpreter";
import type { RelationshipRepository } from "./repository";
import {
  composeCandidateAmbiguityReply,
  composeClarificationReply,
  composeIgnoreCandidateReply,
  composeNoMatchReply,
  composeNoPendingCandidateReply,
  composeSaveConfirmation,
  composeSearchReply
} from "./responseComposer";
import { parseTemporalContext, type TemporalContext } from "./temporalContext";
import type { MemorySearchResult, createRelationshipTools } from "./tools";
import type { AgentCoreResult, AgentInteraction, AgentToolCall, InboundAgentMessage } from "./types";

type RelationshipTools = ReturnType<typeof createRelationshipTools>;
type CandidateIntake = ReturnType<typeof createCandidateIntake>;

type InterpretedRelationshipAgentOptions = {
  repo: RelationshipRepository;
  tools: RelationshipTools;
  interpreter: MessageInterpreter;
  now?: () => string;
  timezone?: string;
};

type InterpretedAgentResult = AgentCoreResult & {
  interaction: AgentInteraction;
};

type ConversationContext = {
  activeEventName?: string;
  activeDateContext?: TemporalContext;
  recentPeople: string[];
};

/**
 * Creates the LLM-interpreted relationship agent.
 *
 * The interpreter can classify messy text, but deterministic tools remain the only layer that
 * creates, ignores, or searches memories. This keeps model mistakes observable and reversible.
 */
export function createInterpretedRelationshipAgent({
  repo,
  tools,
  interpreter,
  now = () => new Date().toISOString(),
  timezone = "UTC"
}: InterpretedRelationshipAgentOptions) {
  const conversationContexts = new Map<string, ConversationContext>();
  const candidateIntake = createCandidateIntake({ tools });

  return {
    async handleMessage(message: InboundAgentMessage): Promise<InterpretedAgentResult> {
      const startedAt = Date.now();
      const interpreted = await interpreter.interpret(message);
      const existingContext = conversationContexts.get(message.userId) ?? { recentPeople: [] };
      const interpretation = enrichInterpretationWithContext(
        interpreted.interpretation,
        existingContext,
        parseTemporalContext(message.text, { receivedAt: message.receivedAt, timezone }),
        message.text
      );
      const toolCalls: AgentToolCall[] = [];
      const outboundText = executeInterpretation(message, interpretation, tools, candidateIntake, toolCalls);
      conversationContexts.set(message.userId, updateConversationContext(existingContext, interpretation));

      const interaction = repo.addInteraction({
        id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
        userId: message.userId,
        platform: message.platform,
        spaceId: message.spaceId,
        inboundText: message.text,
        interpretedIntentJson: interpretation,
        outboundText,
        toolCalls,
        modelUsed: interpreted.modelUsed,
        confidence: interpretation.confidence,
        latencyMs: Date.now() - startedAt,
        error: interpreted.error,
        createdAt: now()
      });

      return {
        outbound: {
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          text: outboundText
        },
        toolCalls,
        interaction
      };
    }
  };
}

function executeInterpretation(
  message: InboundAgentMessage,
  interpretation: MessageInterpretation,
  tools: RelationshipTools,
  candidateIntake: CandidateIntake,
  toolCalls: AgentToolCall[]
): string {
  if (isConfirmationReply(message.text)) {
    return confirmPendingCandidate(message, candidateIntake, toolCalls);
  }

  if (interpretation.needsClarification || interpretation.intent === "clarify") {
    return composeClarificationReply(interpretation.clarificationQuestion);
  }

  if (interpretation.intent === "capture_memory") {
    return captureMemories(message, interpretation, tools, toolCalls);
  }

  if (interpretation.intent === "search_memory") {
    return searchMemories(message, interpretation, tools, toolCalls);
  }

  if (interpretation.intent === "ignore_candidate") {
    return ignorePendingCandidate(message, interpretation, candidateIntake, toolCalls);
  }

  return composeNoMatchReply();
}

function captureMemories(
  message: InboundAgentMessage,
  interpretation: MessageInterpretation,
  tools: RelationshipTools,
  toolCalls: AgentToolCall[]
): string {
  const memories = interpretation.people.map((person) => {
    const note = buildMemoryNote(interpretation, person);
    toolCalls.push("create_manual_memory");
    return tools.create_manual_memory(message.userId, person.name, note, "manual contact", {
      eventTitle: interpretation.event.name || undefined,
      dateContext: interpretation.dateContext
    });
  });

  if (memories.length === 1) {
    return composeSaveConfirmation({ memories });
  }

  return composeSaveConfirmation({ memories });
}

function searchMemories(
  message: InboundAgentMessage,
  interpretation: MessageInterpretation,
  tools: RelationshipTools,
  toolCalls: AgentToolCall[]
): string {
  toolCalls.push("search_memories");
  const query = buildSearchQueryFromInterpretation(interpretation) || message.text;
  const matches = tools.search_memories(message.userId, query);

  if (matches.length === 0) {
    return composeNoMatchReply();
  }

  return composeSearchReply({ matches, ambiguous: !isEventWideRecallQuery(message.text) && isAmbiguous(matches) });
}

function confirmPendingCandidate(
  message: InboundAgentMessage,
  candidateIntake: CandidateIntake,
  toolCalls: AgentToolCall[]
): string {
  toolCalls.push("list_pending_candidates");
  const result = candidateIntake.resolveCandidateReply({
    scope: message,
    replyText: message.text
  });
  recordCandidateReplyToolCalls(result, toolCalls);

  return composeCandidateReply(result);
}

function ignorePendingCandidate(
  message: InboundAgentMessage,
  interpretation: MessageInterpretation,
  candidateIntake: CandidateIntake,
  toolCalls: AgentToolCall[]
): string {
  toolCalls.push("list_pending_candidates");
  const result = candidateIntake.ignoreCandidate({ scope: message, candidateName: ignoreCandidateName(interpretation) });
  recordCandidateIgnoreToolCalls(result, toolCalls);
  return composeCandidateIgnoreReply(result);
}

function ignoreCandidateName(interpretation: MessageInterpretation): string | undefined {
  return interpretation.people[0]?.name || interpretation.query || undefined;
}

function recordCandidateReplyToolCalls(result: CandidateReplyResult, toolCalls: AgentToolCall[]): void {
  if (result.kind === "confirmed") {
    toolCalls.push("list_candidate_event_matches", "confirm_candidate");
  }
}

function recordCandidateIgnoreToolCalls(result: CandidateIgnoreResult, toolCalls: AgentToolCall[]): void {
  if (result.kind === "ignored") {
    toolCalls.push("ignore_candidate");
  }
}

function composeCandidateReply(result: CandidateReplyResult): string {
  if (result.kind === "confirmed") {
    return composeSaveConfirmation({ memories: [result.memory] });
  }

  if (result.kind === "ambiguous") {
    return composeCandidateAmbiguityReply({ candidates: result.candidates });
  }

  return composeNoPendingCandidateReply();
}

function composeCandidateIgnoreReply(result: CandidateIgnoreResult): string {
  if (result.kind === "ignored") {
    return composeIgnoreCandidateReply({ candidateName: result.displayName });
  }

  return composeIgnoreCandidateReply();
}

function buildMemoryNote(
  interpretation: MessageInterpretation,
  person: MessageInterpretation["people"][number]
): string {
  const details = [
    interpretation.event.name ? `event: ${interpretation.event.name}` : "",
    interpretation.dateContext ? `date: ${interpretation.dateContext.rawText} (${interpretation.dateContext.localDate})` : "",
    interpretation.contextNote,
    person.aliases.length > 0 ? `alias: ${person.aliases.join(", ")}` : "",
    person.companyOrSchool ? `school/company: ${person.companyOrSchool}` : "",
    person.classYear ? `class year: ${person.classYear}` : "",
    person.project ? `project: ${person.project}` : "",
    person.role ? `role: ${person.role}` : ""
  ];

  return details.map((detail) => detail.trim()).filter(Boolean).join(" | ");
}

function enrichInterpretationWithContext(
  interpretation: MessageInterpretation,
  context: ConversationContext,
  dateContext: TemporalContext | undefined,
  rawText: string
): MessageInterpretation {
  if (interpretation.intent !== "capture_memory") {
    return interpretation;
  }

  const shouldCarryContext = /\balso\b/i.test(rawText) || hasRecentPersonReference(rawText, context.recentPeople);

  return {
    ...interpretation,
    event: {
      ...interpretation.event,
      name: interpretation.event.name || (shouldCarryContext ? context.activeEventName ?? "" : "")
    },
    dateContext: dateContext ?? interpretation.dateContext ?? (shouldCarryContext ? context.activeDateContext : undefined)
  };
}

function updateConversationContext(
  context: ConversationContext,
  interpretation: MessageInterpretation
): ConversationContext {
  if (interpretation.intent !== "capture_memory") {
    return context;
  }

  return {
    activeEventName: interpretation.event.name || context.activeEventName,
    activeDateContext: interpretation.dateContext ?? context.activeDateContext,
    recentPeople: [...context.recentPeople, ...interpretation.people.map((person) => person.name)].slice(-10)
  };
}

function hasRecentPersonReference(text: string, recentPeople: string[]): boolean {
  const normalized = text.toLowerCase();
  return recentPeople.some((name) => normalized.includes(name.toLowerCase()));
}

function isAmbiguous(matches: MemorySearchResult[]): boolean {
  if (matches.length < 2) {
    return false;
  }

  return matches[0].score - matches[1].score <= 6;
}

function isEventWideRecallQuery(text: string): boolean {
  return /\b(who|show|list|everyone|all)\b.*\b(i\s+)?(met|meet|saved)\b/i.test(text);
}
