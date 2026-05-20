import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { createRelationshipAgent } from "../agentCore";
import { loadFriendyEnv, readSpectrumCredentials } from "../env";
import { demoLongEvent, demoShortEvent, demoUser } from "../fixtures";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import type { InboundAgentMessage } from "../types";

/** Small transport input shape so Spectrum specifics do not leak into the agent core. */
export type SpectrumInboundInput = {
  userId: string;
  text: string;
  spaceId?: string;
  receivedAt: string;
};

/** Converts a Spectrum/iMessage event into the normalized message consumed by the relationship agent. */
export function toInboundAgentMessage(input: SpectrumInboundInput): InboundAgentMessage {
  return {
    userId: input.userId,
    platform: "imessage",
    spaceId: input.spaceId,
    text: input.text,
    receivedAt: input.receivedAt
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

  const repo = createRelationshipRepository({
    users: [demoUser],
    calendarEvents: [demoLongEvent, demoShortEvent]
  });
  const tools = createRelationshipTools(repo);
  const agent = createRelationshipAgent(tools);

  // Keep Spectrum as a communication surface; relationship-memory decisions stay in the core agent.
  const app = await Spectrum({
    projectId,
    projectSecret,
    providers: [imessage.config()]
  });

  for await (const [space, message] of app.messages) {
    await space.responding(async () => {
      const inbound = toInboundAgentMessage({
        userId: demoUser.id,
        text: message.content.type === "text" ? message.content.text : "",
        spaceId: space.id,
        receivedAt: new Date().toISOString()
      });
      const result = agent.handleMessage(inbound);
      await message.reply(result.outbound.text);
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startSpectrumFriendyAgent().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
