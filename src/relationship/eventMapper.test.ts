import { demoDetectedContact, demoLongEvent, demoShortEvent } from "./fixtures";
import { createCandidateId, mapCandidateToEvents } from "./eventMapper";

describe("event mapper", () => {
  it("ranks a short overlapping event above a long background event", () => {
    const candidateId = createCandidateId(demoDetectedContact);
    const matches = mapCandidateToEvents(candidateId, demoDetectedContact, [demoLongEvent, demoShortEvent]);

    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({
      calendarEventId: demoShortEvent.id,
      eventTitle: "Photon Residency Dinner",
      rank: 1
    });
    expect(matches[0].confidence).toBeGreaterThan(matches[1].confidence);
    expect(matches[1]).toMatchObject({
      calendarEventId: demoLongEvent.id,
      eventTitle: "Photon Residency",
      rank: 2
    });
  });

  it("returns no matches when no event window contains the detection time", () => {
    const candidateId = createCandidateId({
      ...demoDetectedContact,
      detectedAt: "2026-06-01T12:00:00-07:00"
    });

    const matches = mapCandidateToEvents(
      candidateId,
      { ...demoDetectedContact, detectedAt: "2026-06-01T12:00:00-07:00" },
      [demoLongEvent, demoShortEvent]
    );

    expect(matches).toEqual([]);
  });
});
