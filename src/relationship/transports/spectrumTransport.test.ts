import { toInboundAgentMessage } from "./spectrumTransport";

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
});
