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

    expect(result.replyText).toContain("Got it, saved Amaya");
    expect(result.log).toMatchObject({
      intent: "capture_memory",
      modelUsed: "rule-based-fallback",
      toolCalls: ["create_manual_memory"],
      trace: {
        toolCallCount: 1,
        hasError: false
      }
    });
    expect(result.log.trace?.traceId).toMatch(/^trace_/);
    expect(JSON.stringify(result.log)).not.toContain("Amaya");
    expect(JSON.stringify(result.log)).not.toContain("Photon Residency II");
    expect(JSON.stringify(result.log)).not.toContain("sleep on the same bed");
    expect(runtime.repo.listInteractions(fixtureUser.id)).toHaveLength(1);
  });

  it("does not duplicate a manual memory when the same inbound message is retried", async () => {
    const runtime = createSpectrumFriendyRuntime({
      interpreter: createRuleBasedInterpreter(),
      now: () => "2026-05-20T12:00:00.000Z"
    });
    const inbound = {
      userId: fixtureUser.id,
      interactionId: "spectrum_inbound_retry_1",
      text: "I met Amaya at Photon Residency II, recruiting agents founder",
      spaceId: "space_retry",
      receivedAt: "2026-05-20T12:00:00.000Z"
    };

    await runtime.handleInboundText(inbound);
    await runtime.handleInboundText(inbound);

    const memories = runtime.repo.listMemories(fixtureUser.id);
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      displayName: "Amaya",
      candidateId: expect.any(String)
    });
    expect(runtime.repo.getCandidate(memories[0].candidateId!)).toMatchObject({
      source: "manual_imessage",
      manualIdempotencyKey: "manual_imessage:spectrum_inbound_retry_1",
      createdFromInteractionId: "spectrum_inbound_retry_1"
    });
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

  it("confirms a local-checker candidate through Spectrum when owner identity is configured", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createFixtureCalendarEventProvider } = await import("../ingestion/ingestionPipeline");
    const { runLocalContactCalendarCheck } = await import("../ingestion/localCheck");
    const { createSqliteRelationshipRepository } = await import("../sqliteRepository");

    const dir = mkdtempSync(join(tmpdir(), "friendy-spectrum-local-check-"));
    const ownerUserId = "+15550109999";
    const env = {
      FRIENDY_RUNTIME_STORE: "sqlite",
      FRIENDY_SQLITE_PATH: join(dir, "friendy.sqlite"),
      FRIENDY_OWNER_PHONE: ownerUserId
    };
    const localRepo = createSqliteRelationshipRepository({ path: env.FRIENDY_SQLITE_PATH });
    let runtime: ReturnType<typeof createSpectrumFriendyRuntime> | undefined;

    try {
      await runLocalContactCalendarCheck({
        before: localContactSnapshot(ownerUserId, []),
        after: localContactSnapshot(ownerUserId, [
          {
            stableId: "contact_friendy_201",
            displayName: "Friendy-201",
            phoneNumbers: ["+1 (555) 010-0201"],
            emails: [],
            updatedAt: "2026-05-20T19:30:00.000Z"
          }
        ]),
        calendarProvider: createFixtureCalendarEventProvider([
          {
            id: "event_owner_photon_dinner",
            userId: ownerUserId,
            title: "Photon Residency Dinner",
            startsAt: "2026-05-20T19:00:00.000Z",
            endsAt: "2026-05-20T22:00:00.000Z",
            timezone: "America/Los_Angeles",
            location: "San Francisco",
            calendarSource: "simulated",
            eventKind: "short"
          }
        ]),
        repo: localRepo,
        env: {}
      });
      localRepo.close();

      runtime = createSpectrumFriendyRuntime({
        interpreter: createRuleBasedInterpreter(),
        now: () => "2026-05-20T20:05:00.000Z",
        env
      });

      const confirmation = await runtime.handleInboundText({
        text: "yes, met Friendy-201 at Photon Residency Dinner, AI infra",
        spaceId: "space_live_owner",
        receivedAt: "2026-05-20T20:05:00.000Z"
      });

      expect(confirmation.replyText).toContain("Friendy-201");
      expect(runtime.repo.listMemories(ownerUserId)[0]).toMatchObject({
        displayName: "Friendy-201",
        eventTitle: "Photon Residency Dinner"
      });
      expect(runtime.repo.listPendingCandidates(ownerUserId)).toEqual([]);
    } finally {
      (runtime?.repo as { close?: () => void } | undefined)?.close?.();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function localContactSnapshot(userId: string, contacts: Array<{
  stableId: string;
  displayName: string;
  phoneNumbers: string[];
  emails: string[];
  updatedAt: string;
}>) {
  return {
    userId,
    capturedAt: "2026-05-20T20:00:00.000Z",
    contacts
  };
}
