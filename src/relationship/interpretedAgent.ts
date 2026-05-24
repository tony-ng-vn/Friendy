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
import {
  getConversationId,
  getRelationshipTracer,
  inputMessages,
  outputMessages,
  recordSpanError,
  RELATIONSHIP_AGENT_NAME,
  SpanKind,
  SpanStatusCode
} from "./instrumentation";
import { isConfirmationReply } from "./candidateConfirmation";
import {
  cleanCandidateContextReply,
  createCandidateIntake,
  type CandidateIgnoreResult,
  type CandidateReplyResult
} from "./candidateIntake";
import { parseDuplicateResolutionReply } from "./duplicateResolution";
import { buildConversationState, type ConversationState, type PendingContactContextFrame } from "./conversationState";
import { detectOnboardingControl, type OnboardingStateController } from "./onboardingState";
import { buildExpressionFactBundle } from "./expressionBundleFactory";
import type { ExpressionComposerResult } from "./expressionComposer";
import type { ExpressionFactBundle } from "./expressionFacts";
import type { MessageInterpreter } from "./openAIInterpreter";
import type { RelationshipRepository } from "./repository";
import {
  composeCandidateAmbiguityReply,
  composeClarificationReply,
  composeConversationRepairReply,
  composeDeleteAllMemoryConfirmReply,
  composeDeleteAllMemoryReply,
  composeDeleteMemoryConfirmReply,
  composeDeleteMemoryDisambiguationReply,
  composeDuplicateAuditReply,
  composeExplainAgentStateReply,
  composeIgnoreCandidateReply,
  composeMemoryDeleteReply,
  composeMemoryUpdateReply,
  composeListPeopleReply,
  composeNoMatchReply,
  composeNoSavedMemoryReply,
  composeNoPendingCandidateReply,
  composeOnboardingStartRequiredReply,
  composePendingCandidateInquiryReply,
  composePendingContactsFooter,
  composeOnboardingControlReply,
  composeDuplicateResolutionPrompt,
  composeSaveConfirmation,
  composeSearchReply,
  composeUpdateMemoryConfirmReply,
  composeUpdateMemoryDisambiguationReply
} from "./responseComposer";
import {
  PENDING_REMINDER_REASON_CODES,
  decidePendingReminder,
  type PendingReminderContext,
  type PendingReminderDecision,
  type PendingReminderReason,
  type PendingReminderResponseKind,
  type PendingReminderState
} from "./pendingReminderPolicy";
import { decideHardSafety } from "./hardSafetyBlock";
import {
  isPendingCandidateInquiry,
  isPendingPromptContextReply,
  isRelationshipMetaRouteMessage
} from "./scopeBoundary";
import { isEventRecallQuestion, isListPeopleRecall } from "./listPeopleRecall";
import { rankDisplayNameMatches } from "./personNameMatch";
import { validateRequiredToolAvailability, validateRoutePolicy, type ValidatedRoutePolicy } from "./routePolicyValidator";
import { buildRouterInputEnvelope, type RouterRouteCapability } from "./routerInputEnvelope";
import { parseTemporalContext, type TemporalContext } from "./temporalContext";
import { normalizeMemorySearchQuery, type MemorySearchResult, type createRelationshipTools } from "./tools";
import { buildRedactedInteractionTrace, type AgentTrace } from "./runtime/runtimeTrace";
import { FriendyStrictModeError } from "./strictMode";
import {
  createFriendyTrace,
  extractFriendyTrace,
  type FriendyPolicyDecision,
  type FriendyRouteSource,
  type FriendyTrace
} from "./trace";
import type {
  AgentCoreResult,
  AgentInteraction,
  AgentToolCall,
  ContactCandidate,
  InboundAgentMessage,
  RelationshipMemory
} from "./types";

type RelationshipTools = ReturnType<typeof createRelationshipTools>;
type CandidateIntake = ReturnType<typeof createCandidateIntake>;
type MemoryMutationRequest =
  | { kind: "delete"; query: string }
  | { kind: "update"; query?: string; contextNote: string };
type ManualMemoryCreateRequest = {
  displayName: string;
  contextNote: string;
  eventTitle?: string;
};
type SearchContext = {
  searchContextId: string;
  createdAt: string;
  expiresAt: string;
  originalQuery: string;
  candidateMemoryIds: string[];
  lastQuestion: string;
};
type MemorySearchRequest = {
  userId: string;
  rawMessage: string;
  interpretedQuery?: string;
  normalizedQuery?: string;
  exactTerms: string[];
  semanticQuery?: string;
  mode?: NonNullable<MessageInterpretation["search"]>["mode"];
  filters?: NonNullable<MessageInterpretation["search"]>["filters"];
  topK: number;
};
type AgentReplyDraft = {
  text: string;
  expressionBundle?: ExpressionFactBundle;
};

/** Optional post-tool copy polish layer; must not change routing or tool outcomes. */
export type AgentExpressionComposer = {
  polishOutboundText(input: {
    draft: string;
    bundle?: ExpressionFactBundle;
  }): Promise<ExpressionComposerResult> | ExpressionComposerResult;
};
type ExpressionMetadata = {
  expressionUsed?: boolean;
  expressionValidationPassed?: boolean;
  expressionFallbackReason?: ExpressionComposerResult["fallbackReason"];
  expressionModel?: string;
};

/** Injectable dependencies for the interpreted agent, including optional clock and timezone. */
type InterpretedRelationshipAgentOptions = {
  repo: RelationshipRepository;
  tools: RelationshipTools;
  interpreter: MessageInterpreter;
  expression?: AgentExpressionComposer;
  onboarding?: OnboardingStateController;
  strictMode?: boolean;
  now?: () => string;
  timezone?: string;
};

/** Agent result plus the persisted interaction row for this turn. */
type InterpretedAgentResult = AgentCoreResult & {
  interaction: AgentInteraction;
  trace: FriendyTrace;
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
  pendingDelete?: {
    memoryId?: string;
    displayName?: string;
    query?: string;
    allMemoryIds?: string[];
    options?: Array<{ memoryId: string; displayName: string }>;
  };
  pendingUpdate?: {
    memoryId?: string;
    displayName?: string;
    proposedContextNote: string;
    query?: string;
    options?: Array<{ memoryId: string; displayName: string }>;
  };
  reminderState?: PendingReminderState;
  recentPeople: string[];
};

/**
 * Minimum interpreter confidence required before `capture_memory` writes a memory.
 *
 * Below this threshold the agent asks for clarification rather than saving a guess.
 */
const MIN_CAPTURE_CONFIDENCE = 0.5;
const SEARCH_CONTEXT_TTL_MS = 15 * 60 * 1000;
const ROUTER_AVAILABLE_TOOLS = [
  "list_people",
  "find_duplicate_people",
  "search_memories",
  "lookup_memory_target",
  "list_pending_candidates",
  "list_candidate_event_matches",
  "get_candidate",
  "confirm_candidate",
  "ignore_candidate",
  "resolve_duplicate_person",
  "create_manual_memory",
  "update_memory",
  "delete_memory"
] satisfies AgentToolCall[];
const ROUTER_AVAILABLE_ROUTE_CAPABILITIES = [
  "capture_memory",
  "answer_pending_contact_prompt",
  "capture_pending_contact_context",
  "ignore_candidate",
  "list_people",
  "search_memory",
  "duplicate_audit",
  "delete_memory_request",
  "update_memory",
  "manual_memory_create",
  "explain_agent_state",
  "explain_pending_workflow",
  "conversation_repair",
  "clarify",
  "reject"
] satisfies RouterRouteCapability[];

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
  expression,
  onboarding,
  strictMode = true,
  now = () => new Date().toISOString(),
  timezone = "UTC"
}: InterpretedRelationshipAgentOptions) {
  const conversationContexts = new Map<string, ConversationContext>();
  const candidateIntake = createCandidateIntake({ tools });

  return {
    async handleMessage(message: InboundAgentMessage): Promise<InterpretedAgentResult> {
      const tracer = getRelationshipTracer();
      const span = tracer.startSpan("relationship.handle_message", {
        kind: SpanKind.INTERNAL,
        attributes: {
          "gen_ai.agent.name": RELATIONSHIP_AGENT_NAME,
          "gen_ai.conversation.id": getConversationId(message),
          "gen_ai.operation.name": "chat",
          "gen_ai.input.messages": JSON.stringify(inputMessages(message))
        }
      });
      const startedAt = Date.now();

      try {
        const existingContext = conversationContexts.get(message.userId) ?? { recentPeople: [] };
        let turnContext = existingContext;
        const onboardingControl = detectOnboardingControl(message.text);
      if (onboardingControl) {
        onboarding?.applyControl(onboardingControl);
        const outboundText =
          onboardingControl === "started"
            ? composeStartedReplyWithQueuedContacts(
                composeOnboardingControlReply(onboardingControl),
                repo.listPendingCandidates(message.userId)
              )
            : composeOnboardingControlReply(onboardingControl);
        const interaction = addInteractionWithTrace(repo, strictMode, {
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
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      if (onboarding?.getState() === "ready_pending_user_start") {
        const outboundText = composeOnboardingStartRequiredReply();
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            intent: "onboarding_control",
            action: "start_required",
            confidence: 1,
            policyDecision: { decision: "clarify", reason: "awaiting_user_start" }
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
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      const pendingState = buildConversationState({
        userId: message.userId,
        spaceId: message.spaceId,
        pendingCandidates: repo.listPendingCandidates(message.userId)
      });

      if ((turnContext.pendingUpdate || turnContext.pendingDelete) && isMemoryMutationCancelReply(message.text)) {
        const pendingKind = turnContext.pendingUpdate ? "update" : "delete";
        const pending = turnContext.pendingUpdate ?? turnContext.pendingDelete;
        const outboundText =
          pendingKind === "update"
            ? `Cancelled. I won't update ${pending?.displayName ?? "that memory"}.`
            : `Cancelled. I won't delete ${pending?.displayName ?? "that memory"}.`;
        conversationContexts.set(message.userId, {
          ...turnContext,
          pendingUpdate: undefined,
          pendingDelete: undefined
        });
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            intent: pendingKind === "update" ? "update_memory" : "delete_memory_request",
            domain: "relationship_memory",
            conversationRelation: "answers_open_workflow",
            target: pending?.memoryId ? { memoryId: pending.memoryId } : undefined,
            confidence: 1,
            traceReason: `User cancelled a pending ${pendingKind}-memory request.`,
            policyDecision: { decision: "allow", suppressPendingReminder: true },
            activeWorkflowKind: pendingKind === "update" ? "pending_update_confirm" : "pending_delete_confirm"
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
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      if (turnContext.pendingUpdate?.options && !turnContext.pendingUpdate.memoryId) {
        const selectedIndex = parseNumberedSelection(message.text);
        const selected = selectedIndex === undefined ? undefined : turnContext.pendingUpdate.options[selectedIndex];
        if (selected) {
          const nextContext = {
            ...turnContext,
            pendingUpdate: {
              memoryId: selected.memoryId,
              displayName: selected.displayName,
              proposedContextNote: turnContext.pendingUpdate.proposedContextNote,
              query: turnContext.pendingUpdate.query
            }
          };
          conversationContexts.set(message.userId, nextContext);
          const outboundText = composeUpdateMemoryConfirmReply({
            displayName: selected.displayName,
            proposedContextNote: turnContext.pendingUpdate.proposedContextNote
          });
          const interaction = addInteractionWithTrace(repo, strictMode, {
            id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
            userId: message.userId,
            platform: message.platform,
            spaceId: message.spaceId,
            inboundText: message.text,
            interpretedIntentJson: {
              intent: "update_memory",
              domain: "relationship_memory",
              conversationRelation: "answers_open_workflow",
              target: { memoryId: selected.memoryId },
              confidence: 1,
              traceReason: "User selected a memory from pending update disambiguation.",
              policyDecision: { decision: "clarify", suppressPendingReminder: true },
              activeWorkflowKind: "pending_update_confirm"
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
            interaction,
            trace: traceFromInteraction(interaction)
          };
        }
      }

      if (turnContext.pendingUpdate?.memoryId && isConfirmationReply(message.text)) {
        const toolCalls: AgentToolCall[] = [];
        const pendingUpdate = turnContext.pendingUpdate;
        const memory = repo.listMemories(message.userId).find((item) => item.id === pendingUpdate.memoryId);
        let outboundText = composeNoMatchReply();

        if (memory) {
          toolCalls.push("update_memory");
          const updated = tools.update_memory(message.userId, memory.id, pendingUpdate.proposedContextNote, {
            reason: "user_correction",
            userText: message.text,
            now: now()
          });
          outboundText = composeMemoryUpdateReply({ memory: updated });
        }

        conversationContexts.set(message.userId, { ...turnContext, pendingUpdate: undefined });
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            intent: "update_memory",
            domain: "relationship_memory",
            conversationRelation: "answers_open_workflow",
            target: { memoryId: pendingUpdate.memoryId },
            confidence: 1,
            traceReason: "User confirmed a pending update-memory request.",
            policyDecision: { decision: "allow", suppressPendingReminder: true },
            activeWorkflowKind: "pending_update_confirm",
            selectedTool: "update_memory"
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
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      if (turnContext.pendingDelete?.options && !turnContext.pendingDelete.memoryId) {
        const selectedIndex = parseNumberedSelection(message.text);
        const selected = selectedIndex === undefined ? undefined : turnContext.pendingDelete.options[selectedIndex];
        if (selected) {
          const nextContext = {
            ...turnContext,
            pendingDelete: {
              memoryId: selected.memoryId,
              displayName: selected.displayName,
              query: turnContext.pendingDelete.query
            }
          };
          conversationContexts.set(message.userId, nextContext);
          const outboundText = composeDeleteMemoryConfirmReply({
            matches: [{ displayName: selected.displayName }]
          });
          const interaction = addInteractionWithTrace(repo, strictMode, {
            id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
            userId: message.userId,
            platform: message.platform,
            spaceId: message.spaceId,
            inboundText: message.text,
            interpretedIntentJson: {
              intent: "delete_memory_request",
              domain: "relationship_memory",
              conversationRelation: "answers_open_workflow",
              target: { memoryId: selected.memoryId },
              confidence: 1,
              traceReason: "User selected a memory from pending delete disambiguation.",
              policyDecision: { decision: "clarify", suppressPendingReminder: true },
              activeWorkflowKind: "pending_delete_confirm"
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
            interaction,
            trace: traceFromInteraction(interaction)
          };
        }
      }

      if (turnContext.pendingDelete?.allMemoryIds && isConfirmationReply(message.text)) {
        const toolCalls: AgentToolCall[] = [];
        toolCalls.push("clear_memories");
        const cleared = tools.clear_memories(message.userId, {
          userText: message.text,
          now: now()
        });
        const deletedMemoryIds = cleared.deleted.map((memory) => memory.id);
        const outboundText =
          deletedMemoryIds.length > 0 ? composeDeleteAllMemoryReply({ count: deletedMemoryIds.length }) : composeNoSavedMemoryReply();
        conversationContexts.set(message.userId, { ...turnContext, pendingDelete: undefined });
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            intent: "delete_memory",
            domain: "relationship_memory",
            conversationRelation: "answers_open_workflow",
            target: { memoryIds: deletedMemoryIds },
            confidence: 1,
            traceReason: "User confirmed a pending delete-all-memory request.",
            policyDecision: { decision: "allow", suppressPendingReminder: true },
            activeWorkflowKind: "pending_delete_confirm",
            selectedTool: "delete_memory"
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
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      if (turnContext.pendingDelete?.memoryId && isConfirmationReply(message.text)) {
        const toolCalls: AgentToolCall[] = [];
        const pendingDelete = turnContext.pendingDelete;
        const memory = repo.listMemories(message.userId).find((item) => item.id === pendingDelete.memoryId);
        let outboundText = composeNoMatchReply();

        if (memory) {
          toolCalls.push("delete_memory");
          tools.delete_memory(message.userId, memory.id, {
            userText: message.text,
            now: now()
          });
          outboundText = composeMemoryDeleteReply({ memory });
        }

        conversationContexts.set(message.userId, { ...turnContext, pendingDelete: undefined });
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            intent: "delete_memory",
            domain: "relationship_memory",
            conversationRelation: "answers_open_workflow",
            target: { memoryId: pendingDelete.memoryId },
            confidence: 1,
            traceReason: "User confirmed a pending delete-memory request.",
            policyDecision: { decision: "allow", suppressPendingReminder: true },
            activeWorkflowKind: "pending_delete_confirm",
            selectedTool: "delete_memory"
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
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      const memoryMutationRequest = detectMemoryMutationRequest(message.text);
      if (!memoryMutationRequest && isDeleteAllMemoryRequest(message.text)) {
        const memories = repo.listMemories(message.userId);
        const outboundText =
          memories.length === 0 ? composeNoSavedMemoryReply() : composeDeleteAllMemoryConfirmReply({ count: memories.length });
        const nextContext: ConversationContext =
          memories.length === 0
            ? turnContext
            : {
                ...clearSearchContext(turnContext),
                pendingDelete: {
                  displayName: "everyone",
                  query: "everyone",
                  allMemoryIds: memories.map((memory) => memory.id)
                }
              };
        conversationContexts.set(message.userId, nextContext);
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            intent: "delete_memory_request",
            memoryMutationRequest: { kind: "delete", query: "everyone" },
            confidence: 1,
            activeWorkflowKind: memories.length === 0 ? undefined : "pending_delete_confirm",
            policyDecision: { decision: memories.length === 0 ? "clarify" : "allow", suppressPendingReminder: true }
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
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      if (memoryMutationRequest) {
        const toolCalls: AgentToolCall[] = [];
        const mutation = executeMemoryMutationRequest(
          message,
          memoryMutationRequest,
          repo,
          tools,
          turnContext,
          toolCalls,
          now(),
          strictMode
        );
        const mutationPolicyDecision = policyDecisionForMemoryMutation(mutation.nextContext, memoryMutationRequest.kind);
        const outboundText = mutation.outboundText;
        conversationContexts.set(message.userId, mutation.nextContext);
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            intent: memoryMutationRequest.kind === "delete" ? "delete_memory_request" : "update_memory",
            memoryMutationRequest,
            confidence: 1,
            activeWorkflowKind:
              memoryMutationRequest.kind === "delete" ? "pending_delete_confirm" : "pending_update_confirm",
            selectedTool: toolCalls[0],
            policyDecision: mutationPolicyDecision
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
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      if (pendingState.pendingContactQueue.length > 0 && isPendingCandidateInquiry(message.text)) {
        const toolCalls: AgentToolCall[] = [];
        const reply = confirmPendingCandidate(message, candidateIntake, tools, toolCalls, pendingState);
        const expressionResult = await polishAgentReply(reply, expression);
        const outboundText = expressionResult.text;
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            ...(pendingState.activeFrame
              ? routeLog({
                  intent: "explain_pending_workflow",
                  conversationRelation: "asks_about_open_workflow",
                  frame: pendingState.activeFrame,
                  confidence: 1,
                  traceReason: "User asked which pending contact Friendy is asking about.",
                  policyDecision: { decision: "allow" }
                })
              : {
                  domain: "relationship_memory",
                  intent: "explain_pending_workflow",
                  conversationRelation: "asks_about_open_workflow",
                  confidence: 1,
                  traceReason: "User asked which pending contact Friendy is asking about.",
                  policyDecision: { decision: "allow" }
                }),
            ...expressionResult.metadata
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
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      const duplicateResolutionReply = pendingState.activeFrame
        ? parseDuplicateResolutionReply(message.text)
        : undefined;
      if (
        pendingState.activeFrame &&
        duplicateResolutionReply &&
        listSavedMemoriesForDisplayName(repo, message.userId, pendingState.activeFrame.displayName).length > 0
      ) {
        const resolvedAt = now();
        const savedMatches = listSavedMemoriesForDisplayName(
          repo,
          message.userId,
          pendingState.activeFrame.displayName
        );
        const existingPersonId =
          savedMatches.find((memory) => memory.personId)?.personId ??
          repo.findPeopleByDisplayNameNormalized(message.userId, pendingState.activeFrame.displayName)[0]?.id;
        const samePersonId =
          duplicateResolutionReply === "same"
            ? existingPersonId ??
              repo.createPersonIdentity({
                userId: message.userId,
                canonicalDisplayName: pendingState.activeFrame.displayName,
                createdAt: resolvedAt
              }).id
            : undefined;
        const toolCalls: AgentToolCall[] = ["resolve_duplicate_person"];
        tools.resolve_duplicate_person(message.userId, {
          candidateId: pendingState.activeFrame.candidateId,
          resolution: duplicateResolutionReply,
          personId: samePersonId
        });
        const nextContext =
          duplicateResolutionReply === "same" || duplicateResolutionReply === "different"
            ? recordSameOrDifferentResolution(
                turnContext,
                pendingState.activeFrame.candidateId,
                duplicateResolutionReply === "same" ? "same_person" : "different_person",
                resolvedAt
              )
            : duplicateResolutionReply === "ignore"
              ? clearLastReminder(turnContext)
              : turnContext;
        conversationContexts.set(message.userId, nextContext);
        const outboundText = duplicateResolutionOutboundText(
          duplicateResolutionReply,
          pendingState.activeFrame.displayName
        );
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${resolvedAt.replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            ...routeLog({
              intent: "answer_pending_contact_prompt",
              conversationRelation: "answers_open_workflow",
              frame: pendingState.activeFrame,
              confidence: 1,
              traceReason: "User resolved the same-name pending contact prompt.",
              policyDecision: { decision: "allow" },
              activeWorkflowKind: "duplicate_resolution"
            }),
            duplicateResolutionReply,
            pendingReminderDecision: "suppressed",
            pendingReminderReason: "not_search_interrupt",
            suppressedPendingReminder: true
          },
          outboundText,
          toolCalls,
          modelUsed: "deterministic-scope",
          confidence: 1,
          latencyMs: Date.now() - startedAt,
          createdAt: resolvedAt
        });

        return {
          outbound: {
            userId: message.userId,
            platform: message.platform,
            spaceId: message.spaceId,
            text: outboundText
          },
          toolCalls,
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      if (pendingState.activeFrame && looksLikeDirectPendingContactContext(message.text, pendingState.activeFrame)) {
        const savedMatches = listSavedMemoriesForDisplayName(
          repo,
          message.userId,
          pendingState.activeFrame.displayName
        );
        if (
          savedMatches.length > 0 &&
          !hasSameOrDifferentResolution(turnContext.reminderState ?? {}, pendingState.activeFrame.candidateId, pendingState.activeFrame.openedAt)
        ) {
          const outboundText = composeDuplicateResolutionPrompt({
            displayName: pendingState.activeFrame.displayName
          });
          const interaction = addInteractionWithTrace(repo, strictMode, {
            id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
            userId: message.userId,
            platform: message.platform,
            spaceId: message.spaceId,
            inboundText: message.text,
            interpretedIntentJson: routeLog({
              intent: "answer_pending_contact_prompt",
              conversationRelation: "answers_open_workflow",
              frame: pendingState.activeFrame,
              confidence: 1,
              traceReason: "Saved memory exists for the same display name; ask same-or-different before confirming.",
              policyDecision: { decision: "clarify" },
              activeWorkflowKind: "duplicate_resolution"
            }),
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
            interaction,
            trace: traceFromInteraction(interaction)
          };
        }

        const toolCalls: AgentToolCall[] = [];
        const candidate = tools.get_candidate(message.userId, pendingState.activeFrame.candidateId);
        const extractedContext = candidate
          ? cleanCandidateContextReply(message.text, candidate)
          : message.text.trim().replace(/\s+/g, " ");
        const reply = confirmPendingCandidate(message, candidateIntake, tools, toolCalls, pendingState);
        const expressionResult = await polishAgentReply(reply, expression);
        const outboundText = expressionResult.text;
        conversationContexts.set(message.userId, clearLastReminder(turnContext));
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            ...routeLog({
              intent: "capture_pending_contact_context",
              conversationRelation: "answers_open_workflow",
              frame: pendingState.activeFrame,
              extractedContext,
              confidence: 1,
              traceReason: "User supplied plausible relationship context for the active pending contact.",
              policyDecision: { decision: "allow" }
            }),
            pendingReminderDecision: "suppressed",
            pendingReminderReason: "not_search_interrupt",
            suppressedPendingReminder: true,
            ...expressionResult.metadata
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
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      if (pendingState.activeFrame && isWeakPendingContactReply(message.text)) {
        const toolCalls: AgentToolCall[] = [];
        const reply = pendingContactContextClarification(message, tools, toolCalls, pendingState);
        const expressionResult = await polishAgentReply(reply, expression);
        const outboundText = expressionResult.text;
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            ...routeLog({
              intent: "explain_pending_workflow",
              conversationRelation: "asks_about_open_workflow",
              frame: pendingState.activeFrame,
              confidence: 1,
              traceReason: "User sent a low-signal reply while a pending contact prompt is open.",
              policyDecision: { decision: "clarify", reason: "weak_pending_contact_reply" }
            }),
            pendingReminderDecision: "suppressed",
            pendingReminderReason: "not_search_interrupt",
            suppressedPendingReminder: true,
            ...expressionResult.metadata
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
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      if (isSearchContextReset(message.text)) {
        turnContext = clearSearchContext(existingContext);
        conversationContexts.set(message.userId, turnContext);
      } else {
        const followUp = executeFollowUpSearchIfPresent(message, turnContext, tools, message.receivedAt);
        if (followUp) {
          conversationContexts.set(message.userId, followUp.nextContext);
          const interaction = addInteractionWithTrace(repo, strictMode, {
            id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
            userId: message.userId,
            platform: message.platform,
            spaceId: message.spaceId,
            inboundText: message.text,
            interpretedIntentJson: {
              domain: "relationship_memory",
              intent: "followup_search",
              conversationRelation: "continues_previous_search",
              confidence: 1,
              searchContextId: existingContext.lastSearch?.searchContextId,
              policyDecision: { decision: "allow" }
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
            interaction,
            trace: traceFromInteraction(interaction)
          };
        }
      }

      const manualMemoryCreateRequest = detectManualMemoryCreateRequest(message.text);
      if (manualMemoryCreateRequest) {
        const toolCalls: AgentToolCall[] = ["create_manual_memory"];
        const memory = tools.create_manual_memory(
          message.userId,
          manualMemoryCreateRequest.displayName,
          manualMemoryCreateRequest.contextNote,
          "manual contact",
          {
            eventTitle: manualMemoryCreateRequest.eventTitle,
            idempotencyKey: manualMemoryIdempotencyKey(message, manualMemoryCreateRequest.displayName, 0),
            createdFromInteractionId: message.interactionId
          }
        );
        const outboundText = composeSaveConfirmation({ memories: [memory] });
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            domain: "relationship_memory",
            intent: "manual_memory_create",
            conversationRelation: "starts_new_relationship_task",
            target: { displayName: manualMemoryCreateRequest.displayName },
            extractedContext: manualMemoryCreateRequest.contextNote,
            confidence: 1,
            traceReason: "User explicitly asked Friendy to add relationship memory for a named person.",
            policyDecision: { decision: "allow" }
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
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      const hardSafety = decideHardSafety(message.text);
      if (hardSafety.decision === "reject") {
        const outboundText = hardSafety.redirect;
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            intent: "reject",
            routeSource: "scope_boundary",
            scopeDecision: { scope: "out_of_scope", reason: hardSafety.reason },
            hardSafetyDecision: hardSafety,
            policyDecision: { decision: "reject", reason: hardSafety.reason }
          },
          outboundText,
          toolCalls: [],
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
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      if (
        pendingState.activeFrame &&
        isPendingPromptContextReply(message.text) &&
        !isRelationshipMetaRouteMessage(message.text)
      ) {
        const toolCalls: AgentToolCall[] = [];
        const reply = confirmPendingCandidate(message, candidateIntake, tools, toolCalls, pendingState);
        const expressionResult = await polishAgentReply(reply, expression);
        const outboundText = expressionResult.text;
        conversationContexts.set(message.userId, clearLastReminder(turnContext));
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            intent: "candidate_confirmation",
            confidence: 1,
            policyDecision: { decision: "allow" },
            pendingReminderDecision: "suppressed",
            pendingReminderReason: "not_search_interrupt",
            suppressedPendingReminder: true,
            ...expressionResult.metadata
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
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      if (shouldBypassModelForListPeopleRecall(message.text)) {
        const interpretation: MessageInterpretation = {
          intent: "list_people",
          confidence: 1,
          domain: "relationship_memory",
          conversationRelation: "starts_new_relationship_task",
          search: {
            mode: "list_people",
            semanticQuery: message.text,
            exactTerms: [],
            topK: 20
          },
          people: [],
          event: { name: "", dateText: "", location: "" },
          dateContext: undefined,
          contextNote: "",
          query: message.text,
          tags: [],
          needsClarification: false,
          clarificationQuestion: ""
        };
        const toolCalls: AgentToolCall[] = [];
        const reply = executeInterpretation(message, interpretation, repo, tools, candidateIntake, toolCalls, pendingState);
        const expressionResult = await polishAgentReply(reply, expression);
        conversationContexts.set(message.userId, {
          ...clearSearchContext(turnContext),
          activeMemoryId: undefined,
          reminderState: turnContext.reminderState ?? {}
        });
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            ...interpretation,
            interpretation,
            routeSource: "deterministic",
            fallbackUsed: false,
            policyDecision: {
              decision: "allow",
              reason: "Allowed deterministic list_people route.",
              suppressPendingReminder: true
            },
            pendingReminderDecision: "suppressed",
            pendingReminderReason: "not_search_interrupt",
            suppressedPendingReminder: true,
            ...expressionResult.metadata
          },
          outboundText: expressionResult.text,
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
            text: expressionResult.text
          },
          toolCalls,
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      const routerContext = buildRouterInputEnvelope({
        message,
        conversationState: pendingState,
        memories: repo.listMemories(message.userId),
        availableTools: ROUTER_AVAILABLE_TOOLS,
        availableRouteCapabilities: ROUTER_AVAILABLE_ROUTE_CAPABILITIES
      });
      const interpreted = await interpreter.interpret({ message, routerContext });
      if (strictMode && interpreted.fallbackUsed) {
        throw new FriendyStrictModeError(
          "FALLBACK_USED",
          "Fallback interpreter is not allowed in Friendy strict mode.",
          createFriendyTrace({
            strictMode: true,
            routeSource: "fallback",
            fallbackUsed: true,
            fallbackReason: interpreted.fallbackReason,
            route: interpreted.interpretation,
            policyDecision: "reject",
            modelRequested: interpreted.modelRequested,
            modelResponseSchemaValid: interpreted.modelResponseSchemaValid,
            modelErrorCode: interpreted.modelErrorCode,
            toolCalls: []
          })
        );
      }
      const interpretation = repairPendingPromptRecallMisroute(
        enrichInterpretationWithContext(
          interpreted.interpretation,
          turnContext,
          parseTemporalContext(message.text, { receivedAt: message.receivedAt, timezone }),
          message.text
        ),
        pendingState,
        message.text
      );
      const basePolicy = validateRoutePolicy(interpretation, pendingState);
      const routePolicy =
        basePolicy.decision !== "allow"
          ? basePolicy
          : validateRequiredToolAvailability(interpretation, tools as Record<AgentToolCall, unknown>) ?? basePolicy;
      if (routePolicy && routePolicy.decision !== "allow") {
        const blockedPolicy = routePolicy as Exclude<ValidatedRoutePolicy, { decision: "allow" }>;
        const outboundText = policyBlockOutboundText(blockedPolicy);
        const trace = createFriendyTrace({
          strictMode,
          routeSource: interpreted.routeSource,
          fallbackUsed: interpreted.fallbackUsed,
          fallbackReason: interpreted.fallbackReason,
          modelRequested: interpreted.modelRequested,
          modelResponseSchemaValid: interpreted.modelResponseSchemaValid,
          modelErrorCode: interpreted.modelErrorCode,
          route: interpretation,
          policyDecision: routePolicy.decision,
          suppressedPendingReminder: routePolicy.suppressPendingReminder,
          toolCalls: []
        });
        if (strictMode) {
          if (routePolicy.decision === "unsupported") {
            throw new FriendyStrictModeError(
              routePolicy.reason.includes("Required tool") ? "TOOL_NOT_AVAILABLE" : "UNSUPPORTED_INTENT",
              routePolicy.reason,
              trace
            );
          }

          if (routePolicy.decision === "clarify" && interpretation.intent === "unknown") {
            throw new FriendyStrictModeError("UNKNOWN_ROUTE", routePolicy.reason, trace);
          }
        }

        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            ...interpretation,
            interpretation,
            routeSource: interpreted.routeSource,
            fallbackUsed: interpreted.fallbackUsed,
            fallbackReason: interpreted.fallbackReason,
            modelRequested: interpreted.modelRequested,
            modelResponseSchemaValid: interpreted.modelResponseSchemaValid,
            modelErrorCode: interpreted.modelErrorCode,
            policyDecision: {
              decision: routePolicy.decision,
              reason: routePolicy.reason,
              suppressPendingReminder: routePolicy.suppressPendingReminder
            }
          },
          outboundText,
          toolCalls: [],
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
          toolCalls: [],
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }
      const allowedPolicy = routePolicy ?? {
        decision: "allow" as const,
        reason: `Allowed route ${interpretation.intent}.`,
        suppressPendingReminder: false
      };
      const interpretedMutationRequest = memoryMutationRequestFromInterpretation(message, interpretation);
      if (interpretedMutationRequest) {
        const toolCalls: AgentToolCall[] = [];
        const mutation = executeMemoryMutationRequest(
          message,
          interpretedMutationRequest,
          repo,
          tools,
          turnContext,
          toolCalls,
          now(),
          strictMode
        );
        const mutationPolicyDecision = policyDecisionForMemoryMutation(mutation.nextContext, interpretedMutationRequest.kind);
        conversationContexts.set(message.userId, mutation.nextContext);
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            ...interpretation,
            interpretation,
            routeSource: interpreted.routeSource,
            fallbackUsed: interpreted.fallbackUsed,
            fallbackReason: interpreted.fallbackReason,
            modelRequested: interpreted.modelRequested,
            modelResponseSchemaValid: interpreted.modelResponseSchemaValid,
            modelErrorCode: interpreted.modelErrorCode,
            memoryMutationRequest: interpretedMutationRequest,
            policyDecision: {
              decision: mutationPolicyDecision.decision,
              reason: mutationPolicyDecision.reason ?? allowedPolicy.reason,
              suppressPendingReminder: true
            },
            pendingReminderDecision: "suppressed",
            pendingReminderReason: "not_search_interrupt",
            suppressedPendingReminder: true,
            activeWorkflowKind:
              interpretedMutationRequest.kind === "delete" ? "pending_delete_confirm" : "pending_update_confirm",
            selectedTool: toolCalls[0]
          },
          outboundText: mutation.outboundText,
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
            text: mutation.outboundText
          },
          toolCalls,
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }
      const toolCalls: AgentToolCall[] = [];
      const searchRequestForTrace =
        interpretation.intent === "search_memory" ? buildMemorySearchRequest(message, interpretation) : undefined;
      const replyDraft = executeInterpretation(
        message,
        interpretation,
        repo,
        tools,
        candidateIntake,
        toolCalls,
        pendingState
      );
      const expressionResult = await polishAgentReply(replyDraft, expression);
      let outboundText = expressionResult.text;
      const pendingReminderNow = now();
      const pendingReminder = decidePendingReminder(
        buildPendingReminderContext({
          message,
          interpretation,
          pendingState,
          repo,
          reminderState: turnContext.reminderState ?? {},
          now: pendingReminderNow
        })
      );
      if (pendingReminder.action === "append") {
        const footer = composePendingContactsFooter({
          items: pendingReminder.candidates.map((candidate) => ({
            displayName: candidate.displayName
          }))
        });
        if (footer.length > 0) {
          outboundText = `${outboundText}\n\n${footer}`;
        }
      }
      let nextContext = updateSearchContext(
        message,
        tools,
        updateConversationContext(turnContext, interpretation),
        interpretation
      );
      nextContext = {
        ...nextContext,
        reminderState: updateReminderState(
          turnContext.reminderState ?? {},
          pendingReminder,
          pendingState,
          interpretation,
          pendingReminderNow
        )
      };
      if (interpretation.intent === "delete_memory_request") {
        nextContext = attachPendingDeleteContext(message, interpretation, repo, nextContext);
      }
      conversationContexts.set(message.userId, nextContext);

      const interaction = addInteractionWithTrace(repo, strictMode, {
        id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
        userId: message.userId,
        platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            ...interpretation,
            interpretation,
            routeSource: interpreted.routeSource,
            fallbackUsed: interpreted.fallbackUsed,
            fallbackReason: interpreted.fallbackReason,
            modelRequested: interpreted.modelRequested,
            modelResponseSchemaValid: interpreted.modelResponseSchemaValid,
            modelErrorCode: interpreted.modelErrorCode,
            policyDecision: {
              decision: "allow",
              reason: allowedPolicy.reason,
              suppressPendingReminder: allowedPolicy.suppressPendingReminder
            },
            pendingReminderDecision: tracePendingReminderDecision(pendingReminder),
            pendingReminderReason: pendingReminder.reason,
            suppressedPendingReminder: pendingReminder.action !== "append",
            normalizedQuery: searchRequestForTrace?.normalizedQuery || undefined,
            ...expressionResult.metadata
          },
          outboundText,
        toolCalls,
        modelUsed: interpreted.modelUsed,
        confidence: interpretation.confidence,
        latencyMs: Date.now() - startedAt,
        error: interpreted.error,
        createdAt: now()
      });

      span.setAttributes({
        "gen_ai.output.messages": JSON.stringify(outputMessages(outboundText)),
        "friendy.intent": interpretation.intent,
        "friendy.tool_calls": JSON.stringify(toolCalls)
      });
      span.setStatus({ code: SpanStatusCode.OK });

      return {
        outbound: {
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          text: outboundText
        },
        toolCalls,
        interaction,
        trace: traceFromInteraction(interaction)
      };
      } catch (error) {
        recordSpanError(span, error);
        throw error;
      } finally {
        span.end();
      }
    }
  };
}

function policyBlockOutboundText(
  policy: Exclude<ValidatedRoutePolicy, { decision: "allow" }>
): string {
  switch (policy.decision) {
    case "clarify":
      return composeClarificationReply(policy.question);
    case "reject":
      return policy.redirect;
    case "unsupported":
      return policy.outboundText;
  }
}

function attachPendingDeleteContext(
  message: InboundAgentMessage,
  interpretation: MessageInterpretation,
  repo: RelationshipRepository,
  context: ConversationContext
): ConversationContext {
  const query = extractDeleteTargetQuery(message.text, interpretation);
  const matches = rankDisplayNameMatches(
    query,
    repo.listMemories(message.userId).map((memory) => memory.displayName)
  );
  if (matches.length !== 1) {
    return context;
  }

  const memory = repo
    .listMemories(message.userId)
    .find((item) => item.displayName === matches[0]?.displayName);
  if (!memory) {
    return context;
  }

  return {
    ...context,
    pendingDelete: {
      memoryId: memory.id,
      displayName: memory.displayName
    }
  };
}

function buildPendingReminderContext(input: {
  message: InboundAgentMessage;
  interpretation: MessageInterpretation;
  pendingState: ConversationState;
  repo: RelationshipRepository;
  reminderState: PendingReminderState;
  now: string;
}): PendingReminderContext {
  const active = input.pendingState.activeFrame;
  const savedMemoriesForActiveName = active
    ? listSavedMemoriesForDisplayName(input.repo, input.message.userId, active.displayName).map((memory) => ({
        memoryId: memory.id,
        displayName: memory.displayName
      }))
    : [];

  return {
    userText: input.message.text,
    userIntent: input.interpretation.intent,
    searchMode: input.interpretation.search?.mode,
    responseKind: responseKindForInterpretation(input.interpretation),
    now: input.now,
    activeWorkflow: active
      ? {
          kind: "pending_contact_confirmation",
          frameId: active.frameId,
          candidateId: active.candidateId,
          displayName: active.displayName,
          lastFriendyPrompt: active.lastFriendyPrompt
        }
      : undefined,
    pendingCandidates: input.pendingState.pendingContactQueue.map((candidate) => ({
      candidateId: candidate.candidateId,
      displayName: candidate.displayName,
      status: candidate.status
    })),
    savedMemoriesForActiveName,
    duplicateRisk: savedMemoriesForActiveName.length > 0,
    sameNameDisambiguationPending: Boolean(
      active &&
        savedMemoriesForActiveName.length > 0 &&
        !hasSameOrDifferentResolution(input.reminderState, active.candidateId, active.openedAt)
    ),
    listedEntityIds: [],
    reminderState: input.reminderState
  };
}

function responseKindForInterpretation(interpretation: MessageInterpretation): PendingReminderResponseKind {
  if (interpretation.intent === "list_people" || interpretation.search?.mode === "list_people") {
    return "list_people";
  }

  if (interpretation.intent === "search_memory") {
    return "search_result";
  }

  if (interpretation.intent === "explain_agent_state" || interpretation.intent === "explain_pending_workflow") {
    return "explain";
  }

  if (interpretation.intent === "conversation_repair") {
    return "repair";
  }

  if (interpretation.intent === "duplicate_audit") {
    return "duplicate_audit";
  }

  if (interpretation.intent === "delete_memory_request") {
    return "delete_confirm";
  }

  if (
    interpretation.intent === "capture_pending_contact_context" ||
    interpretation.intent === "answer_pending_contact_prompt"
  ) {
    return "capture_context";
  }

  if (interpretation.intent === "clarify" || interpretation.needsClarification) {
    return "clarify";
  }

  return "other";
}

function updateReminderState(
  previous: PendingReminderState,
  decision: PendingReminderDecision,
  pendingState: ConversationState,
  interpretation: MessageInterpretation,
  now: string
): PendingReminderState {
  const next: PendingReminderState = { ...previous };

  if (decision.action === "append" && pendingState.activeFrame) {
    next.lastReminderAt = now;
    next.lastRemindedCandidateId = pendingState.activeFrame.candidateId;
  }

  if (interpretation.intent === "conversation_repair" || interpretation.intent === "explain_agent_state") {
    next.lastUserComplaintAt = now;
  }

  if (
    interpretation.intent === "capture_pending_contact_context" ||
    interpretation.intent === "answer_pending_contact_prompt"
  ) {
    next.lastReminderAt = undefined;
    next.lastRemindedCandidateId = undefined;
  }

  return next;
}

function clearLastReminder(context: ConversationContext): ConversationContext {
  return {
    ...context,
    reminderState: {
      ...context.reminderState,
      lastReminderAt: undefined,
      lastRemindedCandidateId: undefined
    }
  };
}

function recordSameOrDifferentResolution(
  context: ConversationContext,
  candidateId: string,
  resolution: "same_person" | "different_person",
  resolvedAt: string
): ConversationContext {
  const previous = context.reminderState?.sameOrDifferentResolutions ?? [];
  return {
    ...context,
    reminderState: {
      ...context.reminderState,
      sameOrDifferentResolutions: [
        ...previous.filter((item) => item.candidateId !== candidateId),
        { candidateId, resolution, resolvedAt }
      ]
    }
  };
}

function hasSameOrDifferentResolution(
  state: PendingReminderState,
  candidateId: string,
  openedAt: string
): boolean {
  const openedAtMs = Date.parse(openedAt);
  return (
    state.sameOrDifferentResolutions?.some((resolution) => {
      if (resolution.candidateId !== candidateId) {
        return false;
      }

      const resolvedAtMs = Date.parse(resolution.resolvedAt);
      return Number.isNaN(openedAtMs) || Number.isNaN(resolvedAtMs) || resolvedAtMs >= openedAtMs;
    }) ?? false
  );
}

function tracePendingReminderDecision(
  decision: PendingReminderDecision
): NonNullable<FriendyTrace["pendingReminderDecision"]> {
  switch (decision.action) {
    case "append":
      return "appended_footer";
    case "defer":
      return "deferred";
    case "suppress":
      return "suppressed";
  }
}

function addInteractionWithTrace(
  repo: RelationshipRepository,
  strictMode: boolean,
  interaction: AgentInteraction
): AgentInteraction {
  const friendyTrace = traceFromInteractionFields(interaction, strictMode);
  const interpretedIntentJson = attachFriendyTrace(interaction.interpretedIntentJson, friendyTrace);
  return repo.addInteraction({
    ...interaction,
    interpretedIntentJson,
    redactedTraceJson: buildRedactedInteractionTrace({
      inboundText: interaction.inboundText,
      interpretedIntentJson,
      toolCalls: interaction.toolCalls as AgentToolCall[],
      outboundText: interaction.outboundText,
      model: modelTraceFromInteraction(interaction.modelUsed),
      friendyTrace,
      errors: interaction.error ? [interaction.error] : [],
      now: interaction.createdAt
    })
  });
}

function traceFromInteraction(interaction: AgentInteraction): FriendyTrace {
  return extractFriendyTrace(interaction.interpretedIntentJson);
}

function attachFriendyTrace(value: unknown, trace: FriendyTrace): unknown {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return {
      ...value,
      trace
    };
  }

  return { trace };
}

function traceFromInteractionFields(interaction: AgentInteraction, strictMode: boolean): FriendyTrace {
  const routeSource = routeSourceFromInteraction(interaction);
  const route = typeof interaction.interpretedIntentJson === "object" ? interaction.interpretedIntentJson : undefined;
  const target = targetFromRoute(route);

  return createFriendyTrace({
    strictMode,
    routeSource,
    fallbackUsed: routeSource === "fallback",
    fallbackReason: routeSource === "fallback" ? fallbackReasonFromInteraction(interaction) : undefined,
    route,
    policyDecision: policyDecisionFromInteraction(interaction),
    suppressedPendingReminder: suppressedPendingReminderFromInteraction(interaction),
    pendingReminderDecision: pendingReminderDecisionFromInteraction(interaction),
    pendingReminderReason: pendingReminderReasonFromInteraction(interaction),
    activeFrameId: target.frameId,
    activeCandidateId: target.candidateId,
    activeMemoryId: target.memoryId,
    toolCalls: interaction.toolCalls as AgentToolCall[],
    scopeDecision: friendyScopeDecisionFromInteraction(interaction),
    activeWorkflowKind: activeWorkflowKindFromInteraction(interaction),
    selectedTool: selectedToolFromInteraction(interaction),
    modelRequested: modelRequestedFromInteraction(interaction),
    modelResponseSchemaValid: modelResponseSchemaValidFromInteraction(interaction),
    modelErrorCode: modelErrorCodeFromInteraction(interaction)
  });
}

function routeSourceFromModel(modelUsed: string | undefined): FriendyRouteSource {
  if (modelUsed === "rule-based-fallback") {
    return "fallback";
  }

  if (!modelUsed || modelUsed === "deterministic-scope") {
    return "deterministic";
  }

  return "llm";
}

function routeSourceFromInteraction(interaction: AgentInteraction): FriendyRouteSource {
  const routeSource = routeSourceMetadataFromRoute(interaction.interpretedIntentJson);
  return routeSource ?? routeSourceFromModel(interaction.modelUsed);
}

function routeSourceMetadataFromRoute(value: unknown): FriendyRouteSource | undefined {
  if (typeof value !== "object" || value === null || !("routeSource" in value)) {
    return undefined;
  }

  const routeSource = String((value as { routeSource?: unknown }).routeSource);
  if (routeSource === "llm" || routeSource === "deterministic" || routeSource === "fallback" || routeSource === "scope_boundary") {
    return routeSource;
  }

  return undefined;
}

function fallbackReasonFromInteraction(interaction: AgentInteraction): string {
  const routeFallbackReason = fallbackReasonMetadataFromRoute(interaction.interpretedIntentJson);
  if (routeFallbackReason) {
    return routeFallbackReason;
  }

  if (interaction.error) {
    return "model_interpreter_error";
  }

  return "rule_based_interpreter";
}

function fallbackReasonMetadataFromRoute(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("fallbackReason" in value)) {
    return undefined;
  }

  const fallbackReason = (value as { fallbackReason?: unknown }).fallbackReason;
  return typeof fallbackReason === "string" && fallbackReason.length > 0 ? fallbackReason : undefined;
}

function friendyScopeDecisionFromInteraction(interaction: AgentInteraction): FriendyTrace["scopeDecision"] | undefined {
  const scopeDecision = scopeDecisionFromRoute(interaction.interpretedIntentJson);
  if (scopeDecision === "in_scope" || scopeDecision === "out_of_scope") {
    return scopeDecision;
  }

  if (scopeDecision === "needs_clarification" || scopeDecision === "clarify") {
    return "clarify";
  }

  return undefined;
}

function policyDecisionFromInteraction(interaction: AgentInteraction): FriendyPolicyDecision | undefined {
  const explicit = policyDecisionFromRoute(interaction.interpretedIntentJson);
  if (explicit) {
    return explicit;
  }

  const hardSafetyDecision = hardSafetyDecisionFromRoute(interaction.interpretedIntentJson);
  if (hardSafetyDecision === "reject") {
    return "reject";
  }

  const scopeDecision = scopeDecisionFromRoute(interaction.interpretedIntentJson);
  if (scopeDecision === "out_of_scope") {
    return "reject";
  }

  if (scopeDecision === "needs_clarification") {
    return "clarify";
  }

  return "allow";
}

function policyDecisionFromRoute(value: unknown): FriendyPolicyDecision | undefined {
  if (typeof value !== "object" || value === null || !("policyDecision" in value)) {
    return undefined;
  }

  const policyDecision = (value as { policyDecision?: unknown }).policyDecision;
  if (typeof policyDecision !== "object" || policyDecision === null || !("decision" in policyDecision)) {
    return undefined;
  }

  const decision = String((policyDecision as { decision: unknown }).decision);
  if (decision === "allow" || decision === "clarify" || decision === "reject" || decision === "unsupported") {
    return decision;
  }

  return undefined;
}

function composeStartedReplyWithQueuedContacts(baseReply: string, pendingCandidates: ContactCandidate[]): string {
  if (pendingCandidates.length === 0) {
    return baseReply;
  }

  if (pendingCandidates.length === 1) {
    const [candidate] = pendingCandidates;
    return `${baseReply}\n\nI noticed you added ${candidate.displayName}. Where did you meet them?`;
  }

  const footer = composePendingContactsFooter({
    items: pendingCandidates.map((candidate) => ({ displayName: candidate.displayName }))
  });
  return `${baseReply}\n\n${footer}`;
}

function shouldBypassModelForListPeopleRecall(text: string): boolean {
  if (!isListPeopleRecall(text)) {
    return false;
  }

  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/\bu\b/g, "you")
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ");

  return [
    /^list(?: me)? (?:all|every|everyone|everybody|the) (?:people|persons?|contacts?) i (?:met|know|saved|remember)$/,
    /^list(?: me)? (?:all|every|everyone|everybody|the) (?:people|persons?|contacts?)$/,
    /^what (?:person|people|contacts?) do i (?:know|have|met|saved|remember)(?: so far)?$/,
    /^what (?:person|people|contacts?) do you (?:know|have|remember)(?: (?:yet|so far))?(?: (?:in|from))? my (?:contact|contacts|network)$/,
    /^who do i (?:know|have|met|saved|remember)$/
  ].some((pattern) => pattern.test(normalized));
}

function suppressedPendingReminderFromInteraction(interaction: AgentInteraction): boolean | undefined {
  if (typeof interaction.interpretedIntentJson !== "object" || interaction.interpretedIntentJson === null) {
    return undefined;
  }

  if ("suppressedPendingReminder" in interaction.interpretedIntentJson) {
    const suppressed = (interaction.interpretedIntentJson as { suppressedPendingReminder?: unknown })
      .suppressedPendingReminder;
    if (typeof suppressed === "boolean") {
      return suppressed;
    }
  }

  const policyDecision = (interaction.interpretedIntentJson as { policyDecision?: unknown }).policyDecision;
  if (typeof policyDecision !== "object" || policyDecision === null || !("suppressPendingReminder" in policyDecision)) {
    return undefined;
  }

  const suppressed = (policyDecision as { suppressPendingReminder?: unknown }).suppressPendingReminder;
  return typeof suppressed === "boolean" ? suppressed : undefined;
}

function pendingReminderDecisionFromInteraction(
  interaction: AgentInteraction
): FriendyTrace["pendingReminderDecision"] | undefined {
  if (typeof interaction.interpretedIntentJson !== "object" || interaction.interpretedIntentJson === null) {
    return undefined;
  }

  const decision = (interaction.interpretedIntentJson as { pendingReminderDecision?: unknown }).pendingReminderDecision;
  return decision === "suppressed" || decision === "deferred" || decision === "appended_footer" ? decision : undefined;
}

function pendingReminderReasonFromInteraction(interaction: AgentInteraction): PendingReminderReason | undefined {
  if (typeof interaction.interpretedIntentJson !== "object" || interaction.interpretedIntentJson === null) {
    return undefined;
  }

  const reason = (interaction.interpretedIntentJson as { pendingReminderReason?: unknown }).pendingReminderReason;
  return typeof reason === "string" && (PENDING_REMINDER_REASON_CODES as readonly string[]).includes(reason)
    ? (reason as PendingReminderReason)
    : undefined;
}

function activeWorkflowKindFromInteraction(interaction: AgentInteraction): FriendyTrace["activeWorkflowKind"] | undefined {
  if (typeof interaction.interpretedIntentJson !== "object" || interaction.interpretedIntentJson === null) {
    return undefined;
  }

  const kind = (interaction.interpretedIntentJson as { activeWorkflowKind?: unknown }).activeWorkflowKind;
  if (
    kind === "pending_contact_confirm" ||
    kind === "duplicate_resolution" ||
    kind === "pending_delete_confirm" ||
    kind === "pending_update_confirm" ||
    kind === "none"
  ) {
    return kind;
  }

  return undefined;
}

function selectedToolFromInteraction(interaction: AgentInteraction): FriendyTrace["selectedTool"] | undefined {
  if (typeof interaction.interpretedIntentJson !== "object" || interaction.interpretedIntentJson === null) {
    return undefined;
  }

  const selectedTool = (interaction.interpretedIntentJson as { selectedTool?: unknown }).selectedTool;
  return typeof selectedTool === "string" ? selectedTool : undefined;
}

function modelRequestedFromInteraction(interaction: AgentInteraction): FriendyTrace["modelRequested"] | undefined {
  if (typeof interaction.interpretedIntentJson !== "object" || interaction.interpretedIntentJson === null) {
    return undefined;
  }

  const modelRequested = (interaction.interpretedIntentJson as { modelRequested?: unknown }).modelRequested;
  return typeof modelRequested === "string" ? modelRequested : undefined;
}

function modelResponseSchemaValidFromInteraction(
  interaction: AgentInteraction
): FriendyTrace["modelResponseSchemaValid"] | undefined {
  if (typeof interaction.interpretedIntentJson !== "object" || interaction.interpretedIntentJson === null) {
    return undefined;
  }

  const modelResponseSchemaValid = (interaction.interpretedIntentJson as { modelResponseSchemaValid?: unknown })
    .modelResponseSchemaValid;
  return typeof modelResponseSchemaValid === "boolean" ? modelResponseSchemaValid : undefined;
}

function modelErrorCodeFromInteraction(interaction: AgentInteraction): FriendyTrace["modelErrorCode"] | undefined {
  if (typeof interaction.interpretedIntentJson !== "object" || interaction.interpretedIntentJson === null) {
    return undefined;
  }

  const modelErrorCode = (interaction.interpretedIntentJson as { modelErrorCode?: unknown }).modelErrorCode;
  return typeof modelErrorCode === "string" ? modelErrorCode : undefined;
}

function hardSafetyDecisionFromRoute(value: unknown): "reject" | undefined {
  if (typeof value !== "object" || value === null || !("hardSafetyDecision" in value)) {
    return undefined;
  }

  const hardSafetyDecision = (value as { hardSafetyDecision?: unknown }).hardSafetyDecision;
  if (typeof hardSafetyDecision !== "object" || hardSafetyDecision === null || !("decision" in hardSafetyDecision)) {
    return undefined;
  }

  return (hardSafetyDecision as { decision: unknown }).decision === "reject" ? "reject" : undefined;
}

function scopeDecisionFromRoute(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("scopeDecision" in value)) {
    return undefined;
  }

  const scopeDecision = (value as { scopeDecision?: unknown }).scopeDecision;
  if (typeof scopeDecision !== "object" || scopeDecision === null || !("scope" in scopeDecision)) {
    return undefined;
  }

  return String((scopeDecision as { scope: unknown }).scope);
}

function targetFromRoute(value: unknown): { frameId?: string; candidateId?: string; memoryId?: string } {
  if (typeof value !== "object" || value === null || !("target" in value)) {
    return {};
  }

  const target = (value as { target?: unknown }).target;
  if (typeof target !== "object" || target === null) {
    return {};
  }

  return {
    frameId: typeof (target as { frameId?: unknown }).frameId === "string" ? (target as { frameId: string }).frameId : undefined,
    candidateId:
      typeof (target as { candidateId?: unknown }).candidateId === "string"
        ? (target as { candidateId: string }).candidateId
        : undefined,
    memoryId: typeof (target as { memoryId?: unknown }).memoryId === "string" ? (target as { memoryId: string }).memoryId : undefined
  };
}

function modelTraceFromInteraction(modelUsed: string | undefined): AgentTrace["model"] {
  if (!modelUsed) {
    return { used: false, fallbackUsed: true };
  }

  const deterministic = modelUsed === "deterministic-scope" || modelUsed === "rule-based-fallback";
  return {
    used: !deterministic,
    provider: deterministic ? undefined : "openai",
    modelName: modelUsed,
    fallbackUsed: deterministic
  };
}

function routeLog({
  intent,
  conversationRelation,
  frame,
  extractedContext,
  confidence,
  traceReason,
  policyDecision,
  activeWorkflowKind
}: {
  intent: string;
  conversationRelation: string;
  frame: PendingContactContextFrame;
  extractedContext?: string;
  confidence: number;
  traceReason: string;
  policyDecision: { decision: "allow" | "reject" | "clarify"; reason?: string };
  activeWorkflowKind?: FriendyTrace["activeWorkflowKind"];
}) {
  return {
    domain: "relationship_memory",
    intent,
    conversationRelation,
    target: {
      frameId: frame.frameId,
      candidateId: frame.candidateId,
      displayName: frame.displayName
    },
    extractedContext,
    confidence,
    traceReason,
    policyDecision,
    activeWorkflowKind
  };
}

function duplicateResolutionOutboundText(
  resolution: NonNullable<ReturnType<typeof parseDuplicateResolutionReply>>,
  displayName: string
): string {
  switch (resolution) {
    case "same":
      return `Got it - I'll treat this as the same ${displayName}. What should I remember about them?`;
    case "different":
      return `Got it - I'll treat this as a different ${displayName}. What should I remember about them?`;
    case "ignore":
      return composeIgnoreCandidateReply({ candidateName: displayName });
    case "not_sure":
      return `No problem - reply same if ${displayName} is the person you already saved, different if this is someone new, or ignore to skip.`;
  }
}

function parseNumberedSelection(value: string): number | undefined {
  const match = /^\s*(\d+)\s*$/u.exec(value);
  if (!match) {
    return undefined;
  }

  const index = Number(match[1]) - 1;
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

function isMemoryMutationCancelReply(value: string): boolean {
  return /^(?:no|nope|cancel|cancel it|never mind|nevermind|stop|don't|do not)$/iu.test(value.trim());
}

function isWeakPendingContactReply(value: string): boolean {
  return /^(?:hi|hello|hey|yo|ok|okay|k|cool|nice|great|thanks|thank you|ty|lol|haha|👍)$/iu.test(value.trim());
}

function looksLikeDirectPendingContactContext(text: string, frame: PendingContactContextFrame): boolean {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase().replace(/\bu\b/g, "you");

  if (!trimmed || trimmed.length > 220 || trimmed.includes("?")) {
    return false;
  }

  if (/^(ignore|delete|remove|forget)\b/i.test(trimmed)) {
    return false;
  }

  if (/^(who|what|where|when|why|how|find|show|list|give|tell)\b/i.test(trimmed)) {
    return false;
  }

  if (/^(?:ok\s+)?(?:(?:can|could|would)\s+(?:you|u)\s+)?(?:please\s+)?(?:add|save|remember)\b/i.test(trimmed)) {
    return false;
  }

  if (/^(?:this|that)\s+is\b/i.test(trimmed)) {
    return true;
  }

  if (/^(she|he|they|them|her|him)\s+(?:is|was|are|were|works?|knows?|met|talked|needs?|has|had)\b/i.test(trimmed)) {
    return true;
  }

  const firstName = frame.displayName.split(/\s+/).filter(Boolean)[0] ?? "";
  const namePattern = [frame.displayName, firstName].filter(Boolean).map(escapeRegExp).join("|");
  if (namePattern.length > 0) {
    const namedFact = new RegExp(
      `^(?:${namePattern})\\s+(?:is|was|are|were|works?|knows?|met|talked|needs?|has|had)\\b`,
      "i"
    );
    if (namedFact.test(trimmed)) {
      return true;
    }
  }

  return (
    /^(?:i\s+)?met\b/i.test(trimmed) ||
    /^(met|need to follow up|follow up|talked|we talked|works?|knows?|community lead|member|founder|designer|from|at|through)\b/.test(
      lower
    )
  );
}

function detectManualMemoryCreateRequest(text: string): ManualMemoryCreateRequest | undefined {
  const normalized = text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[?.!]+$/g, "");
  const match =
    /^(?:ok\s+)?(?:(?:can|could|would)\s+(?:you|u)\s+)?(?:please\s+)?(?:add|save|remember)\s+([A-Z][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*){1,3})\s+(?:as\s+(?:the\s+|an?\s+)?|is\s+(?:the\s+|an?\s+)?|from\s+|at\s+)(.+?)(?:\s+too)?(?:\s+for\s+me)?(?:\s+please)?$/iu.exec(
      normalized
    );
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  const displayName = match[1].trim();
  const contextNote = cleanManualMemoryContext(match[2]);
  if (!contextNote) {
    return undefined;
  }

  return {
    displayName,
    contextNote,
    eventTitle: extractManualEventTitle(contextNote)
  };
}

function cleanManualMemoryContext(value: string): string {
  return value
    .trim()
    .replace(/^(?:the\s+|an?\s+)/i, "")
    .replace(/\s+/g, " ");
}

function extractManualEventTitle(contextNote: string): string | undefined {
  const match = /\b(?:at|from|of)\s+([A-Z][\p{L}0-9&.'-]*(?:\s+[A-Z0-9IIIVX][\p{L}0-9&.'-]*){0,5})$/u.exec(
    contextNote
  );
  return match?.[1]?.trim();
}

function policyDecisionForMemoryMutation(
  nextContext: ConversationContext,
  kind: MemoryMutationRequest["kind"]
): { decision: "allow" | "clarify"; reason?: string } {
  if (kind === "delete" && nextContext.pendingDelete?.options?.length) {
    return { decision: "clarify", reason: "ambiguous_delete_target" };
  }

  if (kind === "update" && nextContext.pendingUpdate?.options?.length) {
    return { decision: "clarify", reason: "ambiguous_update_target" };
  }

  return { decision: "allow" };
}

function executeMemoryMutationRequest(
  message: InboundAgentMessage,
  request: MemoryMutationRequest,
  repo: RelationshipRepository,
  tools: RelationshipTools,
  context: ConversationContext,
  toolCalls: AgentToolCall[],
  now: string,
  strictMode: boolean
): { outboundText: string; nextContext: ConversationContext } {
  if (request.kind === "delete") {
    toolCalls.push("lookup_memory_target");
    const lookup = tools.lookup_memory_target(message.userId, request.query, { operation: "delete", includeContext: true });
    if (lookup.kind === "none") {
      return { outboundText: composeNoMatchReply(), nextContext: context };
    }

    if (lookup.kind === "ambiguous") {
      return {
        outboundText: composeDeleteMemoryDisambiguationReply({
          query: lookup.query,
          options: lookup.options.map((option) => ({ displayName: option.displayName }))
        }),
        nextContext: {
          ...context,
          pendingDelete: {
            query: lookup.query,
            options: lookup.options.map((option) => ({
              memoryId: option.memoryId,
              displayName: option.displayName
            }))
          }
        }
      };
    }

    return {
      outboundText: composeDeleteMemoryConfirmReply({
        matches: [{ displayName: lookup.displayName }]
      }),
      nextContext: {
        ...clearSearchContext(context),
        pendingDelete: {
          memoryId: lookup.memoryId,
          displayName: lookup.displayName
        }
      }
    };
  }

  if (request.kind === "update" && request.query) {
    toolCalls.push("lookup_memory_target");
    const lookup = tools.lookup_memory_target(message.userId, request.query, { operation: "update", includeContext: true });
    if (lookup.kind === "none") {
      return { outboundText: composeNoMatchReply(), nextContext: context };
    }

    if (lookup.kind === "ambiguous") {
      return {
        outboundText: composeUpdateMemoryDisambiguationReply({
          query: lookup.query,
          options: lookup.options.map((option) => ({ displayName: option.displayName }))
        }),
        nextContext: {
          ...context,
          pendingUpdate: {
            query: lookup.query,
            proposedContextNote: request.contextNote,
            options: lookup.options.map((option) => ({
              memoryId: option.memoryId,
              displayName: option.displayName
            }))
          }
        }
      };
    }

    return {
      outboundText: composeUpdateMemoryConfirmReply({
        displayName: lookup.displayName,
        proposedContextNote: request.contextNote
      }),
      nextContext: {
        ...clearSearchContext(context),
        pendingUpdate: {
          memoryId: lookup.memoryId,
          displayName: lookup.displayName,
          query: request.query,
          proposedContextNote: request.contextNote
        }
      }
    };
  }

  const target = resolveMemoryMutationTarget(message, request, repo, tools, context, toolCalls, message.receivedAt);
  if (target.kind === "none") {
    return { outboundText: composeNoMatchReply(), nextContext: context };
  }

  if (target.kind === "ambiguous") {
    if (strictMode) {
      throw new FriendyStrictModeError(
        "UNEXPECTED_AMBIGUITY",
        "Executable memory mutation route has an ambiguous target.",
        createFriendyTrace({
          strictMode: true,
          routeSource: "deterministic",
          fallbackUsed: false,
          route: {
            intent: "update_memory",
            confidence: 1
          },
          policyDecision: "clarify",
          toolCalls
        })
      );
    }
    return { outboundText: target.message, nextContext: context };
  }

  const memory = target.memory;
  return {
    outboundText: composeUpdateMemoryConfirmReply({
      displayName: memory.displayName,
      proposedContextNote: request.contextNote
    }),
    nextContext: {
      ...clearSearchContext(context),
      activeMemoryId: memory.id,
      pendingUpdate: {
        memoryId: memory.id,
        displayName: memory.displayName,
        proposedContextNote: request.contextNote
      }
    }
  };
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
  if (isDeleteAllMemoryRequest(trimmed)) {
    return undefined;
  }

  const contextChangeMatch = trimmed.match(
    /^(?:(?:can|could|would)\s+(?:you|u)\s+)?(?:please\s+)?(?:change|update|edit)\s+(.+?)\s+context\s+(?:into|to)\s+(.+?)[?.!]*$/i
  );
  if (contextChangeMatch?.[1] && contextChangeMatch[2]) {
    const query = cleanMemoryMutationTarget(contextChangeMatch[1]);
    const contextNote = cleanMemoryMutationContext(contextChangeMatch[2]);
    if (query && contextNote) {
      return { kind: "update", query, contextNote };
    }
  }

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

function isDeleteAllMemoryRequest(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/\bu\b/g, "you")
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ");
  return /\b(delete|remove|forget)\b/.test(normalized) && /\b(everyone|everybody|all people|all contacts|all memories)\b/.test(normalized);
}

function cleanMemoryMutationTarget(value: string): string {
  return value
    .trim()
    .replace(/^["'`/]+|["'`/]+$/g, "")
    .replace(/\s+/g, " ");
}

function cleanMemoryMutationContext(value: string): string {
  return value
    .trim()
    .replace(/^["'`/]+|["'`/]+$/g, "")
    .replace(/^\/?(?:change|update|edit)\s+.+?\s+context\s+(?:into|to)\s+/i, "")
    .replace(/[?.!]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function memoryMutationRequestFromInterpretation(
  message: InboundAgentMessage,
  interpretation: MessageInterpretation
): MemoryMutationRequest | undefined {
  if (interpretation.intent === "delete_memory_request") {
    const query = extractDeleteTargetQuery(message.text, interpretation);
    return query ? { kind: "delete", query } : undefined;
  }

  if (interpretation.intent === "update_memory") {
    const query = interpretation.target?.displayName || interpretation.query.trim();
    const contextNote = interpretation.contextNote.trim();
    if (query && contextNote) {
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

  const searchRequest = buildMemorySearchRequest(message, interpretation);
  if (searchRequest.mode === "list_people") {
    return { ...clearSearchContext(context), activeMemoryId: undefined };
  }

  const query = effectiveMemorySearchQuery(searchRequest);
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

function executeInterpretation(
  message: InboundAgentMessage,
  interpretation: MessageInterpretation,
  repo: RelationshipRepository,
  tools: RelationshipTools,
  candidateIntake: CandidateIntake,
  toolCalls: AgentToolCall[],
  pendingState?: ConversationState
): AgentReplyDraft {
  if (isConfirmationReply(message.text)) {
    return confirmPendingCandidate(message, candidateIntake, tools, toolCalls, pendingState);
  }

  if (interpretation.needsClarification || interpretation.intent === "clarify") {
    const text = composeClarificationReply(interpretation.clarificationQuestion);
    return replyDraft(
      text,
      buildExpressionFactBundle({
        kind: "clarification",
        draft: text,
        questionIntent: "route_clarification"
      })
    );
  }

  if (interpretation.intent === "capture_memory") {
    if (interpretation.confidence < MIN_CAPTURE_CONFIDENCE) {
      const text = composeClarificationReply(interpretation.clarificationQuestion || "What should I remember about them?");
      return replyDraft(
        text,
        buildExpressionFactBundle({
          kind: "clarification",
          draft: text,
          questionIntent: "low_confidence_capture"
        })
      );
    }
    return captureMemories(message, interpretation, tools, toolCalls);
  }

  if (interpretation.intent === "search_memory" && interpretation.search?.mode === "list_people") {
    return listPeople(message, interpretation, tools, toolCalls);
  }

  if (interpretation.intent === "search_memory") {
    return searchMemories(message, interpretation, tools, toolCalls);
  }

  if (interpretation.intent === "list_people") {
    return listPeople(message, interpretation, tools, toolCalls);
  }

  if (interpretation.intent === "duplicate_audit") {
    toolCalls.push("find_duplicate_people");
    const result = tools.find_duplicate_people(message.userId, { includePending: true });
    return replyDraft(composeDuplicateAuditReply({ duplicateGroups: result.duplicateGroups }));
  }

  if (interpretation.intent === "explain_agent_state" || interpretation.intent === "explain_pending_workflow") {
    const displayName = pendingState?.activeFrame?.displayName ?? interpretation.target?.displayName;
    const savedMemories = displayName
      ? listSavedMemoriesForDisplayName(repo, message.userId, displayName)
      : repo.listMemories(message.userId);
    const text = composeExplainAgentStateReply({
      displayName,
      savedMemories,
      pendingFrame: pendingState?.activeFrame
    });
    return replyDraft(
      text,
      buildExpressionFactBundle({
        kind: "explain_agent_state",
        draft: text,
        workflowSummary: displayName
          ? `saved and pending relationship-memory state for ${displayName}`
          : "current relationship-memory state"
      })
    );
  }

  if (interpretation.intent === "conversation_repair") {
    const displayName = pendingState?.activeFrame?.displayName ?? interpretation.target?.displayName;
    const savedMemories = displayName
      ? listSavedMemoriesForDisplayName(repo, message.userId, displayName)
      : repo.listMemories(message.userId);
    const text = composeConversationRepairReply({
      displayName,
      savedMemories,
      pendingFrame: pendingState?.activeFrame
    });
    return replyDraft(
      text,
      buildExpressionFactBundle({
        kind: "conversation_repair",
        draft: text,
        repairTopic: pendingState?.activeFrame ? "stale_prompt" : "other"
      })
    );
  }

  if (interpretation.intent === "delete_memory_request") {
    const query = extractDeleteTargetQuery(message.text, interpretation);
    const matches = rankDisplayNameMatches(
      query,
      repo.listMemories(message.userId).map((memory) => memory.displayName)
    );
    if (matches.length === 0) {
      const text = composeNoMatchReply();
      return replyDraft(
        text,
        buildExpressionFactBundle({
          kind: "search_no_match",
          draft: text
        })
      );
    }

    return replyDraft(composeDeleteMemoryConfirmReply({
      matches: matches.slice(0, 3).map((match) => ({ displayName: match.displayName }))
    }));
  }

  if (interpretation.intent === "ignore_candidate") {
    return replyDraft(ignorePendingCandidate(message, interpretation, candidateIntake, toolCalls));
  }

  const text = composeNoMatchReply();
  return replyDraft(
    text,
    buildExpressionFactBundle({
      kind: "search_no_match",
      draft: text
    })
  );
}

function captureMemories(
  message: InboundAgentMessage,
  interpretation: MessageInterpretation,
  tools: RelationshipTools,
  toolCalls: AgentToolCall[]
): AgentReplyDraft {
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

  const text = composeSaveConfirmation({ memories });
  return replyDraft(
    text,
    buildExpressionFactBundle({
      kind: "save_confirmation",
      draft: text,
      memories
    })
  );
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
): AgentReplyDraft {
  toolCalls.push("search_memories");
  const request = buildMemorySearchRequest(message, interpretation);
  const query = effectiveMemorySearchQuery(request);
  const matches = tools.search_memories(message.userId, query);

  if (request.mode === "list_people") {
    if (matches.length === 0) {
      return replyDraft("I don't have any saved people in Friendy memory yet.");
    }

    const text = composeSearchReply({ matches });
    return replyDraft(text, searchExpressionBundle(text, matches, false));
  }

  if (matches.length === 0) {
    const text = composeNoMatchReply();
    return replyDraft(
      text,
      buildExpressionFactBundle({
        kind: "search_no_match",
        draft: text
      })
    );
  }

  const ambiguous = !isEventWideRecallQuery(message.text) && isAmbiguous(matches);
  const text = composeSearchReply({ matches, ambiguous });
  return replyDraft(text, searchExpressionBundle(text, matches, ambiguous));
}

function listPeople(
  message: InboundAgentMessage,
  interpretation: MessageInterpretation,
  tools: RelationshipTools,
  toolCalls: AgentToolCall[]
): AgentReplyDraft {
  toolCalls.push("list_people");
  const result = tools.list_people(message.userId, {
    source: "friendy_memory",
    limit: interpretation.search?.topK ?? 20,
    dedupeByPerson: true,
    includePending: true,
    filter: {
      rawText: message.text,
      exactTerms: interpretation.search?.exactTerms ?? [],
      eventName: interpretation.search?.filters?.eventName,
      topic: interpretation.search?.filters?.topic,
      tags: interpretation.search?.filters?.tags ?? interpretation.tags
    }
  });
  return replyDraft(composeListPeopleReply({
    result,
    preferBullets: /\b(?:bullet|bullets|list)\b/i.test(message.text)
  }));
}

function replyDraft(text: string, expressionBundle?: ExpressionFactBundle): AgentReplyDraft {
  return expressionBundle ? { text, expressionBundle } : { text };
}

function searchExpressionBundle(
  text: string,
  matches: MemorySearchResult[],
  ambiguous: boolean
): ExpressionFactBundle | undefined {
  if (matches.length === 1) {
    return buildExpressionFactBundle({
      kind: "search_single_match",
      draft: text,
      memory: matches[0].memory,
      ambiguous
    });
  }

  if (matches.length > 1) {
    return buildExpressionFactBundle({
      kind: "search_ambiguous_matches",
      draft: text,
      matches
    });
  }

  return undefined;
}

async function polishAgentReply(
  draft: AgentReplyDraft,
  expression: AgentExpressionComposer | undefined
): Promise<{ text: string; metadata?: ExpressionMetadata }> {
  if (!expression || !draft.expressionBundle) {
    return { text: draft.text };
  }

  try {
    const result = await expression.polishOutboundText({
      draft: draft.text,
      bundle: draft.expressionBundle
    });
    return {
      text: result.text,
      metadata: expressionMetadata(result)
    };
  } catch {
    return {
      text: draft.text,
      metadata: {
        expressionUsed: true,
        expressionValidationPassed: false,
        expressionFallbackReason: "api_error"
      }
    };
  }
}

function expressionMetadata(result: ExpressionComposerResult): ExpressionMetadata {
  return {
    expressionUsed: result.expressionUsed,
    expressionValidationPassed: result.validationPassed,
    expressionFallbackReason: result.fallbackReason,
    expressionModel: result.expressionModel
  };
}

function listSavedMemoriesForDisplayName(
  repo: RelationshipRepository,
  userId: string,
  displayName: string
): RelationshipMemory[] {
  const normalized = displayName.trim().toLowerCase();
  return repo.listMemories(userId).filter((memory) => memory.displayName.trim().toLowerCase() === normalized);
}

function extractDeleteTargetQuery(text: string, interpretation: MessageInterpretation): string {
  const helpDeleteMatch = text.match(/\bdelete\s+(.+?)(?:\s+from(?:\s+your)?\s+memory)?[?.!]*$/i);
  if (helpDeleteMatch?.[1]) {
    return helpDeleteMatch[1].trim();
  }

  return interpretation.target?.displayName?.trim() || interpretation.query?.trim() || "";
}

function buildMemorySearchRequest(message: InboundAgentMessage, interpretation: MessageInterpretation): MemorySearchRequest {
  const interpretedQuery = buildSearchQueryFromInterpretation(interpretation) || message.text;
  const normalizedQuery = normalizeMemorySearchQuery(interpretedQuery);
  return {
    userId: message.userId,
    rawMessage: message.text,
    interpretedQuery,
    normalizedQuery,
    exactTerms: interpretation.search?.exactTerms ?? [],
    semanticQuery: interpretation.search?.semanticQuery,
    mode: interpretation.search?.mode,
    filters: interpretation.search?.filters,
    topK: interpretation.search?.topK ?? 10
  };
}

function effectiveMemorySearchQuery(request: MemorySearchRequest): string {
  if (request.mode === "event_recall") {
    return request.rawMessage;
  }

  return request.interpretedQuery || request.normalizedQuery || request.rawMessage;
}

function confirmPendingCandidate(
  message: InboundAgentMessage,
  candidateIntake: CandidateIntake,
  tools: RelationshipTools,
  toolCalls: AgentToolCall[],
  pendingState?: ConversationState
): AgentReplyDraft {
  toolCalls.push("list_pending_candidates");
  const pending = tools.list_pending_candidates(message.userId);
  if (isPendingCandidateInquiry(message.text)) {
    const text = composePendingCandidateInquiryReply({
      candidates: pending.map((candidate) => ({ displayName: candidate.displayName })),
      activeDisplayName: pendingState?.activeFrame?.displayName
    });
    const activeDisplayName =
      pendingState?.activeFrame?.displayName ?? (pending.length === 1 ? pending[0]?.displayName : undefined);
    const queueNames = activeDisplayName
      ? pending.map((candidate) => candidate.displayName).filter((displayName) => displayName !== activeDisplayName)
      : undefined;
    return replyDraft(
      text,
      activeDisplayName
        ? buildExpressionFactBundle({
            kind: "pending_contact_explanation",
            draft: text,
            activeDisplayName,
            queueNames
          })
        : undefined
    );
  }

  const result = candidateIntake.resolveCandidateReply({
    scope: message,
    replyText: message.text
  });
  recordCandidateReplyToolCalls(result, toolCalls);

  return candidateReplyDraft(result);
}

function pendingContactContextClarification(
  message: InboundAgentMessage,
  tools: RelationshipTools,
  toolCalls: AgentToolCall[],
  pendingState: ConversationState
): AgentReplyDraft {
  toolCalls.push("list_pending_candidates");
  const pending = tools.list_pending_candidates(message.userId);
  const text = composePendingCandidateInquiryReply({
    candidates: pending.map((candidate) => ({ displayName: candidate.displayName })),
    activeDisplayName: pendingState.activeFrame?.displayName
  });
  const activeDisplayName =
    pendingState.activeFrame?.displayName ?? (pending.length === 1 ? pending[0]?.displayName : undefined);

  return replyDraft(
    text,
    activeDisplayName
      ? buildExpressionFactBundle({
          kind: "pending_contact_explanation",
          draft: text,
          activeDisplayName,
          queueNames: pending.map((candidate) => candidate.displayName).filter((name) => name !== activeDisplayName)
        })
      : undefined
  );
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

function candidateReplyDraft(result: CandidateReplyResult): AgentReplyDraft {
  const text = composeCandidateReply(result);
  if (result.kind !== "confirmed") {
    return replyDraft(text);
  }

  return replyDraft(
    text,
    buildExpressionFactBundle({
      kind: "save_confirmation",
      draft: text,
      memories: [result.memory]
    })
  );
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

function repairPendingPromptRecallMisroute(
  interpretation: MessageInterpretation,
  pendingState: ConversationState,
  rawText: string
): MessageInterpretation {
  if (!pendingState.activeFrame && interpretation.intent === "list_people" && isEventRecallQuestion(rawText)) {
    const query =
      interpretation.search?.filters?.eventName ||
      interpretation.query ||
      interpretation.search?.semanticQuery ||
      interpretation.event.name ||
      rawText;
    return {
      ...interpretation,
      intent: "search_memory",
      domain: interpretation.domain ?? "relationship_memory",
      conversationRelation: "starts_new_relationship_task",
      query,
      search: {
        mode: "event_recall",
        semanticQuery: query,
        exactTerms: interpretation.search?.exactTerms ?? [],
        filters: interpretation.search?.filters ?? (interpretation.event.name ? { eventName: interpretation.event.name } : undefined),
        topK: interpretation.search?.topK ?? 10
      },
      needsClarification: false,
      clarificationQuestion: ""
    };
  }

  if (
    pendingState.activeFrame ||
    (interpretation.intent !== "answer_pending_contact_prompt" &&
      interpretation.intent !== "capture_pending_contact_context") ||
    !isEventWideRecallQuery(rawText)
  ) {
    return interpretation;
  }

  const query = interpretation.query || interpretation.search?.semanticQuery || interpretation.event.name || rawText;
  return {
    ...interpretation,
    intent: "search_memory",
    domain: interpretation.domain ?? "relationship_memory",
    conversationRelation: "starts_new_relationship_task",
    query,
    search: interpretation.search ?? {
      mode: "event_recall",
      semanticQuery: query,
      exactTerms: [],
      filters: interpretation.event.name ? { eventName: interpretation.event.name } : undefined,
      topK: 10
    },
    needsClarification: false,
    clarificationQuestion: ""
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
    ...context,
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
