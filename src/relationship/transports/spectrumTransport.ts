/**
 * Spectrum/iMessage transport for the relationship agent.
 *
 * Transports adapt external channels into `InboundAgentMessage` and must stay thin: normalize
 * inbound text, call the agent, send replies, and log compact traces. Product decisions stay in
 * the agent core and deterministic tools.
 */
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { createInterpretedRelationshipAgent, type AgentExpressionComposer } from "../interpretedAgent";
import { polishOutboundText } from "../expressionComposer";
import { readExpressionConfig } from "../expressionConfig";
import {
  createOpenAIInterpreter,
  type MessageInterpreter,
  readOpenAIConfig
} from "../openAIInterpreter";
import { loadFriendyEnv, readSpectrumCredentials } from "../env";
import { fixtureLongEvent, fixtureShortEvent, fixtureUser } from "../fixtures";
import { resolveConfiguredUserId } from "../identity";
import type { OnboardingStateController } from "../onboardingState";
import type { RelationshipRepository } from "../repository";
import { createRuntimeRelationshipRepository } from "../runtimeRepository";
import { readFriendyStrictMode } from "../strictMode";
import { createRelationshipTools } from "../tools";
import type { AgentInteraction, InboundAgentMessage } from "../types";

type RelationshipTools = ReturnType<typeof createRelationshipTools>;

/** Minimal Spectrum event shape before conversion to `InboundAgentMessage`. */
export type SpectrumInboundInput = {
  interactionId?: string;
  userId?: string;
  text: string;
  spaceId?: string;
  receivedAt: string;
};

/** Dependencies injectable for tests and fixture runs of the Spectrum runtime. */
export type SpectrumRuntimeOptions = {
  interpreter: MessageInterpreter;
  now?: () => string;
  repo?: RelationshipRepository;
  tools?: RelationshipTools;
  expression?: AgentExpressionComposer;
  onboarding?: OnboardingStateController;
  requeueDeferredContactsOnStart?: () => Promise<void>;
  env?: Partial<NodeJS.ProcessEnv>;
};

/** Options for starting the live Spectrum message loop. */
export type StartSpectrumFriendyAgentOptions = {
  interpreter?: MessageInterpreter;
  now?: () => string;
  repo?: RelationshipRepository;
  tools?: RelationshipTools;
  expression?: AgentExpressionComposer;
  onboarding?: OnboardingStateController;
  requeueDeferredContactsOnStart?: () => Promise<void>;
  env?: Partial<NodeJS.ProcessEnv>;
};

/** Compact backend trace emitted after each handled inbound message. */
export type CompactInteractionLog = {
  interactionId: string;
  userId: string;
  platform: string;
  intent: string;
  toolCalls: string[];
  trace?: {
    traceId: string;
    toolCallCount: number;
    candidateCount: number;
    memoryCount: number;
    hasError: boolean;
    strictMode?: boolean;
    routeSource?: string;
    fallbackUsed?: boolean;
    scopeDecision?: string;
    activeWorkflowKind?: string;
    selectedTool?: string;
    modelRequested?: string;
    modelResponseSchemaValid?: boolean;
    modelErrorCode?: string;
    searchOutcome?: string;
  };
  modelUsed?: string;
  confidence?: number;
  latencyMs?: number;
  error?: "present";
  createdAt: string;
};

/** Optional verbose local-server turn log with raw inbound text and sent reply. */
export type AgentTurnLog = {
  userId: string;
  platform: string;
  spaceId?: string;
  userText: string;
  agentReply: string;
  createdAt: string;
};

type SpectrumFriendyRuntime = Pick<ReturnType<typeof createSpectrumFriendyRuntime>, "handleInboundText">;

type SpectrumInboundResponderOptions = {
  runtime: SpectrumFriendyRuntime;
  input: SpectrumInboundInput;
  reply(text: string): Promise<void> | void;
  logger?: Pick<Console, "info" | "error">;
};

type SpectrumInboundResponderResult = {
  handled: boolean;
};

const INBOUND_RECOVERY_REPLY = "I had trouble understanding that. Try saying it another way.";

/** Converts a Spectrum/iMessage event into the normalized message consumed by the relationship agent. */
export function toInboundAgentMessage(input: SpectrumInboundInput, env: Partial<NodeJS.ProcessEnv> = {}): InboundAgentMessage {
  return {
    interactionId: input.interactionId,
    userId: resolveSpectrumUserId(input, env),
    platform: "imessage",
    spaceId: input.spaceId,
    text: input.text,
    receivedAt: input.receivedAt
  };
}

/**
 * Creates the testable Spectrum runtime.
 *
 * Spectrum remains only the communication source. This runtime normalizes text, delegates all
 * relationship behavior to the interpreted agent, and returns the compact log the live loop prints.
 */
export function createSpectrumFriendyRuntime({
  interpreter,
  now,
  repo: providedRepo,
  tools: providedTools,
  expression: providedExpression,
  onboarding,
  requeueDeferredContactsOnStart,
  env = process.env
}: SpectrumRuntimeOptions) {
  const repo = providedRepo ?? createRuntimeRelationshipRepository({
    env,
    seed: {
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    }
  });
  const tools = providedTools ?? createRelationshipTools(repo);
  const strictMode = readFriendyStrictMode(env);
  const expression = providedExpression ?? createEnvExpressionComposer(env);
  const agent = createInterpretedRelationshipAgent({
    repo,
    tools,
    expression,
    onboarding,
    requeueDeferredContactsOnStart,
    interpreter,
    strictMode,
    now
  });

  return {
    repo,
    async handleInboundText(input: SpectrumInboundInput) {
      const inbound = toInboundAgentMessage(input, env);
      const result = await agent.handleMessage(inbound);

      return {
        replyText: result.outbound.text,
        log: toCompactInteractionLog(result.interaction),
        turnLog: toAgentTurnLog(inbound, result.outbound.text, result.interaction.createdAt)
      };
    }
  };
}

/** Handles one Spectrum inbound message without letting a failed turn stop the live loop. */
export async function respondToSpectrumInbound({
  runtime,
  input,
  reply,
  logger = console
}: SpectrumInboundResponderOptions): Promise<SpectrumInboundResponderResult> {
  try {
    const result = await runtime.handleInboundText(input);
    logger.info("[friendy:agent_turn]", JSON.stringify(result.turnLog));
    logger.info("[friendy:agent_interaction]", JSON.stringify(result.log));
    await reply(result.replyText);
    return { handled: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[friendy:inbound_agent:error] ${message}`);
    await reply(INBOUND_RECOVERY_REPLY);
    return { handled: false };
  }
}

/**
 * Starts the Spectrum-backed relationship agent.
 *
 * This is a transport scaffold for the fixture number. User identity and durable memory are still
 * fixture-scoped here; the agent core is already separated so those pieces can be swapped later.
 */
export async function startSpectrumFriendyAgent({
  interpreter,
  now,
  repo,
  tools,
  expression,
  onboarding,
  requeueDeferredContactsOnStart,
  env = process.env
}: StartSpectrumFriendyAgentOptions = {}) {
  loadFriendyEnv();
  const { projectId, projectSecret } = readSpectrumCredentials(env as NodeJS.ProcessEnv);
  const modelConfig = readOpenAIConfig(env);
  const strictMode = readFriendyStrictMode(env);
  const runtime = createSpectrumFriendyRuntime({
    interpreter: interpreter ?? createOpenAIInterpreter({ ...modelConfig, strictMode }),
    now,
    repo,
    tools,
    expression,
    onboarding,
    requeueDeferredContactsOnStart,
    env
  });

  // Keep Spectrum as a communication surface; relationship-memory decisions stay in the core agent.
  const app = await Spectrum({
    projectId,
    projectSecret,
    providers: [imessage.config()]
  });

  for await (const [space, message] of app.messages) {
    await space.responding(async () => {
      await respondToSpectrumInbound({
        runtime,
        input: {
          text: message.content.type === "text" ? message.content.text : "",
          spaceId: space.id,
          receivedAt: new Date().toISOString()
        },
        reply: async (text) => {
          await message.reply(text);
        }
      });
    });
  }
}

function createEnvExpressionComposer(env: Partial<NodeJS.ProcessEnv>): AgentExpressionComposer {
  return {
    polishOutboundText(input) {
      return polishOutboundText({
        ...input,
        config: readExpressionConfig(env)
      });
    }
  };
}

function toAgentTurnLog(inbound: InboundAgentMessage, agentReply: string, createdAt: string): AgentTurnLog {
  return {
    userId: inbound.userId,
    platform: inbound.platform,
    spaceId: inbound.spaceId,
    userText: inbound.text,
    agentReply,
    createdAt
  };
}

function resolveSpectrumUserId(input: SpectrumInboundInput, env: Partial<NodeJS.ProcessEnv>): string {
  // Prefer explicit transport user id, then env owner id, then Spectrum space id, then fixture fallback.
  return input.userId?.trim() || resolveConfiguredUserId(env) || input.spaceId?.trim() || fixtureUser.id;
}

function toCompactInteractionLog(interaction: AgentInteraction): CompactInteractionLog {
  const intent =
    typeof interaction.interpretedIntentJson === "object" &&
    interaction.interpretedIntentJson !== null &&
    "intent" in interaction.interpretedIntentJson
      ? String(interaction.interpretedIntentJson.intent)
      : "unknown";

  return {
    interactionId: interaction.id,
    userId: interaction.userId,
    platform: interaction.platform,
    intent,
    toolCalls: interaction.toolCalls,
    trace: toCompactTrace(interaction.redactedTraceJson),
    modelUsed: interaction.modelUsed,
    confidence: interaction.confidence,
    latencyMs: interaction.latencyMs,
    error: interaction.error ? "present" : undefined,
    createdAt: interaction.createdAt
  };
}

function toCompactTrace(trace: unknown): CompactInteractionLog["trace"] | undefined {
  // Redacted traces are persisted as loose JSON; accept partial shapes without failing the transport log.
  if (typeof trace !== "object" || trace === null || !("traceId" in trace)) {
    return undefined;
  }

  const value = trace as {
    traceId?: unknown;
    strictMode?: unknown;
    routeSource?: unknown;
    fallbackUsed?: unknown;
    scopeDecision?: unknown;
    activeWorkflowKind?: unknown;
    selectedTool?: unknown;
    modelRequested?: unknown;
    modelResponseSchemaValid?: unknown;
    modelErrorCode?: unknown;
    toolCalls?: unknown;
    candidateIdsTouched?: unknown;
    memoryIdsTouched?: unknown;
    errors?: unknown;
    search?: unknown;
  };
  if (typeof value.traceId !== "string") {
    return undefined;
  }

  const search = typeof value.search === "object" && value.search !== null ? value.search as { outcome?: unknown } : undefined;
  return {
    traceId: value.traceId,
    toolCallCount: Array.isArray(value.toolCalls) ? value.toolCalls.length : 0,
    candidateCount: Array.isArray(value.candidateIdsTouched) ? value.candidateIdsTouched.length : 0,
    memoryCount: Array.isArray(value.memoryIdsTouched) ? value.memoryIdsTouched.length : 0,
    hasError: Array.isArray(value.errors) && value.errors.length > 0,
    strictMode: typeof value.strictMode === "boolean" ? value.strictMode : undefined,
    routeSource: typeof value.routeSource === "string" ? value.routeSource : undefined,
    fallbackUsed: typeof value.fallbackUsed === "boolean" ? value.fallbackUsed : undefined,
    scopeDecision: typeof value.scopeDecision === "string" ? value.scopeDecision : undefined,
    activeWorkflowKind: typeof value.activeWorkflowKind === "string" ? value.activeWorkflowKind : undefined,
    selectedTool: typeof value.selectedTool === "string" ? value.selectedTool : undefined,
    modelRequested: typeof value.modelRequested === "string" ? value.modelRequested : undefined,
    modelResponseSchemaValid:
      typeof value.modelResponseSchemaValid === "boolean" ? value.modelResponseSchemaValid : undefined,
    modelErrorCode: typeof value.modelErrorCode === "string" ? value.modelErrorCode : undefined,
    searchOutcome: typeof search?.outcome === "string" ? search.outcome : undefined
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startSpectrumFriendyAgent().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
