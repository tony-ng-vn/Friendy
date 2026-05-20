import { describe, expect, it, vi } from "vitest";
import packageJson from "../../../package.json";
import { createFixtureCalendarEventProvider } from "./ingestionPipeline";
import type { ContactSnapshot } from "./contactSnapshot";
import type { CalendarEvent } from "../types";
import { runLocalContactCalendarCheck } from "./localCheck";

const userId = "user_local";

describe("local contact/calendar checker", () => {
  it("exposes the local checker as an explicit npm script", () => {
    expect(packageJson.scripts["ingest:local:check"]).toBe("tsx src/relationship/ingestion/localCheckCli.ts");
  });

  it("creates a pending candidate and dry-run prompt for the best calendar event", async () => {
    const result = await runLocalContactCalendarCheck({
      before: beforeSnapshot(),
      after: afterSnapshot("Friendy-101", "2026-05-20T19:30:00.000Z"),
      calendarProvider: createFixtureCalendarEventProvider([photonDinnerEvent()]),
      env: {}
    });

    expect(result.candidates.map((candidate) => candidate.displayName)).toEqual(["Friendy-101"]);
    expect(result.eventMatchesByCandidate[result.candidates[0].id].map((match) => match.eventTitle)).toEqual([
      "Photon Residency Dinner"
    ]);
    expect(result.lines).toContain(
      "Friendy -> User: I noticed you added Friendy-101 during Photon Residency Dinner. Did you meet Friendy-101 there?"
    );
    expect(result.lines).toContain("Live send: skipped (dry run)");
  });

  it("creates a pending candidate with a no-event context prompt", async () => {
    const result = await runLocalContactCalendarCheck({
      before: beforeSnapshot(),
      after: afterSnapshot("Friendy-102", "2026-05-20T23:30:00.000Z"),
      calendarProvider: createFixtureCalendarEventProvider([]),
      env: {}
    });

    expect(result.lines).toContain("Event guesses: none");
    expect(result.lines).toContain("Friendy -> User: I noticed you added Friendy-102. Where did you meet them?");
  });

  it("does not call a sender in dry-run mode", async () => {
    const sender = { sendPrompt: vi.fn() };

    await runLocalContactCalendarCheck({
      before: beforeSnapshot(),
      after: afterSnapshot("Friendy-103", "2026-05-20T19:30:00.000Z"),
      calendarProvider: createFixtureCalendarEventProvider([photonDinnerEvent()]),
      sender,
      env: {}
    });

    expect(sender.sendPrompt).not.toHaveBeenCalled();
  });

  it("calls a mocked sender only when live send is explicitly enabled", async () => {
    const sender = { sendPrompt: vi.fn().mockResolvedValue(undefined) };

    const result = await runLocalContactCalendarCheck({
      before: beforeSnapshot(),
      after: afterSnapshot("Friendy-104", "2026-05-20T19:30:00.000Z"),
      calendarProvider: createFixtureCalendarEventProvider([photonDinnerEvent()]),
      sender,
      env: { FRIENDY_LOCAL_CHECK_SEND: "1" }
    });

    expect(sender.sendPrompt).toHaveBeenCalledWith({
      userId,
      candidateId: result.candidates[0].id,
      text: "I noticed you added Friendy-104 during Photon Residency Dinner. Did you meet Friendy-104 there?"
    });
    expect(result.lines).toContain("Live send: sent 1 prompt");
  });
});

function beforeSnapshot(): ContactSnapshot {
  return {
    userId,
    capturedAt: "2026-05-20T18:00:00.000Z",
    contacts: [
      {
        stableId: "contact_existing",
        displayName: "Existing Person",
        phoneNumbers: ["+15550100000"],
        emails: [],
        updatedAt: "2026-05-20T18:00:00.000Z"
      }
    ]
  };
}

function afterSnapshot(displayName: string, updatedAt: string): ContactSnapshot {
  return {
    userId,
    capturedAt: "2026-05-20T20:00:00.000Z",
    contacts: [
      ...beforeSnapshot().contacts,
      {
        stableId: `contact_${displayName.toLowerCase()}`,
        displayName,
        phoneNumbers: ["+1 (555) 010-0101"],
        emails: [],
        updatedAt
      }
    ]
  };
}

function photonDinnerEvent(): CalendarEvent {
  return {
    id: "event_photon_dinner",
    userId,
    title: "Photon Residency Dinner",
    startsAt: "2026-05-20T19:00:00.000Z",
    endsAt: "2026-05-20T22:00:00.000Z",
    timezone: "America/Los_Angeles",
    location: "San Francisco",
    calendarSource: "simulated",
    eventKind: "short"
  };
}
