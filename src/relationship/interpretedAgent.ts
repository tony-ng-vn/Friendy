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
import {
  cleanCandidateContextReply,
  createCandidateIntake,
  type CandidateIgnoreResult,
  type CandidateReplyResult
} from "./candidateIntake";
import { buildConversationState, type ConversationState, type PendingContactContextFrame } from "./conversationState";
import { detectOnboardingControl, type OnboardingStateController } from "./onboardingState";
import type { MessageInterpreter } from "./openRouterInterpreter";
import type { RelationshipRepository } from "./repository";
import {
  composeCandidateAmbiguityReply,
  composeClarificationReply,
  composeConversationRepairReply,
  composeDeleteMemoryConfirmReply,
  composeDuplicateAuditReply,
  composeExplainAgentStateReply,
  composeIgnoreCandidateReply,
  composeMemoryDeleteReply,
  composeMemoryUpdateReply,
  composeListPeopleReply,
  composeNoMatchReply,
  composeNoPendingCandidateReply,
  composePendingCandidateInquiryReply,
  composePendingContactReminder,
  composeOnboardingControlReply,
  composeSameOrDifferentPendingReply,
  composeSaveConfirmation,
  composeSearchReply
} from "./responseComposer";
import { decideHardSafety } from "./hardSafetyBlock";
import {
  isPendingCandidateInquiry,
  isPendingPromptContextReply,
  isRelationshipMetaRouteMessage
} from "./scopeBoundary";
import { rankDisplayNameMatches } from "./personNameMatch";
import { validateRequiredToolAvailability, validateRoutePolicy, type ValidatedRoutePolicy } from "./routePolicyValidator";
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
import type { AgentCoreResult, AgentInteraction, AgentToolCall, InboundAgentMessage, RelationshipMemory } from "./types";

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

/** Injectable dependencies for the interpreted agent, including optional clock and timezone. */
type InterpretedRelationshipAgentOptions = {
  repo: RelationshipRepository;
  tools: RelationshipTools;
  interpreter: MessageInterpreter;
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
    memoryId: string;
    displayName: string;
  };
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
  strictMode = true,
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

      const pendingState = buildConversationState({
        userId: message.userId,
        spaceId: message.spaceId,
        pendingCandidates: repo.listPendingCandidates(message.userId)
      });

      if (turnContext.pendingDelete && isConfirmationReply(message.text)) {
        const toolCalls: AgentToolCall[] = [];
        const pendingDelete = turnContext.pendingDelete;
        const memory = repo.listMemories(message.userId).find((item) => item.id === pendingDelete.memoryId);
        let outboundText = composeNoMatchReply();

        if (memory) {
          toolCalls.push("delete_memory");
          tools.delete_memory(message.userId, memory.id, {});
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
            policyDecision: { decision: "allow", suppressPendingReminder: true }
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
        const outboundText = mutation.outboundText;
        conversationContexts.set(message.userId, mutation.nextContext);
        const interaction = addInteractionWithTrace(repo, strictMode, {
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
          interaction,
          trace: traceFromInteraction(interaction)
        };
      }

      if (pendingState.pendingContactQueue.length > 0 && isPendingCandidateInquiry(message.text)) {
        const toolCalls: AgentToolCall[] = [];
        const outboundText = confirmPendingCandidate(message, candidateIntake, tools, toolCalls, pendingState);
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: pendingState.activeFrame
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

      if (pendingState.activeFrame && looksLikeDirectPendingContactContext(message.text, pendingState.activeFrame)) {
        const savedMatches = listSavedMemoriesForDisplayName(
          repo,
          message.userId,
          pendingState.activeFrame.displayName
        );
        if (savedMatches.length > 0) {
          const outboundText = composeSameOrDifferentPendingReply({
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
              policyDecision: { decision: "clarify" }
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
        const outboundText = confirmPendingCandidate(message, candidateIntake, tools, toolCalls, pendingState);
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: routeLog({
            intent: "capture_pending_contact_context",
            conversationRelation: "answers_open_workflow",
            frame: pendingState.activeFrame,
            extractedContext,
            confidence: 1,
            traceReason: "User supplied plausible relationship context for the active pending contact.",
            policyDecision: { decision: "allow" }
          }),
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
        const outboundText = confirmPendingCandidate(message, candidateIntake, tools, toolCalls, pendingState);
        const interaction = addInteractionWithTrace(repo, strictMode, {
          id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          inboundText: message.text,
          interpretedIntentJson: {
            intent: "candidate_confirmation",
            confidence: 1,
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

      const interpreted = await interpreter.interpret(message);
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
            toolCalls: []
          })
        );
      }
      const interpretation = enrichInterpretationWithContext(
        interpreted.interpretation,
        turnContext,
        parseTemporalContext(message.text, { receivedAt: message.receivedAt, timezone }),
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
      const toolCalls: AgentToolCall[] = [];
      const searchRequestForTrace =
        interpretation.intent === "search_memory" ? buildMemorySearchRequest(message, interpretation) : undefined;
      let outboundText = executeInterpretation(
        message,
        interpretation,
        repo,
        tools,
        candidateIntake,
        toolCalls,
        pendingState
      );
      if (
        pendingState.activeFrame &&
        interpretation.intent === "search_memory" &&
        !allowedPolicy.suppressPendingReminder
      ) {
        outboundText = `${outboundText} ${composePendingContactReminder(pendingState.activeFrame.displayName)}`;
      }
      let nextContext = updateSearchContext(
        message,
        tools,
        updateConversationContext(turnContext, interpretation),
        interpretation
      );
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
            policyDecision: {
              decision: "allow",
              reason: allowedPolicy.reason,
              suppressPendingReminder: allowedPolicy.suppressPendingReminder
            },
            normalizedQuery: searchRequestForTrace?.normalizedQuery || undefined
          },
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
        interaction,
        trace: traceFromInteraction(interaction)
      };
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
    activeFrameId: target.frameId,
    activeCandidateId: target.candidateId,
    activeMemoryId: target.memoryId,
    toolCalls: interaction.toolCalls as AgentToolCall[]
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
  if (routeSource === "llm" || routeSource === "deterministic" || routeSource === "fallback") {
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

function suppressedPendingReminderFromInteraction(interaction: AgentInteraction): boolean | undefined {
  if (typeof interaction.interpretedIntentJson !== "object" || interaction.interpretedIntentJson === null) {
    return undefined;
  }

  const policyDecision = (interaction.interpretedIntentJson as { policyDecision?: unknown }).policyDecision;
  if (typeof policyDecision !== "object" || policyDecision === null || !("suppressPendingReminder" in policyDecision)) {
    return undefined;
  }

  const suppressed = (policyDecision as { suppressPendingReminder?: unknown }).suppressPendingReminder;
  return typeof suppressed === "boolean" ? suppressed : undefined;
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
    provider: deterministic ? undefined : "openrouter",
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
  policyDecision
}: {
  intent: string;
  conversationRelation: string;
  frame: PendingContactContextFrame;
  extractedContext?: string;
  confidence: number;
  traceReason: string;
  policyDecision: { decision: "allow" | "reject" | "clarify"; reason?: string };
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
    policyDecision
  };
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
            intent: request.kind === "delete" ? "delete_memory" : "update_memory",
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
): string {
  if (isConfirmationReply(message.text)) {
    return confirmPendingCandidate(message, candidateIntake, tools, toolCalls, pendingState);
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
    return composeDuplicateAuditReply({ duplicateGroups: result.duplicateGroups });
  }

  if (interpretation.intent === "explain_agent_state" || interpretation.intent === "explain_pending_workflow") {
    const displayName = pendingState?.activeFrame?.displayName ?? interpretation.target?.displayName;
    const savedMemories = displayName
      ? listSavedMemoriesForDisplayName(repo, message.userId, displayName)
      : repo.listMemories(message.userId);
    return composeExplainAgentStateReply({
      displayName,
      savedMemories,
      pendingFrame: pendingState?.activeFrame
    });
  }

  if (interpretation.intent === "conversation_repair") {
    const displayName = pendingState?.activeFrame?.displayName ?? interpretation.target?.displayName;
    const savedMemories = displayName
      ? listSavedMemoriesForDisplayName(repo, message.userId, displayName)
      : repo.listMemories(message.userId);
    return composeConversationRepairReply({
      displayName,
      savedMemories,
      pendingFrame: pendingState?.activeFrame
    });
  }

  if (interpretation.intent === "delete_memory_request") {
    const query = extractDeleteTargetQuery(message.text, interpretation);
    const matches = rankDisplayNameMatches(
      query,
      repo.listMemories(message.userId).map((memory) => memory.displayName)
    );
    if (matches.length === 0) {
      return composeNoMatchReply();
    }

    return composeDeleteMemoryConfirmReply({
      matches: matches.slice(0, 3).map((match) => ({ displayName: match.displayName }))
    });
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
  const request = buildMemorySearchRequest(message, interpretation);
  const query = effectiveMemorySearchQuery(request);
  const matches = tools.search_memories(message.userId, query);

  if (request.mode === "list_people") {
    if (matches.length === 0) {
      return "I don't have any saved people in Friendy memory yet.";
    }

    return composeSearchReply({ matches });
  }

  if (matches.length === 0) {
    return composeNoMatchReply();
  }

  return composeSearchReply({ matches, ambiguous: !isEventWideRecallQuery(message.text) && isAmbiguous(matches) });
}

function listPeople(
  message: InboundAgentMessage,
  interpretation: MessageInterpretation,
  tools: RelationshipTools,
  toolCalls: AgentToolCall[]
): string {
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
  return composeListPeopleReply({
    result,
    preferBullets: /\b(?:bullet|bullets|list)\b/i.test(message.text)
  });
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
  return request.interpretedQuery || request.normalizedQuery || request.rawMessage;
}

function confirmPendingCandidate(
  message: InboundAgentMessage,
  candidateIntake: CandidateIntake,
  tools: RelationshipTools,
  toolCalls: AgentToolCall[],
  pendingState?: ConversationState
): string {
  toolCalls.push("list_pending_candidates");
  const pending = tools.list_pending_candidates(message.userId);
  if (isPendingCandidateInquiry(message.text)) {
    return composePendingCandidateInquiryReply({
      candidates: pending.map((candidate) => ({ displayName: candidate.displayName })),
      activeDisplayName: pendingState?.activeFrame?.displayName
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
