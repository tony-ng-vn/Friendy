import { demoUser } from "../fixtures";
import { createRuleBasedInterpreter } from "../openRouterInterpreter";
import { createSpectrumFriendyRuntime, toInboundAgentMessage } from "./spectrumTransport";

describe("spectrum transport", () => {
  it("normalizes Spectrum message text into an inbound agent message", () => {
    const inbound = toInboundAgentMessage({
      userId: "user_demo",
      text: "who was the piano person",
      spaceId: "space_123",
      receivedAt: "2026-05-20T12:00:00.000Z"
    });

    expect(inbound).toEqual({
      userId: "user_demo",
      platform: "imessage",
      spaceId: "space_123",
      text: "who was the piano person",
      receivedAt: "2026-05-20T12:00:00.000Z"
    });
  });

  it("routes normalized iMessage text through the interpreted agent and returns a compact log", async () => {
    const runtime = createSpectrumFriendyRuntime({
      interpreter: createRuleBasedInterpreter(),
      now: () => "2026-05-20T12:00:00.000Z"
    });

    const result = await runtime.handleInboundText({
      userId: demoUser.id,
      text: "I met Amaya at Photon Residency II, and me and him sleep on the same bed cuz we ran out of bed :(",
      spaceId: "space_123",
      receivedAt: "2026-05-20T12:00:00.000Z"
    });

    expect(result.replyText).toContain("Saved");
    expect(result.log).toMatchObject({
      intent: "capture_memory",
      modelUsed: "rule-based-fallback",
      toolCalls: ["create_manual_memory"]
    });
    expect(runtime.repo.listInteractions(demoUser.id)).toHaveLength(1);
  });
});
