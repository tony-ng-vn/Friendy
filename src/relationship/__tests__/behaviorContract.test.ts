import { describe, expect, it } from "vitest";
import {
  BEHAVIOR_CONTRACT_RULES,
  buildInterpreterSystemPrompt,
  buildStructuredOutputInstructions
} from "../behaviorContract";

describe("Friendy behavior contract", () => {
  it("captures required behavior rules from the finished spec", () => {
    expect(BEHAVIOR_CONTRACT_RULES).toContain("save_only_after_confirmation");
    expect(BEHAVIOR_CONTRACT_RULES).toContain("trust_user_correction_over_calendar_guess");
    expect(BEHAVIOR_CONTRACT_RULES).toContain("ask_when_uncertain");
    expect(BEHAVIOR_CONTRACT_RULES).toContain("stay_relationship_memory_scoped");
  });

  it("keeps product rules separate from structured output instructions", () => {
    expect(buildInterpreterSystemPrompt()).toContain("Friendy is a personal relationship memory agent");
    expect(buildInterpreterSystemPrompt()).toContain("Calendar guesses are suggestions");
    expect(buildInterpreterSystemPrompt()).toContain("Apple Contacts");
    expect(buildInterpreterSystemPrompt()).toContain("explicit user confirmation");
    expect(buildStructuredOutputInstructions()).toContain("Return JSON that matches the provided schema");
    expect(buildStructuredOutputInstructions()).toContain("request_apple_contact_create");
    expect(buildStructuredOutputInstructions()).toContain("request_apple_contact_update");
    expect(buildStructuredOutputInstructions()).toContain("request_apple_contact_delete");
  });
});
