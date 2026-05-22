import { describe, expect, it } from "vitest";
import { isConfirmationReply, resolveCandidateConfirmation } from "./candidateConfirmation";

describe("candidate confirmation parsing", () => {
  it("treats numbered disambiguation replies as candidate confirmations", () => {
    expect(isConfirmationReply("1")).toBe(true);
    expect(isConfirmationReply("2, AI infra")).toBe(true);
    expect(isConfirmationReply("first")).toBe(true);
    expect(isConfirmationReply("the dinner one")).toBe(true);
    expect(isConfirmationReply("4")).toBe(false);
  });

  it("maps ordinal and descriptive disambiguation replies to event options", () => {
    const eventMatches = [
      {
        id: "match_1",
        candidateId: "candidate_maya_1",
        calendarEventId: "event_photon_dinner",
        eventTitle: "Photon Residency Dinner",
        confidence: 0.92,
        reason: "overlap",
        rank: 1
      },
      {
        id: "match_2",
        candidateId: "candidate_maya_1",
        calendarEventId: "event_founders_meetup",
        eventTitle: "Founders Meetup",
        confidence: 0.82,
        reason: "overlap",
        rank: 2
      }
    ];

    expect(resolveCandidateConfirmation("first", eventMatches)).toMatchObject({
      eventId: "event_photon_dinner",
      contextNote: "met at Photon Residency Dinner"
    });
    expect(resolveCandidateConfirmation("the dinner one", eventMatches)).toMatchObject({
      eventId: "event_photon_dinner",
      contextNote: "met at Photon Residency Dinner"
    });
    expect(resolveCandidateConfirmation("the founders one", eventMatches)).toMatchObject({
      eventId: "event_founders_meetup",
      contextNote: "met at Founders Meetup"
    });
  });

  it("separates current event context from relationship backstory", () => {
    const result = resolveCandidateConfirmation(
      "yes, met abc at Photon Residency II after havent met him since high school in minnesota",
      [
        {
          id: "match_1",
          candidateId: "candidate_abc_1",
          calendarEventId: "event_photon_residency_ii",
          eventTitle: "Photon Residency II",
          confidence: 0.8,
          reason: "overlap",
          rank: 1
        }
      ]
    );

    expect(result).toMatchObject({
      eventId: "event_photon_residency_ii",
      contextNote: "met abc at Photon Residency II after havent met him since high school in Minnesota",
      relationshipContext: "had not seen him since high school in Minnesota"
    });
  });
});
