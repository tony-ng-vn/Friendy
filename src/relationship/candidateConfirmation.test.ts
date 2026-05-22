import { describe, expect, it } from "vitest";
import { isConfirmationReply, resolveCandidateConfirmation } from "./candidateConfirmation";

describe("candidate confirmation parsing", () => {
  it("treats numbered disambiguation replies as candidate confirmations", () => {
    expect(isConfirmationReply("1")).toBe(true);
    expect(isConfirmationReply("2, AI infra")).toBe(true);
    expect(isConfirmationReply("4")).toBe(false);
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
