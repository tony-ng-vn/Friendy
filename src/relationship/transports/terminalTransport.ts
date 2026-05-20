import { buildCandidateReviewPrompt, createRelationshipAgent } from "../agentCore";
import { fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent, fixtureUser } from "../fixtures";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import type { AgentCoreResult } from "../types";

type RelationshipAgent = ReturnType<typeof createRelationshipAgent>;

/** Lightweight transport harness used for local fixtures and tests without Spectrum credentials. */
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
 * Creates the scripted fixture path: detected contact -> proactive prompt -> user reply -> saved memory.
 *
 * This mirrors the iMessage flow while keeping the core agent runnable from npm scripts.
 */
export function createFixtureTerminalHarness() {
  const repo = createRelationshipRepository({
    users: [fixtureUser],
    calendarEvents: [fixtureLongEvent, fixtureShortEvent]
  });
  const tools = createRelationshipTools(repo);
  const candidate = tools.create_contact_candidate(fixtureDetectedContact);
  const agent = createRelationshipAgent(tools);
  const harness = createTerminalHarness(agent, fixtureUser.id);

  return {
    repo,
    tools,
    candidate,
    firstPrompt: buildCandidateReviewPrompt(candidate.displayName, "Photon Residency Dinner"),
    harness
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fixture = createFixtureTerminalHarness();
  console.log(fixture.firstPrompt);
  const input = process.argv.slice(2).join(" ") || "yes, recruiting agents, played piano";
  const result = fixture.harness.send(input);
  console.log(result.outbound.text);
}
