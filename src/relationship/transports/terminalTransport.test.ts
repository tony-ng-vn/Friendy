import { demoDetectedContact, demoLongEvent, demoShortEvent, demoUser } from "../fixtures";
import { createRelationshipAgent } from "../agentCore";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import { createTerminalHarness } from "./terminalTransport";

describe("terminal transport harness", () => {
  it("normalizes terminal text into agent messages", () => {
    const repo = createRelationshipRepository({
      users: [demoUser],
      calendarEvents: [demoLongEvent, demoShortEvent]
    });
    const tools = createRelationshipTools(repo);
    tools.create_contact_candidate(demoDetectedContact);
    const agent = createRelationshipAgent(tools);
    const harness = createTerminalHarness(agent, demoUser.id);

    const result = harness.send("yes, recruiting agents, played piano");

    expect(result.outbound.platform).toBe("terminal");
    expect(result.outbound.text).toContain("Saved");
  });
});
