/**
 * LLM-interpreted relationship agent with interaction logging.
 *
 * Callers: production transports and eval harnesses.
 *
 * Wraps {@link createInterpretedRelationshipAgent} — see that factory for carryover,
 * MIN_CAPTURE_CONFIDENCE, and AgentInteraction persistence details.
 */
import { createHash } from "node:crypto";
import { buildSearchQueryFromInterpretation, type MessageInterpretation } from "./interpretation";
import { isConfirmationReply } from "./candidateConfirmation";
import { createCandidateIntake, type CandidateIgnoreResult, type CandidateReplyResult } from "./candidateIntake";
import { detectOnboardingControl, type OnboardingStateController } from "./onboardingState";
import type { MessageInterpreter } from "./openRouterInterpreter";
import type { RelationshipRepository } from "./repository";
import {
  composeCandidateAmbiguityReply,
  composeClarificationReply,
  composeIgnoreCandidateReply,
  composeMemoryDeleteReply,
  composeMemoryUpdateReply,
  composeNoMatchReply,
  composeNoPendingCandidateReply,
  composePendingCandidateInquiryReply,
  composeOnboardingControlReply,
  composeSaveConfirmation,
  composeSearchReply
} from "./responseComposer";
import { decideMessageScope, isPendingCandidateInquiry, type ScopeDecision } from "./scopeBoundary";
import { parseTemporalContext, type TemporalContext } from "./temporalContext";
import type { MemorySearchResult, createRelationshipTools } from "./tools";
import { buildRedactedInteractionTrace, type AgentTrace } from "./runtime/runtimeTrace";
import type { AgentCoreResult, AgentInteraction, AgentToolCall, InboundAgentMessage, RelationshipMemory } from "./types";

type RelationshipTools = ReturnType<typeof createRelationshipTools>;
type CandidateIntake = ReturnType<typeof createCandidateIntake>;
type MemoryMutationRequest =
  | { kind: "delete"; query: string }
  | { kind: "update"; query?: string; contextNote: string };
type SearchContext = {
  searchContextId: string;
  createdAt: string;
  expiresAt: string;
  originalQuery: string;
  candidateMemoryIds: string[];
  lastQuestion: string;
};

/** Injectable dependencies for the interpreted agent, including optional clock and timezone. */
type InterpretedRelationshipAgentOptions = {
  repo: RelationshipRepository;
  tools: RelationshipTools;
  interpreter: MessageInterpreter;
  onboarding?: OnboardingStateController;
  now?: () => string;
  timezone?: string;
};

/** Agent result plus the persisted interaction row for this turn. */
type InterpretedAgentResult = AgentCoreResult & {
  interaction: AgentInteraction;
};

/**
 * Per-user conversation state for multi-turn capture without re-asking event/date context.
 *
 * Retains the last 10 people names so "also met Sam" can inherit the active event.
 */
type ConversationContext = {
  activeEventName?: string;
  activeDateContext?: TemporalContext;
  lastSearch?: SearchContext;
  activeMemoryId?: string;
  recentPeople: string[];
};

/**
 * Minimum interpreter confidence required before `capture_memory` writes a memory.
 *
 * Below this threshold the agent asks for clarification rather than saving a guess.
 */
const MIN_CAPTURE_CONFIDENCE = 0.5;
const SEARCH_CONTEXT_TTL_MS = 15 * 60 * 1000;

/**
 * Creates the LLM-interpreted relationship agent.
 *
 * The interpreter classifies messy text; deterministic tools create, ignore, or search memories.
 * Conversation carryover merges recent event/date when the user says "also" or names a recent
 * person. Captures below {@link MIN_CAPTURE_CONFIDENCE} ask for clarification instead of writing.
 * Every turn persists an {@link AgentInteraction} for debugging and eval replay.
 */
export function createInterpretedRelationshipAgent({
  repo,
  tools,
  interpreter,
  onboarding,
  now = () => new Date().toISOString(),
  timezone = "UTC"
}: InterpretedRelationshipAgentOptions) {
  const conversationContexts = new Map<string, ConversationContext>();
  const candidateIntake = createCandidateIntake({ tools });

  return {
    async handleMessage(message: InboundAgentMessage): Promise<InterpretedAgentResult> {
      const startedAt = Date.now();
      const existingContext = conversationContexts.get(message.userId) ?? { recentPeople: [] };
      let turnContext = existingContext;
      const onboardingControl = detectOnboardingControl(message.text);
      if (onboardingControl) {
        onboarding?.applyControl(onboardingControl);
        const outboundText = composeOnboardingControlReply(onboardingControl);
        const interaction = addInteractionWithTrace(repo, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            intent: "onboarding_control",
            action: onboardingControl,
            confidence: 1
          },
          outboundText,
          toolCalls: [],
          modelUsed: "deterministic-scope",
          confidence: 1,
          latencyMs: Date.now() - startedAt,
          createdAt: now()
        });

        return {
          outbound: {
            userId: message.userId,
            platform: message.platform,
            spaceId: message.spaceId,
            text: outboundText
          },
          toolCalls: [],
          interaction
        };
      }

      if (isSearchContextReset(message.text)) {
        turnContext = clearSearchContext(existingContext);
        conversationContexts.set(message.userId, turnContext);
      } else {
        const followUp = executeFollowUpSearchIfPresent(message, turnContext, tools, message.receivedAt);
        if (followUp) {
          conversationContexts.set(message.userId, followUp.nextContext);
          const interaction = addInteractionWithTrace(repo, {
            id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
            userId: message.userId,
            platform: message.platform,
            spaceId: message.spaceId,
            inboundText: message.text,
            interpretedIntentJson: {
              intent: "followup_search",
              confidence: 1,
              searchContextId: existingContext.lastSearch?.searchContextId
            },
            outboundText: followUp.outboundText,
            toolCalls: followUp.toolCalls,
            modelUsed: "deterministic-scope",
            confidence: 1,
            latencyMs: Date.now() - startedAt,
            createdAt: now()
          });

          return {
            outbound: {
              userId: message.userId,
              platform: message.platform,
              spaceId: message.spaceId,
              text: followUp.outboundText
            },
            toolCalls: followUp.toolCalls,
            interaction
          };
        }
      }

      const memoryMutationRequest = detectMemoryMutationRequest(message.text);
      if (memoryMutationRequest) {
        const toolCalls: AgentToolCall[] = [];
        const mutation = executeMemoryMutationRequest(message, memoryMutationRequest, repo, tools, turnContext, toolCalls, now());
        const outboundText = mutation.outboundText;
        conversationContexts.set(message.userId, mutation.nextContext);
        const interaction = addInteractionWithTrace(repo, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            intent: memoryMutationRequest.kind === "delete" ? "delete_memory" : "update_memory",
            memoryMutationRequest,
            confidence: 1
          },
          outboundText,
          toolCalls,
          modelUsed: "deterministic-scope",
          confidence: 1,
          latencyMs: Date.now() - startedAt,
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

      const scopeDecision = decideMessageScope({
        text: message.text,
        hasPendingCandidate: repo.listPendingCandidates(message.userId).length > 0
      });

      if (scopeDecision.scope === "out_of_scope" || scopeDecision.scope === "needs_clarification") {
        const outboundText =
          scopeDecision.scope === "out_of_scope"
            ? scopeDecision.redirect
            : composeClarificationReply(scopeDecision.question);
        const interaction = addInteractionWithTrace(repo, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: scopeOnlyLog(scopeDecision),
          outboundText,
          toolCalls: [],
          confidence: scopeDecision.scope === "out_of_scope" ? 1 : 0.7,
          latencyMs: Date.now() - startedAt,
          createdAt: now()
        });

        return {
          outbound: {
            userId: message.userId,
            platform: message.platform,
            spaceId: message.spaceId,
            text: outboundText
          },
          toolCalls: [],
          interaction
        };
      }

      if (scopeDecision.capability === "candidate_confirmation") {
        const toolCalls: AgentToolCall[] = [];
        const outboundText = confirmPendingCandidate(message, candidateIntake, tools, toolCalls);
        const interaction = addInteractionWithTrace(repo, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            scopeDecision,
            intent: "candidate_confirmation",
            confidence: 1
          },
          outboundText,
          toolCalls,
          modelUsed: "deterministic-scope",
          confidence: 1,
          latencyMs: Date.now() - startedAt,
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

      const interpreted = await interpreter.interpret(message);
      const interpretation = enrichInterpretationWithContext(
        interpreted.interpretation,
        turnContext,
        parseTemporalContext(message.text, { receivedAt: message.receivedAt, timezone }),
        message.text
      );
      const toolCalls: AgentToolCall[] = [];
      const outboundText = executeInterpretation(message, interpretation, tools, candidateIntake, toolCalls);
      conversationContexts.set(
        message.userId,
        updateSearchContext(message, tools, updateConversationContext(turnContext, interpretation), interpretation)
      );

      const interaction = addInteractionWithTrace(repo, {
        id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
        userId: message.userId,
        platform: message.platform,
        spaceId: message.spaceId,
        inboundText: message.text,
        interpretedIntentJson: { ...interpretation, scopeDecision, interpretation },
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

function addInteractionWithTrace(repo: RelationshipRepository, interaction: AgentInteraction): AgentInteraction {
  return repo.addInteraction({
    ...interaction,
    redactedTraceJson: buildRedactedInteractionTrace({
      inboundText: interaction.inboundText,
      interpretedIntentJson: interaction.interpretedIntentJson,
      toolCalls: interaction.toolCalls as AgentToolCall[],
      outboundText: interaction.outboundText,
      model: modelTraceFromInteraction(interaction.modelUsed),
      errors: interaction.error ? [interaction.error] : [],
      now: interaction.createdAt
    })
  });
}

function modelTraceFromInteraction(modelUsed: string | undefined): AgentTrace["model"] {
  if (!modelUsed) {
    return { used: false, fallbackUsed: true };
  }

  const deterministic = modelUsed === "deterministic-scope" || modelUsed === "rule-based-fallback";
  return {
    used: !deterministic,
    provider: deterministic ? undefined : "openrouter",
    modelName: modelUsed,
    fallbackUsed: deterministic
  };
}

function executeMemoryMutationRequest(
  message: InboundAgentMessage,
  request: MemoryMutationRequest,
  repo: RelationshipRepository,
  tools: RelationshipTools,
  context: ConversationContext,
  toolCalls: AgentToolCall[],
  now: string
): { outboundText: string; nextContext: ConversationContext } {
  const target = resolveMemoryMutationTarget(message, request, repo, tools, context, toolCalls, message.receivedAt);
  if (target.kind === "none") {
    return { outboundText: composeNoMatchReply(), nextContext: context };
  }

  if (target.kind === "ambiguous") {
    return { outboundText: target.message, nextContext: context };
  }

  const memory = target.memory;
  const nextContext = { ...context, activeMemoryId: memory.id, lastSearch: undefined };
  if (request.kind === "delete") {
    toolCalls.push("delete_memory");
    const deleted = tools.delete_memory(message.userId, memory.id, {
      userText: message.text,
      now
    });
    return { outboundText: composeMemoryDeleteReply({ memory: deleted }), nextContext: clearSearchContext(nextContext) };
  }

  toolCalls.push("update_memory");
  const updated = tools.update_memory(message.userId, memory.id, request.contextNote, {
    reason: "user_correction",
    userText: message.text,
    now
  });
  return { outboundText: composeMemoryUpdateReply({ memory: updated }), nextContext: { ...nextContext, activeMemoryId: updated.id } };
}

function resolveMemoryMutationTarget(
  message: InboundAgentMessage,
  request: MemoryMutationRequest,
  repo: RelationshipRepository,
  tools: RelationshipTools,
  context: ConversationContext,
  toolCalls: AgentToolCall[],
  now: string
): { kind: "single"; memory: RelationshipMemory } | { kind: "ambiguous"; message: string } | { kind: "none" } {
  if (!request.query) {
    const candidateIds = validRecentSearchCandidateIds(context, now);
    if (context.activeMemoryId) {
      const activeMemory = repo.listMemories(message.userId).find((memory) => memory.id === context.activeMemoryId);
      if (activeMemory) {
        return { kind: "single", memory: activeMemory };
      }
    }

    if (candidateIds.length === 1) {
      const [candidateId] = candidateIds;
      const memory = repo.listMemories(message.userId).find((item) => item.id === candidateId);
      return memory ? { kind: "single", memory } : { kind: "none" };
    }

    if (candidateIds.length > 1) {
      const candidates = repo.listMemories(message.userId).filter((memory) => candidateIds.includes(memory.id));
      return {
        kind: "ambiguous",
        message: `Who should I update - ${candidates.map((memory) => memory.displayName).join(" or ")}?`
      };
    }

    return { kind: "none" };
  }

  toolCalls.push("search_memories");
  const matches = tools.search_memories(message.userId, request.query);
  if (matches.length === 0) {
    return { kind: "none" };
  }

  if (matches.length > 1) {
    return { kind: "ambiguous", message: composeSearchReply({ matches: matches.slice(0, 3), ambiguous: true }) };
  }

  return { kind: "single", memory: matches[0].memory };
}

function detectMemoryMutationRequest(text: string): MemoryMutationRequest | undefined {
  const trimmed = text.trim();
  const deleteMatch = trimmed.match(/^(?:delete|remove|forget)\s+(.+?)(?:\s+memory)?$/i);
  if (deleteMatch) {
    const query = deleteMatch[1].trim();
    if (query.length > 0 && !/\b(previous|system|instruction|rules?)\b/i.test(query)) {
      return { kind: "delete", query };
    }
  }

  const leadingActuallyMatch = trimmed.match(/^(?:actually|correction|update),?\s+([a-z][a-z .'-]{0,60}?)\s+(.+)$/i);
  if (leadingActuallyMatch) {
    const query = leadingActuallyMatch[1].trim();
    const contextNote = leadingActuallyMatch[2].trim();
    if (query.length > 0 && contextNote.length > 0 && !/^(she|he|they|them|her|him)$/i.test(query)) {
      return { kind: "update", query, contextNote };
    }
  }

  const pronounCorrectionMatch = trimmed.match(/^(?:actually|correction|update),?\s+(?:she|he|they|them|her|him)\s+(.+)$/i);
  if (pronounCorrectionMatch) {
    const contextNote = pronounCorrectionMatch[1].trim();
    if (contextNote.length > 0) {
      return { kind: "update", contextNote };
    }
  }

  const updateMatch = trimmed.match(/^([a-z][a-z .'-]{0,60}?)\s+(?:actually|really|now)\s+(.+)$/i);
  if (updateMatch) {
    const query = updateMatch[1].trim();
    const contextNote = updateMatch[2].trim();
    if (query.length > 0 && contextNote.length > 0) {
      return { kind: "update", query, contextNote };
    }
  }

  return undefined;
}

function executeFollowUpSearchIfPresent(
  message: InboundAgentMessage,
  context: ConversationContext,
  tools: RelationshipTools,
  receivedAt: string
): { outboundText: string; toolCalls: AgentToolCall[]; nextContext: ConversationContext } | undefined {
  if (!looksLikeFollowUpSearchClue(message.text)) {
    return undefined;
  }

  const candidateIds = validRecentSearchCandidateIds(context, receivedAt);
  if (candidateIds.length === 0) {
    return {
      outboundText: "I'm not sure which previous search you mean. Give me one more clue or start a new search.",
      toolCalls: [],
      nextContext: clearSearchContext(context)
    };
  }

  const toolCalls: AgentToolCall[] = ["search_memories"];
  const matches = tools
    .search_memories(message.userId, message.text)
    .filter((match) => candidateIds.includes(match.memory.id));

  if (matches.length === 0) {
    return {
      outboundText: "I could not narrow that previous search. Which person do you mean?",
      toolCalls,
      nextContext: context
    };
  }

  if (matches.length > 1) {
    return {
      outboundText: composeSearchReply({ matches, ambiguous: true }),
      toolCalls,
      nextContext: {
        ...context,
        activeMemoryId: undefined,
        lastSearch: createSearchContext({
          message,
          query: message.text,
          matches,
          receivedAt
        })
      }
    };
  }

  const [match] = matches;
  return {
    outboundText: composeDefinitiveFollowUpReply(match),
    toolCalls,
    nextContext: {
      ...clearSearchContext(context),
      activeMemoryId: match.memory.id
    }
  };
}

function updateSearchContext(
  message: InboundAgentMessage,
  tools: RelationshipTools,
  context: ConversationContext,
  interpretation: MessageInterpretation
): ConversationContext {
  if (interpretation.intent !== "search_memory") {
    return context;
  }

  const query = buildSearchQueryFromInterpretation(interpretation) || message.text;
  const matches = tools.search_memories(message.userId, query);
  if (matches.length === 0) {
    return { ...clearSearchContext(context), activeMemoryId: undefined };
  }

  if (matches.length === 1) {
    return { ...clearSearchContext(context), activeMemoryId: matches[0].memory.id };
  }

  if (!isEventWideRecallQuery(message.text) && isAmbiguous(matches)) {
    return {
      ...context,
      activeMemoryId: undefined,
      lastSearch: createSearchContext({
        message,
        query,
        matches,
        receivedAt: message.receivedAt
      })
    };
  }

  return { ...clearSearchContext(context), activeMemoryId: undefined };
}

function createSearchContext({
  message,
  query,
  matches,
  receivedAt
}: {
  message: InboundAgentMessage;
  query: string;
  matches: MemorySearchResult[];
  receivedAt: string;
}): SearchContext {
  const createdAtMs = Date.parse(receivedAt);
  const createdAt = Number.isNaN(createdAtMs) ? new Date().toISOString() : new Date(createdAtMs).toISOString();
  const expiresAt = new Date((Number.isNaN(createdAtMs) ? Date.now() : createdAtMs) + SEARCH_CONTEXT_TTL_MS).toISOString();

  return {
    searchContextId: searchContextId(message, query, receivedAt),
    createdAt,
    expiresAt,
    originalQuery: query,
    candidateMemoryIds: matches.slice(0, 3).map((match) => match.memory.id),
    lastQuestion: message.text
  };
}

function searchContextId(message: InboundAgentMessage, query: string, receivedAt: string): string {
  const hash = createHash("sha256")
    .update([message.userId, message.spaceId ?? "", receivedAt, query].join("\0"))
    .digest("hex")
    .slice(0, 16);
  return `search_context_${hash}`;
}

function composeDefinitiveFollowUpReply(match: MemorySearchResult): string {
  return composeSearchReply({ matches: [match] }).replace(/^I think that was/, "That was");
}

function validRecentSearchCandidateIds(context: ConversationContext, now: string): string[] {
  if (!context.lastSearch) {
    return [];
  }

  const nowMs = Date.parse(now);
  const expiresAtMs = Date.parse(context.lastSearch.expiresAt);
  if (Number.isNaN(nowMs) || Number.isNaN(expiresAtMs) || nowMs > expiresAtMs) {
    return [];
  }

  return context.lastSearch.candidateMemoryIds;
}

function clearSearchContext(context: ConversationContext): ConversationContext {
  return { ...context, lastSearch: undefined };
}

function isSearchContextReset(text: string): boolean {
  return /\b(?:new search|start over|reset search|clear search|different search|never mind|nevermind)\b/i.test(text);
}

function looksLikeFollowUpSearchClue(text: string): boolean {
  return /^(?:the one|that one|one who|the person|the guy|the girl|the founder|she\b|he\b|they\b|them\b)/i.test(
    text.trim()
  );
}

function scopeOnlyLog(scopeDecision: ScopeDecision): unknown {
  if (scopeDecision.scope === "needs_clarification") {
    return {
      scopeDecision,
      intent: "clarify",
      confidence: 0.7,
      needsClarification: true,
      clarificationQuestion: scopeDecision.question
    };
  }

  return { scopeDecision };
}

function executeInterpretation(
  message: InboundAgentMessage,
  interpretation: MessageInterpretation,
  tools: RelationshipTools,
  candidateIntake: CandidateIntake,
  toolCalls: AgentToolCall[]
): string {
  if (isConfirmationReply(message.text)) {
    return confirmPendingCandidate(message, candidateIntake, tools, toolCalls);
  }

  if (interpretation.needsClarification || interpretation.intent === "clarify") {
    return composeClarificationReply(interpretation.clarificationQuestion);
  }

  if (interpretation.intent === "capture_memory") {
    if (interpretation.confidence < MIN_CAPTURE_CONFIDENCE) {
      return composeClarificationReply(interpretation.clarificationQuestion || "What should I remember about them?");
    }
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
  const memories = interpretation.people.map((person, index) => {
    const note = buildMemoryNote(interpretation, person);
    const idempotencyKey = manualMemoryIdempotencyKey(message, person.name, index);
    toolCalls.push("create_manual_memory");
    return tools.create_manual_memory(message.userId, person.name, note, "manual contact", {
      eventTitle: interpretation.event.name || undefined,
      dateContext: interpretation.dateContext,
      idempotencyKey,
      createdFromInteractionId: message.interactionId ?? idempotencyKey.replace(/^manual_imessage:/, "")
    });
  });

  if (memories.length === 1) {
    return composeSaveConfirmation({ memories });
  }

  return composeSaveConfirmation({ memories });
}

function manualMemoryIdempotencyKey(message: InboundAgentMessage, personName: string, index: number): string {
  if (message.interactionId) {
    return `manual_imessage:${message.interactionId}`;
  }

  const hash = createHash("sha256")
    .update([message.platform, message.userId, message.spaceId ?? "", message.receivedAt, personName, index, message.text].join("\0"))
    .digest("hex")
    .slice(0, 24);
  return `manual_imessage:${hash}`;
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
  tools: RelationshipTools,
  toolCalls: AgentToolCall[]
): string {
  toolCalls.push("list_pending_candidates");
  const pending = tools.list_pending_candidates(message.userId);
  if (isPendingCandidateInquiry(message.text)) {
    return composePendingCandidateInquiryReply({
      candidates: pending.map((candidate) => ({ displayName: candidate.displayName }))
    });
  }

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

/**
 * Carries active event/date and recent people across turns for multi-message capture flows.
 *
 * Only applied to `capture_memory` when the user says "also" or names someone saved recently.
 */
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
