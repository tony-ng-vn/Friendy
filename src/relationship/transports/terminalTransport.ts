import { buildCandidateReviewPrompt, createRelationshipAgent } from "../agentCore";
import { demoDetectedContact, demoLongEvent, demoShortEvent, demoUser } from "../fixtures";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import type { AgentCoreResult } from "../types";

type RelationshipAgent = ReturnType<typeof createRelationshipAgent>;

/** Lightweight transport harness used for local demos and tests without Spectrum credentials. */
export function createTerminalHarness(agent: RelationshipAgent, userId: string) {
  return {
    send(text: string): AgentCoreResult {
      return agent.handleMessage({
        userId,
        platform: "terminal",
        text,
        receivedAt: new Date().toISOString()
      });
    }
  };
}

/**
 * Creates the scripted demo path: detected contact -> proactive prompt -> user reply -> saved memory.
 *
 * This mirrors the iMessage flow while keeping the core agent runnable from npm scripts.
 */
export function createDemoTerminalHarness() {
  const repo = createRelationshipRepository({
    users: [demoUser],
    calendarEvents: [demoLongEvent, demoShortEvent]
  });
  const tools = createRelationshipTools(repo);
  const candidate = tools.create_contact_candidate(demoDetectedContact);
  const agent = createRelationshipAgent(tools);
  const harness = createTerminalHarness(agent, demoUser.id);

  return {
    repo,
    tools,
    candidate,
    firstPrompt: buildCandidateReviewPrompt(candidate.displayName, "Photon Residency Dinner"),
    harness
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const demo = createDemoTerminalHarness();
  console.log(demo.firstPrompt);
  const input = process.argv.slice(2).join(" ") || "yes, recruiting agents, played piano";
  const result = demo.harness.send(input);
  console.log(result.outbound.text);
}
