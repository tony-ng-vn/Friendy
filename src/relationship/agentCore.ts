/**
 * Deterministic relationship-memory router for the MVP agent.
 *
 * Callers: tests, evals, and transports that do not yet use LLM interpretation.
 *
 * Router order (first match wins):
 * 1. Out-of-scope / needs-clarification from `scopeBoundary`.
 * 2. Explicit candidate confirmation capability or confirmation-shaped reply.
 * 3. `ignore` prefix for pending candidates.
 * 4. Manual memory heuristics (`met ` / `remember ` / `i met ` / `i remember ` prefixes).
 * 5. Default memory search with ambiguity when top-two scores differ by ≤6.
 */
import type { AgentCoreResult, AgentToolCall, InboundAgentMessage } from "./types";
import type { MemorySearchResult, createRelationshipTools } from "./tools";
import { isConfirmationReply } from "./candidateConfirmation";
import { createCandidateIntake, type CandidateIgnoreResult, type CandidateReplyResult } from "./candidateIntake";
import { detectOnboardingControl, type OnboardingStateController } from "./onboardingState";
import { isAmbiguousDraftRequest, isPendingCandidateInquiry, isPendingPromptContextReply } from "./scopeBoundary";
import {
  composeCandidateAmbiguityReply,
  composeClarificationReply,
  composeIgnoreCandidateReply,
  composeNoMatchReply,
  composeNoPendingCandidateReply,
  composePendingCandidateInquiryReply,
  composeOnboardingControlReply,
  composeSaveConfirmation,
  composeSearchReply
} from "./responseComposer";
import { decideHardSafety } from "./hardSafetyBlock";

type RelationshipTools = ReturnType<typeof createRelationshipTools>;
type RelationshipAgentOptions = {
  onboarding?: OnboardingStateController;
};

/**
 * Creates the first relationship memory agent.
 *
 * This is a deterministic router around explicit tools, not a fully autonomous LLM loop yet.
 * That keeps the MVP debuggable while we prove the capture-confirm-search workflow.
 */
export function createRelationshipAgent(tools: RelationshipTools, { onboarding }: RelationshipAgentOptions = {}) {
  const candidateIntake = createCandidateIntake({ tools });

  return {
    handleMessage(message: InboundAgentMessage): AgentCoreResult {
      const normalized = message.text.trim();
      const lower = normalized.toLowerCase();
      const toolCalls: AgentToolCall[] = [];
      const onboardingControl = detectOnboardingControl(normalized);
      if (onboardingControl) {
        onboarding?.applyControl(onboardingControl);
        return reply(message, composeOnboardingControlReply(onboardingControl), toolCalls);
      }

      const hardSafety = decideHardSafety(normalized);
      if (hardSafety.decision === "reject") {
        return reply(message, hardSafety.redirect, toolCalls);
      }

      const hasPendingCandidate = tools.list_pending_candidates(message.userId).length > 0;

      if (lower.startsWith("ignore")) {
        toolCalls.push("list_pending_candidates");
        const result = candidateIntake.ignoreCandidate({
          scope: message,
          candidateName: normalized.replace(/^ignore\s*/i, "").trim()
        });
        recordCandidateIgnoreToolCalls(result, toolCalls);
        return reply(message, composeCandidateIgnoreReply(result), toolCalls);
      }

      if (hasPendingCandidate && isPendingPromptContextReply(lower)) {
        toolCalls.push("list_pending_candidates");
        const pending = tools.list_pending_candidates(message.userId);
        if (isPendingCandidateInquiry(normalized)) {
          return reply(
            message,
            composePendingCandidateInquiryReply({
              candidates: pending.map((candidate) => ({ displayName: candidate.displayName }))
            }),
            toolCalls
          );
        }

        const result = candidateIntake.resolveCandidateReply({
          scope: message,
          replyText: normalized
        });
        recordCandidateReplyToolCalls(result, toolCalls);

        return reply(message, composeCandidateReply(result), toolCalls);
      }

      if (isConfirmationReply(normalized)) {
        toolCalls.push("list_pending_candidates");
        const result = candidateIntake.resolveCandidateReply({
          scope: message,
          replyText: normalized
        });
        recordCandidateReplyToolCalls(result, toolCalls);

        return reply(message, composeCandidateReply(result), toolCalls);
      }

      if (isAmbiguousDraftRequest(lower)) {
        return reply(message, composeClarificationReply("Who is it for?"), toolCalls);
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

/** Prefixes that route to manual memory capture without LLM interpretation. */
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

/**
 * Near-tie detection for search results.
 *
 * When the top two memories are within 6 field-weight points, the agent asks a narrowing
 * question instead of pretending certainty — mirrors the collapse threshold in `tools.ts`.
 */
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
