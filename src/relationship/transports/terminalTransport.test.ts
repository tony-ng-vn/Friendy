import { fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent, fixtureUser } from "../fixtures";
import { createRelationshipAgent } from "../agentCore";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import { createTerminalHarness } from "./terminalTransport";

describe("terminal transport harness", () => {
  it("normalizes terminal text into agent messages", () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });
    const tools = createRelationshipTools(repo);
    tools.create_contact_candidate(fixtureDetectedContact);
    const agent = createRelationshipAgent(tools);
    const harness = createTerminalHarness(agent, fixtureUser.id);

    const result = harness.send("yes, recruiting agents, played piano");

    expect(result.outbound.platform).toBe("terminal");
    expect(result.outbound.text).toContain("Got it, saved");
  });
});
