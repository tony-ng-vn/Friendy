import { describe, expect, it, vi } from "vitest";
import { createSpectrumPromptSender, resolveSpectrumPromptRecipient } from "./spectrumPromptSender";

describe("Spectrum proactive prompt sender", () => {
  it("sends Friendy sensor prompts to the configured iMessage owner", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const space = vi.fn().mockResolvedValue({ send });
    const user = vi.fn().mockResolvedValue({ id: "imessage_user_1" });
    const sender = createSpectrumPromptSender({
      toPhone: "+15550109999",
      imessageClient: { user, space },
      now: () => "2026-05-21T12:00:00.000Z"
    });

    const result = await sender.sendPrompt({
      userId: "user_friendy",
      candidateId: "candidate_maya",
      text: "I noticed you added Maya. Was this from Photon Residency Dinner?"
    });

    expect(user).toHaveBeenCalledWith("+15550109999");
    expect(space).toHaveBeenCalledWith({ id: "imessage_user_1" });
    expect(send).toHaveBeenCalledWith("I noticed you added Maya. Was this from Photon Residency Dinner?");
    expect(result.interactionId).toBe("spectrum_prompt_20260521120000000Z_candidate_maya");
  });

  it("resolves the proactive prompt recipient from explicit prompt phone before owner phone", () => {
    expect(
      resolveSpectrumPromptRecipient({
        FRIENDY_PROMPT_TO_PHONE: "+15550101111",
        FRIENDY_OWNER_PHONE: "+15550102222"
      })
    ).toBe("+15550101111");
  });
});
