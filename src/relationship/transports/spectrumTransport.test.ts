import { fixtureUser } from "../fixtures";
import { createRuleBasedInterpreter } from "../openRouterInterpreter";
import { createSpectrumFriendyRuntime, toInboundAgentMessage } from "./spectrumTransport";

describe("spectrum transport", () => {
  it("normalizes Spectrum message text into an inbound agent message", () => {
    const inbound = toInboundAgentMessage({
      userId: "user_fixture",
      text: "who was the piano person",
      spaceId: "space_123",
      receivedAt: "2026-05-20T12:00:00.000Z"
    });

    expect(inbound).toEqual({
      userId: "user_fixture",
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
      userId: fixtureUser.id,
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
    expect(runtime.repo.listInteractions(fixtureUser.id)).toHaveLength(1);
  });

  it("uses the first inbound Spectrum space as conversation identity when no user exists yet", async () => {
    const runtime = createSpectrumFriendyRuntime({
      interpreter: createRuleBasedInterpreter(),
      now: () => "2026-05-20T12:00:00.000Z"
    });

    await runtime.handleInboundText({
      text: "I met Amaya at Photon Residency II, recruiting agents founder",
      spaceId: "space_first_inbound",
      receivedAt: "2026-05-20T12:00:00.000Z"
    });

    const search = await runtime.handleInboundText({
      text: "Who was the recruiting agents founder from Photon?",
      spaceId: "space_first_inbound",
      receivedAt: "2026-05-20T12:05:00.000Z"
    });

    expect(search.replyText).toContain("Amaya");
    expect(runtime.repo.listInteractions("space_first_inbound")).toHaveLength(2);
    expect(runtime.repo.listMemories("space_first_inbound")[0].displayName).toBe("Amaya");
  });

  it("shares SQLite runtime state across Spectrum runtime instances when configured", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = mkdtempSync(join(tmpdir(), "friendy-spectrum-runtime-"));
    const env = {
      FRIENDY_RUNTIME_STORE: "sqlite",
      FRIENDY_SQLITE_PATH: join(dir, "friendy.sqlite")
    };
    let first: ReturnType<typeof createSpectrumFriendyRuntime> | undefined;
    let second: ReturnType<typeof createSpectrumFriendyRuntime> | undefined;

    try {
      first = createSpectrumFriendyRuntime({
        interpreter: createRuleBasedInterpreter(),
        now: () => "2026-05-20T12:00:00.000Z",
        env
      });

      await first.handleInboundText({
        text: "I met Amaya at Photon Residency II, recruiting agents founder",
        spaceId: "space_persistent",
        receivedAt: "2026-05-20T12:00:00.000Z"
      });

      second = createSpectrumFriendyRuntime({
        interpreter: createRuleBasedInterpreter(),
        now: () => "2026-05-20T12:05:00.000Z",
        env
      });

      const search = await second.handleInboundText({
        text: "Who was the recruiting agents founder from Photon?",
        spaceId: "space_persistent",
        receivedAt: "2026-05-20T12:05:00.000Z"
      });

      expect(search.replyText).toContain("Amaya");
      expect(second.repo.listInteractions("space_persistent")).toHaveLength(2);
    } finally {
      (first?.repo as { close?: () => void } | undefined)?.close?.();
      (second?.repo as { close?: () => void } | undefined)?.close?.();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
