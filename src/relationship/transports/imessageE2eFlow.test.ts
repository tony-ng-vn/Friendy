import { describe, expect, it } from "vitest";
import { runImessageContactConfirmationFlow } from "./imessageE2eFlow";

describe("iMessage contact confirmation E2E flow", () => {
  it("prints the deterministic iMessage-first contact confirmation loop", async () => {
    const flow = await runImessageContactConfirmationFlow();

    expect(flow.lines).toEqual([
      "Detected contact: Abc",
      "Best event guess: Photon Residency II",
      "Friendy -> User: I noticed you added Abc around Photon Residency II. Did you meet them there?",
      "User -> Friendy: yes, met abc at Photon Residency II after havent met him since high school in minnesota",
      "Saved memory: Abc",
      "Event context: Photon Residency II",
      "Relationship backstory: had not seen him since high school in Minnesota",
      "User -> Friendy: who did I run into from high school at Photon?",
      "Friendy -> User: I think that was Abc"
    ]);
  });

  it("saves the confirmed candidate with event context, backstory, note, and detected contact method", async () => {
    const flow = await runImessageContactConfirmationFlow();
    const [memory] = flow.memories;

    expect(memory).toMatchObject({
      displayName: "Abc",
      candidateId: expect.stringContaining("candidate_abc"),
      eventTitle: "Photon Residency II",
      relationshipContext: "had not seen him since high school in Minnesota",
      primaryContactLabel: "+15550101999"
    });
    expect(memory.contextNote).toContain("Photon Residency II");
    expect(memory.contextNote).toContain("high school in Minnesota");
    expect(flow.searchReply).toContain("Abc");
  });
});
