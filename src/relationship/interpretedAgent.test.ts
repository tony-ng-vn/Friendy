import { describe, expect, it } from "vitest";
import { fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent, fixtureUser } from "./fixtures";
import { createInterpretedRelationshipAgent } from "./interpretedAgent";
import { createRuleBasedInterpreter } from "./openRouterInterpreter";
import { createRelationshipRepository } from "./repository";
import { createRelationshipTools } from "./tools";
import type { InboundAgentMessage } from "./types";

describe("interpreted relationship agent", () => {
  it("captures Amaya from a natural Photon Residency message and logs the turn", async () => {
    const { agent, repo } = createTestAgent();

    const result = await agent.handleMessage(
      inbound("I met Amaya at Photon Residency II, and me and him sleep on the same bed cuz we ran out of bed :(")
    );

    const memories = repo.listMemories(fixtureUser.id);
    expect(result.outbound.text).toContain("Saved");
    expect(memories[0]).toMatchObject({
      displayName: "Amaya",
      primaryContactLabel: "manual contact"
    });
    expect(memories[0].contextNote).toContain("Photon Residency II");
    expect(memories[0].contextNote.toLowerCase()).toContain("sleep");

    const logs = repo.listInteractions(fixtureUser.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      inboundText: "I met Amaya at Photon Residency II, and me and him sleep on the same bed cuz we ran out of bed :(",
      outboundText: result.outbound.text,
      toolCalls: ["create_manual_memory"],
      modelUsed: "rule-based-fallback"
    });
    expect(logs[0].interpretedIntentJson).toMatchObject({ intent: "capture_memory" });
  });

  it("captures Zhiyuan with alias, school, class year, and project context", async () => {
    const { agent, repo } = createTestAgent();

    await agent.handleMessage(
      inbound(
        "Ok so at the residency, I also met Zhiyuan who also call zed, go to CMU, class 2028 and making swift project that allow you to control your computer through your phone with a clicky UI and similar function like Wisper Flow"
      )
    );

    const [memory] = repo.listMemories(fixtureUser.id);
    expect(memory.displayName).toBe("Zhiyuan");
    expect(memory.contextNote).toContain("Zed");
    expect(memory.contextNote).toContain("CMU");
    expect(memory.contextNote).toContain("2028");
    expect(memory.contextNote.toLowerCase()).toContain("swift");
    expect(memory.contextNote.toLowerCase()).toContain("clicky");
  });

  it("stores raw and normalized temporal context when the user mentions a relative date", async () => {
    const { agent, repo } = createTestAgent();

    await agent.handleMessage(
      inbound("I met Maya yesterday at Photon Residency II dinner", "2026-05-20T20:00:00.000-07:00")
    );

    const [memory] = repo.listMemories(fixtureUser.id);
    expect(memory.dateContext).toMatchObject({
      rawText: "yesterday",
      localDate: "2026-05-19",
      timezone: "America/Los_Angeles"
    });
    expect(memory.dateContext?.startsAt).toBeTruthy();
  });

  it("carries event context across a messy Amaya, Sarah Fah, and Felix Ng conversation", async () => {
    const { agent, repo } = createTestAgent();

    await agent.handleMessage(
      inbound("I met Amaya at Photon Residency II, and me and him sleep on the same bed cuz we ran out of bed :(")
    );
    await agent.handleMessage(inbound("I also met Sarah Fah who ran Photon Residency II as the community lead"));
    await agent.handleMessage(
      inbound("And also met Felix Ng who goes to UBC and sleep in the same room with me and Amaya")
    );

    const memories = repo.listMemories(fixtureUser.id);
    expect(memories.map((memory) => memory.displayName)).toEqual(["Amaya", "Sarah Fah", "Felix Ng"]);

    const sarah = memories.find((memory) => memory.displayName === "Sarah Fah");
    expect(sarah?.contextNote).toContain("Photon Residency II");
    expect(sarah?.contextNote.toLowerCase()).toContain("community lead");

    const felix = memories.find((memory) => memory.displayName === "Felix Ng");
    expect(felix?.contextNote).toContain("Photon Residency II");
    expect(felix?.contextNote).toContain("UBC");
    expect(felix?.contextNote.toLowerCase()).toContain("same room");
    expect(felix?.contextNote).toContain("Amaya");

    const eventSearch = await agent.handleMessage(inbound("Who did I meet at Photon Residency II?"));
    expect(eventSearch.outbound.text).toContain("Amaya");
    expect(eventSearch.outbound.text).toContain("Sarah Fah");
    expect(eventSearch.outbound.text).toContain("Felix Ng");

    const roomSearch = await agent.handleMessage(inbound("Who slept in the same room?"));
    expect(roomSearch.outbound.text).toContain("Felix Ng");
    expect(roomSearch.outbound.text).toContain("Amaya");
    expect(roomSearch.outbound.text).not.toContain("matched:");
    expect(roomSearch.outbound.text).not.toContain("manual contact");

    const roleSearch = await agent.handleMessage(inbound("Who was the community lead?"));
    expect(roleSearch.outbound.text).toContain("Sarah Fah");
    expect(roleSearch.outbound.text).toContain("community lead");
    expect(roleSearch.outbound.text).not.toContain("matched:");
  });

  it("returns multiple residency matches conversationally instead of one overconfident match", async () => {
    const { agent } = createTestAgent();
    await saveAmayaAndZhiyuan(agent);

    const result = await agent.handleMessage(inbound("Who did I meet at the residency?"));

    expect(result.outbound.text).toContain("Amaya");
    expect(result.outbound.text).toContain("Zhiyuan");
    expect(result.outbound.text).toContain("I found");
    expect(result.outbound.text).not.toMatch(/^Likely Amaya/);
    expect(result.outbound.text).not.toContain("matched:");
    expect(result.outbound.text).not.toContain("manual contact");
  });

  it("finds Zhiyuan from a vague Swift project search", async () => {
    const { agent } = createTestAgent();
    await saveAmayaAndZhiyuan(agent);

    const result = await agent.handleMessage(inbound("Who was making the Swift project?"));

    expect(result.outbound.text).toContain("Zhiyuan");
    expect(result.outbound.text).toContain("Swift");
  });

  it("finds Amaya from the bed context search", async () => {
    const { agent } = createTestAgent();
    await saveAmayaAndZhiyuan(agent);

    const result = await agent.handleMessage(inbound("Who slept in the same bed?"));

    expect(result.outbound.text).toContain("I think that was Amaya");
    expect(result.outbound.text).toContain("bed");
    expect(result.outbound.text).toContain("I don't have a contact link saved yet.");
    expect(result.outbound.text).not.toContain("matched:");
    expect(result.outbound.text).not.toContain("manual contact");
  });

  it("handles ignore without a pending candidate through the interpreted path", async () => {
    const { agent } = createTestAgent();

    const result = await agent.handleMessage(inbound("ignore"));

    expect(result.outbound.text).toBe("I don't see a pending contact to ignore right now.");
    expect(result.toolCalls).toEqual(["list_pending_candidates"]);
  });

  it("uses the interpreted person name when ignoring one of multiple pending candidates", async () => {
    const repo = createRelationshipRepository({ users: [fixtureUser] });
    const tools = createRelationshipTools(repo);
    const alpha = tools.create_contact_candidate({
      ...fixtureDetectedContact,
      displayName: "Alpha One",
      detectedAt: "2026-05-15T21:44:00-07:00",
      phoneNumbers: ["+15550101031"],
      emails: []
    });
    const beta = tools.create_contact_candidate({
      ...fixtureDetectedContact,
      displayName: "Beta Two",
      detectedAt: "2026-05-15T21:45:00-07:00",
      phoneNumbers: ["+15550101032"],
      emails: []
    });
    const agent = createInterpretedRelationshipAgent({
      repo,
      tools,
      interpreter: {
        async interpret() {
          return {
            modelUsed: "test-interpreter",
            error: "",
            interpretation: {
              intent: "ignore_candidate",
              confidence: 0.9,
              people: [
                {
                  name: "Beta Two",
                  aliases: [],
                  companyOrSchool: "",
                  classYear: "",
                  project: "",
                  role: ""
                }
              ],
              event: { name: "", dateText: "", location: "" },
              dateContext: undefined,
              contextNote: "",
              query: "",
              tags: [],
              needsClarification: false,
              clarificationQuestion: ""
            }
          };
        }
      },
      now: () => "2026-05-20T12:00:00.000Z",
      timezone: "America/Los_Angeles"
    });

    const result = await agent.handleMessage(inbound("ignore Beta Two"));

    expect(result.outbound.text).toBe("Ignored Beta Two.");
    expect(repo.getCandidate(alpha.id)?.status).toBe("pending");
    expect(repo.getCandidate(beta.id)?.status).toBe("ignored");
  });

  it("confirms a pending contact through the interpreted path used by Spectrum", async () => {
    const repo = createRelationshipRepository({
      users: [fixtureUser],
      calendarEvents: [fixtureLongEvent, fixtureShortEvent]
    });
    const tools = createRelationshipTools(repo);
    tools.create_contact_candidate(fixtureDetectedContact);
    const agent = createInterpretedRelationshipAgent({
      repo,
      tools,
      interpreter: createRuleBasedInterpreter(),
      now: () => "2026-05-20T12:00:00.000Z",
      timezone: "America/Los_Angeles"
    });

    const result = await agent.handleMessage(inbound("yes, actually at Photon Residency, recruiting agents"));

    const [memory] = repo.listMemories(fixtureUser.id);
    expect(result.toolCalls).toEqual([
      "list_pending_candidates",
      "list_candidate_event_matches",
      "confirm_candidate"
    ]);
    expect(memory.eventTitle).toBe("Photon Residency");
    expect(memory.contextNote).toContain("recruiting agents");
  });

  it("answers no-match searches without leaking debug language", async () => {
    const { agent } = createTestAgent();

    const result = await agent.handleMessage(inbound("Who was the robotics founder from brunch?"));

    expect(result.outbound.text).toMatch(/I don't have enough/i);
    expect(result.outbound.text).not.toContain("matched:");
    expect(result.outbound.text).not.toContain("manual contact");
  });

  it("uses field-aware search so specific event-goer queries do not return generic shared-event matches", async () => {
    const { agent } = createTestAgent();

    await agent.handleMessage(inbound("I met Maya at Photon Residency II dinner, founder working on recruiting agents"));
    await agent.handleMessage(inbound("I also met Nina Park who was the designer building an AI note-taking tool"));
    await agent.handleMessage(inbound("I also met Leo at Photon Residency II, making devtools for agents"));
    await agent.handleMessage(
      inbound("I also met Rina who goes to CMU, class 2027 and making AI infra dashboard")
    );

    const recruitingSearch = await agent.handleMessage(inbound("Find the recruiting agents founder from Photon"));
    expect(recruitingSearch.outbound.text).toContain("I think that was Maya");
    expect(recruitingSearch.outbound.text).not.toContain("Nina Park");

    const devtoolsSearch = await agent.handleMessage(inbound("Who was making devtools?"));
    expect(devtoolsSearch.outbound.text).toContain("I think that was Leo");
    expect(devtoolsSearch.outbound.text).not.toContain("Rina");

    const schoolSearch = await agent.handleMessage(inbound("Who goes to CMU?"));
    expect(schoolSearch.outbound.text).toContain("I think that was Rina");

    const eventSearch = await agent.handleMessage(inbound("Who did I meet at Photon Residency II?"));
    expect(eventSearch.outbound.text).toContain("Maya");
    expect(eventSearch.outbound.text).toContain("Nina Park");
    expect(eventSearch.outbound.text).toContain("Leo");
    expect(eventSearch.outbound.text).toContain("Rina");
    expect(eventSearch.outbound.text).not.toContain("Which person");
  });

  it("keeps ambiguous dinner-founder queries as narrowing questions", async () => {
    const { agent } = createTestAgent();

    await agent.handleMessage(inbound("I met Maya at dinner, recruiting agents founder"));
    await agent.handleMessage(inbound("I met Sarah at dinner, hardware founder"));

    const result = await agent.handleMessage(inbound("Who was the founder from dinner?"));

    expect(result.outbound.text).toContain("Maya");
    expect(result.outbound.text).toContain("Sarah");
    expect(result.outbound.text).toContain("Which person");
  });

  it("asks clarification for vague references and does not save a fake memory", async () => {
    const { agent, repo } = createTestAgent();

    const result = await agent.handleMessage(inbound("that person from the thing"));

    expect(result.outbound.text.toLowerCase()).toContain("what do you remember");
    expect(result.toolCalls).toEqual([]);
    expect(repo.listMemories(fixtureUser.id)).toHaveLength(0);
    expect(repo.listInteractions(fixtureUser.id)[0].interpretedIntentJson).toMatchObject({
      intent: "clarify",
      needsClarification: true
    });
  });
});

function createTestAgent() {
  const repo = createRelationshipRepository();
  const tools = createRelationshipTools(repo);
  const agent = createInterpretedRelationshipAgent({
    repo,
    tools,
    interpreter: createRuleBasedInterpreter(),
    now: () => "2026-05-20T12:00:00.000Z",
    timezone: "America/Los_Angeles"
  });

  return { agent, repo };
}

async function saveAmayaAndZhiyuan(agent: ReturnType<typeof createTestAgent>["agent"]) {
  await agent.handleMessage(
    inbound("I met Amaya at Photon Residency II, and me and him sleep on the same bed cuz we ran out of bed :(")
  );
  await agent.handleMessage(
    inbound(
      "Ok so at the residency, I also met Zhiyuan who also call zed, go to CMU, class 2028 and making swift project that allow you to control your computer through your phone with a clicky UI and similar function like Wisper Flow"
    )
  );
}

function inbound(text: string, receivedAt = "2026-05-20T12:00:00.000Z"): InboundAgentMessage {
  return {
    userId: fixtureUser.id,
    platform: "terminal",
    text,
    receivedAt
  };
}
