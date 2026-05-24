import { describe, expect, it } from "vitest";
import {
  buildClarificationBundle,
  buildConversationRepairBundle,
  buildExplainAgentStateBundle,
  buildPendingContactExplanationBundle,
  buildSaveConfirmationBundle,
  buildSearchAmbiguousMatchesBundle,
  buildSearchNoMatchBundle,
  buildSearchSingleMatchBundle,
  GLOBAL_BANNED_EXPRESSION_TERMS,
  type ExpressionFactBundle
} from "./expressionFacts";

describe("expressionFacts", () => {
  it("builds a search single match bundle with allowed names only", () => {
    const bundle = buildSearchSingleMatchBundle({
      draft: "I think that was Sarah Fan. You told me you met them at Photon Residency II, and the clue was community lead.",
      match: {
        displayName: "Sarah Fan",
        event: "Photon Residency II",
        noteSnippet: "community lead"
      }
    });

    expect(bundle.kind).toBe("search_single_match");
    expect(bundle.allowedPeopleNames).toEqual(["Sarah Fan"]);
    expect(bundle.allowedEventNames).toEqual(["Photon Residency II"]);
    expect(bundle.allowedContextSnippets).toContain("community lead");
    expect(JSON.stringify(bundle)).not.toMatch(/memory_|candidate_|toolCalls/);
  });

  it("exports global banned internal terms", () => {
    expect(GLOBAL_BANNED_EXPRESSION_TERMS).toEqual(
      expect.arrayContaining(["database", "repository", "manual contact", "matched"])
    );
  });

  it("sets requiresQuestion for ambiguous bundles", () => {
    const bundle = buildSearchSingleMatchBundle({
      draft: "Which one?",
      match: { displayName: "Sarah Fan" },
      ambiguity: true,
      requiresQuestion: true
    }) as ExpressionFactBundle;

    expect(bundle.ambiguity).toBe(true);
    expect(bundle.requiresQuestion).toBe(true);
  });

  it("builds save confirmation bundle", () => {
    const bundle = buildSaveConfirmationBundle({
      draft: "Got it, saved Maya Chen from Photon dinner.",
      savedPeople: [{ displayName: "Maya Chen", event: "Photon dinner", noteSnippet: "building recruiting agents" }]
    });
    expect(bundle.kind).toBe("save_confirmation");
    expect(bundle.allowedPeopleNames).toEqual(["Maya Chen"]);
  });

  it("builds ambiguous search bundle with ambiguity flag", () => {
    const bundle = buildSearchAmbiguousMatchesBundle({
      draft: "I found 2 possible matches... Which person do you mean?",
      matches: [
        { displayName: "Maya Chen", event: "Photon dinner" },
        { displayName: "Maya Patel", event: "Agents meetup" }
      ]
    });
    expect(bundle.ambiguity).toBe(true);
    expect(bundle.requiresQuestion).toBe(true);
    expect(bundle.allowedPeopleNames).toEqual(["Maya Chen", "Maya Patel"]);
  });

  it("builds no match bundle with clue types", () => {
    const bundle = buildSearchNoMatchBundle({
      draft: "I couldn't find anyone like that yet.",
      suggestedClueTypes: ["event", "project", "school"]
    });
    expect(bundle.kind).toBe("search_no_match");
  });

  it("builds clarification bundle", () => {
    const bundle = buildClarificationBundle({
      draft: "What do you remember about them?",
      questionIntent: "search_clue"
    });
    expect(bundle.requiresQuestion).toBe(true);
  });

  it("builds pending contact explanation bundle", () => {
    const bundle = buildPendingContactExplanationBundle({
      draft: "I'm asking about Sarah Fan.",
      activeDisplayName: "Sarah Fan",
      queueNames: ["Testing 2"]
    });
    expect(bundle.allowedPeopleNames).toEqual(["Sarah Fan", "Testing 2"]);
  });

  it("builds repair and explain bundles", () => {
    expect(
      buildConversationRepairBundle({
        draft: "You're right — I shouldn't still be asking about Testing 3.",
        repairTopic: "stale_prompt"
      }).styleHint
    ).toBe("repair");

    expect(
      buildExplainAgentStateBundle({
        draft: "I'm waiting on context for Sarah Fan.",
        workflowSummary: "pending contact confirmation for Sarah Fan"
      }).kind
    ).toBe("explain_agent_state");
  });
});
