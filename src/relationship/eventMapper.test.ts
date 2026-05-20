import { fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent } from "./fixtures";
import { createCandidateId, mapCandidateToEvents } from "./eventMapper";

describe("event mapper", () => {
  it("ranks a short overlapping event above a long background event", () => {
    const candidateId = createCandidateId(fixtureDetectedContact);
    const matches = mapCandidateToEvents(candidateId, fixtureDetectedContact, [fixtureLongEvent, fixtureShortEvent]);

    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({
      calendarEventId: fixtureShortEvent.id,
      eventTitle: "Photon Residency Dinner",
      rank: 1
    });
    expect(matches[0].confidence).toBeGreaterThan(matches[1].confidence);
    expect(matches[1]).toMatchObject({
      calendarEventId: fixtureLongEvent.id,
      eventTitle: "Photon Residency",
      rank: 2
    });
  });

  it("returns no matches when no event window contains the detection time", () => {
    const candidateId = createCandidateId({
      ...fixtureDetectedContact,
      detectedAt: "2026-06-01T12:00:00-07:00"
    });

    const matches = mapCandidateToEvents(
      candidateId,
      { ...fixtureDetectedContact, detectedAt: "2026-06-01T12:00:00-07:00" },
      [fixtureLongEvent, fixtureShortEvent]
    );

    expect(matches).toEqual([]);
  });
});
