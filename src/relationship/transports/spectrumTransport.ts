/**
 * Spectrum/iMessage transport for the relationship agent.
 *
 * Transports adapt external channels into `InboundAgentMessage` and must stay thin: normalize
 * inbound text, call the agent, send replies, and log compact traces. Product decisions stay in
 * the agent core and deterministic tools.
 */
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { createInterpretedRelationshipAgent } from "../interpretedAgent";
import {
  createOpenRouterInterpreter,
  type MessageInterpreter,
  readOpenRouterConfig
} from "../openRouterInterpreter";
import { loadFriendyEnv, readSpectrumCredentials } from "../env";
import { fixtureLongEvent, fixtureShortEvent, fixtureUser } from "../fixtures";
import { resolveConfiguredUserId } from "../identity";
import type { OnboardingStateController } from "../onboardingState";
import type { RelationshipRepository } from "../repository";
import { createRuntimeRelationshipRepository } from "../runtimeRepository";
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
  onboarding?: OnboardingStateController;
  env?: Partial<NodeJS.ProcessEnv>;
};

/** Options for starting the live Spectrum message loop. */
export type StartSpectrumFriendyAgentOptions = {
  interpreter?: MessageInterpreter;
  now?: () => string;
  repo?: RelationshipRepository;
  tools?: RelationshipTools;
  onboarding?: OnboardingStateController;
  env?: Partial<NodeJS.ProcessEnv>;
};

/** Compact backend trace emitted after each handled inbound message. */
export type CompactInteractionLog = {
  interactionId: string;
  userId: string;
  platform: string;
  intent: string;
  toolCalls: string[];
  modelUsed?: string;
  confidence?: number;
  latencyMs?: number;
  error?: string;
  createdAt: string;
};

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
  onboarding,
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
  const agent = createInterpretedRelationshipAgent({ repo, tools, onboarding, interpreter, now });

  return {
    repo,
    async handleInboundText(input: SpectrumInboundInput) {
      const result = await agent.handleMessage(toInboundAgentMessage(input, env));

      return {
        replyText: result.outbound.text,
        log: toCompactInteractionLog(result.interaction)
      };
    }
  };
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
  onboarding,
  env = process.env
}: StartSpectrumFriendyAgentOptions = {}) {
  loadFriendyEnv();
  const { projectId, projectSecret } = readSpectrumCredentials(env as NodeJS.ProcessEnv);
  const openRouterConfig = readOpenRouterConfig(env);
  const runtime = createSpectrumFriendyRuntime({
    interpreter: interpreter ?? createOpenRouterInterpreter(openRouterConfig),
    now,
    repo,
    tools,
    onboarding,
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
      const result = await runtime.handleInboundText({
        text: message.content.type === "text" ? message.content.text : "",
        spaceId: space.id,
        receivedAt: new Date().toISOString()
      });
      console.info("[friendy:agent_interaction]", JSON.stringify(result.log));
      await message.reply(result.replyText);
    });
  }
}

function resolveSpectrumUserId(input: SpectrumInboundInput, env: Partial<NodeJS.ProcessEnv>): string {
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
    modelUsed: interaction.modelUsed,
    confidence: interaction.confidence,
    latencyMs: interaction.latencyMs,
    error: interaction.error,
    createdAt: interaction.createdAt
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startSpectrumFriendyAgent().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
