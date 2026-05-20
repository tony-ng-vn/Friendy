import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { createRelationshipAgent } from "../agentCore";
import { demoLongEvent, demoShortEvent, demoUser } from "../fixtures";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import type { InboundAgentMessage } from "../types";

export type SpectrumInboundInput = {
  userId: string;
  text: string;
  spaceId?: string;
  receivedAt: string;
};

export function toInboundAgentMessage(input: SpectrumInboundInput): InboundAgentMessage {
  return {
    userId: input.userId,
    platform: "imessage",
    spaceId: input.spaceId,
    text: input.text,
    receivedAt: input.receivedAt
  };
}

export async function startSpectrumFriendyAgent() {
  const projectId = process.env.SPECTRUM_PROJECT_ID;
  const projectSecret = process.env.SPECTRUM_PROJECT_SECRET;

  if (!projectId || !projectSecret) {
    throw new Error("Missing SPECTRUM_PROJECT_ID or SPECTRUM_PROJECT_SECRET.");
  }

  const repo = createRelationshipRepository({
    users: [demoUser],
    calendarEvents: [demoLongEvent, demoShortEvent]
  });
  const tools = createRelationshipTools(repo);
  const agent = createRelationshipAgent(tools);

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
