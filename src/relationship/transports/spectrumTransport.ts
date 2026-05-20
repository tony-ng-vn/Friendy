import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { createInterpretedRelationshipAgent } from "../interpretedAgent";
import {
  createOpenRouterInterpreter,
  type MessageInterpreter,
  readOpenRouterConfig
} from "../openRouterInterpreter";
import { loadFriendyEnv, readSpectrumCredentials } from "../env";
import { demoLongEvent, demoShortEvent, demoUser } from "../fixtures";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import type { AgentInteraction, InboundAgentMessage } from "../types";

/** Small transport input shape so Spectrum specifics do not leak into the agent core. */
export type SpectrumInboundInput = {
  userId?: string;
  text: string;
  spaceId?: string;
  receivedAt: string;
};

export type SpectrumRuntimeOptions = {
  interpreter: MessageInterpreter;
  now?: () => string;
};

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
export function toInboundAgentMessage(input: SpectrumInboundInput): InboundAgentMessage {
  return {
    userId: resolveSpectrumUserId(input),
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
export function createSpectrumFriendyRuntime({ interpreter, now }: SpectrumRuntimeOptions) {
  const repo = createRelationshipRepository({
    users: [demoUser],
    calendarEvents: [demoLongEvent, demoShortEvent]
  });
  const tools = createRelationshipTools(repo);
  const agent = createInterpretedRelationshipAgent({ repo, tools, interpreter, now });

  return {
    repo,
    async handleInboundText(input: SpectrumInboundInput) {
      const result = await agent.handleMessage(toInboundAgentMessage(input));

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
 * This is a transport scaffold for the demo number. User identity and durable memory are still
 * demo-scoped here; the agent core is already separated so those pieces can be swapped later.
 */
export async function startSpectrumFriendyAgent() {
  loadFriendyEnv();
  const { projectId, projectSecret } = readSpectrumCredentials();
  const openRouterConfig = readOpenRouterConfig();
  const runtime = createSpectrumFriendyRuntime({
    interpreter: createOpenRouterInterpreter(openRouterConfig)
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

function resolveSpectrumUserId(input: SpectrumInboundInput): string {
  return input.userId?.trim() || input.spaceId?.trim() || demoUser.id;
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
