import { describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import { createRelationshipAgent } from "../agentCore";
import { demoLongEvent, demoShortEvent, demoUser } from "../fixtures";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import { createFixtureCalendarEventProvider, ingestContactSnapshotDiff } from "./ingestionPipeline";
import { fixtureAfterContactSnapshot, fixtureBeforeContactSnapshot } from "./contactSnapshot";

describe("fixture contact/calendar ingestion pipeline", () => {
  it("provides fixture calendar events without reading a real calendar", () => {
    const provider = createFixtureCalendarEventProvider([demoLongEvent, demoShortEvent]);

    expect(provider.source).toBe("fixture");
    expect(provider.listEvents(demoUser.id).map((event) => event.title)).toEqual([
      "Photon Residency",
      "Photon Residency Dinner"
    ]);
  });

  it("enqueues detected contacts and stores event matches through the repository/tool boundary", () => {
    const repo = createRelationshipRepository({ users: [demoUser] });
    const tools = createRelationshipTools(repo);
    const provider = createFixtureCalendarEventProvider([demoLongEvent, demoShortEvent]);

    const result = ingestContactSnapshotDiff({
      before: fixtureBeforeContactSnapshot,
      after: fixtureAfterContactSnapshot,
      calendarProvider: provider,
      tools
    });

    expect(result.detectedContacts.map((item) => item.displayName)).toEqual(["Maya Chen", "Nina Park"]);
    expect(result.candidates.map((item) => item.displayName)).toEqual(["Maya Chen", "Nina Park"]);
    expect(result.eventMatchesByCandidate[result.candidates[0].id].map((match) => match.eventTitle)).toEqual([
      "Photon Residency Dinner",
      "Photon Residency"
    ]);
    expect(result.eventMatchesByCandidate[result.candidates[1].id]).toEqual([]);
    expect(tools.list_pending_candidates(demoUser.id).map((candidate) => candidate.displayName)).toEqual([
      "Maya Chen",
      "Nina Park"
    ]);
  });

  it("keeps queued candidates compatible with confirmation and search", () => {
    const repo = createRelationshipRepository({ users: [demoUser] });
    const tools = createRelationshipTools(repo);
    const provider = createFixtureCalendarEventProvider([demoLongEvent, demoShortEvent]);
    ingestContactSnapshotDiff({
      before: fixtureBeforeContactSnapshot,
      after: fixtureAfterContactSnapshot,
      calendarProvider: provider,
      tools
    });
    const agent = createRelationshipAgent(tools);

    agent.handleMessage({
      userId: demoUser.id,
      platform: "terminal",
      text: "yes, recruiting agents, played piano",
      receivedAt: "2026-05-20T12:00:00.000Z"
    });
    const search = agent.handleMessage({
      userId: demoUser.id,
      platform: "terminal",
      text: "who was the recruiting agents person from Photon dinner?",
      receivedAt: "2026-05-20T12:05:00.000Z"
    });

    expect(search.outbound.text).toContain("Maya Chen");
    expect(search.outbound.text).toContain("recruiting agents");
  });

  it("prints a deterministic ingest demo summary", () => {
    const repo = createRelationshipRepository({ users: [demoUser] });
    const tools = createRelationshipTools(repo);
    const provider = createFixtureCalendarEventProvider([demoLongEvent, demoShortEvent]);

    const result = ingestContactSnapshotDiff({
      before: fixtureBeforeContactSnapshot,
      after: fixtureAfterContactSnapshot,
      calendarProvider: provider,
      tools
    });

    expect(result.summaryLines).toEqual([
      "Detected contacts: Maya Chen, Nina Park",
      `Candidate ${result.candidates[0].id}: Maya Chen`,
      "Event guesses: 1. Photon Residency Dinner | 2. Photon Residency",
      `Candidate ${result.candidates[1].id}: Nina Park`,
      "Event guesses: none",
      "Pending queue: Maya Chen, Nina Park"
    ]);
  });

  it("exposes the fixture ingest demo as an npm script", () => {
    expect(packageJson.scripts["ingest:demo"]).toBe("tsx src/relationship/ingestion/ingestDemo.ts");
  });
});
