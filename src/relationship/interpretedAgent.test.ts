import { describe, expect, it } from "vitest";
import { demoUser } from "./fixtures";
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

    const memories = repo.listMemories(demoUser.id);
    expect(result.outbound.text).toContain("Saved");
    expect(memories[0]).toMatchObject({
      displayName: "Amaya",
      primaryContactLabel: "manual contact"
    });
    expect(memories[0].contextNote).toContain("Photon Residency II");
    expect(memories[0].contextNote.toLowerCase()).toContain("sleep");

    const logs = repo.listInteractions(demoUser.id);
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

    const [memory] = repo.listMemories(demoUser.id);
    expect(memory.displayName).toBe("Zhiyuan");
    expect(memory.contextNote).toContain("Zed");
    expect(memory.contextNote).toContain("CMU");
    expect(memory.contextNote).toContain("2028");
    expect(memory.contextNote.toLowerCase()).toContain("swift");
    expect(memory.contextNote.toLowerCase()).toContain("clicky");
  });

  it("returns multiple residency matches instead of one overconfident match", async () => {
    const { agent } = createTestAgent();
    await saveAmayaAndZhiyuan(agent);

    const result = await agent.handleMessage(inbound("Who did I meet at the residency?"));

    expect(result.outbound.text).toContain("Amaya");
    expect(result.outbound.text).toContain("Zhiyuan");
    expect(result.outbound.text).toContain("2");
    expect(result.outbound.text).not.toMatch(/^Likely Amaya/);
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

    expect(result.outbound.text).toContain("Amaya");
    expect(result.outbound.text).toContain("bed");
  });

  it("handles ignore without a pending candidate through the interpreted path", async () => {
    const { agent } = createTestAgent();

    const result = await agent.handleMessage(inbound("ignore"));

    expect(result.outbound.text).toBe("I do not see a pending contact to ignore.");
    expect(result.toolCalls).toEqual(["list_pending_candidates"]);
  });

  it("asks clarification for vague references and does not save a fake memory", async () => {
    const { agent, repo } = createTestAgent();

    const result = await agent.handleMessage(inbound("that person from the thing"));

    expect(result.outbound.text.toLowerCase()).toContain("what do you remember");
    expect(result.toolCalls).toEqual([]);
    expect(repo.listMemories(demoUser.id)).toHaveLength(0);
    expect(repo.listInteractions(demoUser.id)[0].interpretedIntentJson).toMatchObject({
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
    now: () => "2026-05-20T12:00:00.000Z"
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

function inbound(text: string): InboundAgentMessage {
  return {
    userId: demoUser.id,
    platform: "terminal",
    text,
    receivedAt: "2026-05-20T12:00:00.000Z"
  };
}
