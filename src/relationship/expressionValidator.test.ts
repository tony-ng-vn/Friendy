import { describe, expect, it } from "vitest";
import { validateExpressionReply } from "./expressionValidator";
import {
  buildClarificationBundle,
  buildSearchAmbiguousMatchesBundle,
  buildSearchSingleMatchBundle,
  buildSaveConfirmationBundle
} from "./expressionFacts";

describe("validateExpressionReply", () => {
  it("accepts grounded buddy rewrite", () => {
    const bundle = buildSearchSingleMatchBundle({
      draft: "I think that was Sarah Fan.",
      match: { displayName: "Sarah Fan", event: "Photon Residency II", noteSnippet: "community lead" }
    });
    const result = validateExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      output: "Yeah, I think that was Sarah Fan — Photon Residency II, community lead."
    });
    expect(result.ok).toBe(true);
  });

  it("rejects internal terms", () => {
    const bundle = buildSearchSingleMatchBundle({
      draft: "I think that was Sarah Fan.",
      match: { displayName: "Sarah Fan" }
    });
    const result = validateExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      output: "High-confidence match located in your memory database."
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("banned_term");
    }
  });

  it("rejects certainty when ambiguous", () => {
    const bundle = buildSearchAmbiguousMatchesBundle({
      draft: "Which person do you mean?",
      matches: [
        { displayName: "Maya Chen", event: "Photon dinner" },
        { displayName: "Maya Patel", event: "Agents meetup" }
      ]
    });
    const result = validateExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      output: "Definitely Maya Chen from Photon dinner."
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("ambiguous_certainty");
    }
  });

  it("requires a question when bundle.requiresQuestion is true", () => {
    const bundle = buildSearchAmbiguousMatchesBundle({
      draft: "Which one?",
      matches: [{ displayName: "Maya Chen" }, { displayName: "Maya Patel" }]
    });
    const result = validateExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      output: "Could be Maya Chen or Maya Patel."
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("missing_required_question");
    }
  });

  it("requires saved name on save confirmation", () => {
    const bundle = buildSaveConfirmationBundle({
      draft: "Got it, saved Maya Chen.",
      savedPeople: [{ displayName: "Maya Chen" }]
    });
    const result = validateExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      output: "Got it, saved someone new."
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("missing_required_name");
    }
  });

  it("rejects empty output", () => {
    const bundle = buildClarificationBundle({
      draft: "What do you remember?",
      questionIntent: "search_clue"
    });
    const result = validateExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      output: "   "
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("empty_output");
    }
  });

  it("rejects output longer than bundle maxLength", () => {
    const bundle = buildSearchSingleMatchBundle({
      draft: "I think that was Sarah Fan.",
      match: { displayName: "Sarah Fan" }
    });
    const result = validateExpressionReply({
      draft: bundle.deterministicDraft,
      bundle: { ...bundle, maxLength: 20 },
      output: "Yeah, I think that was Sarah Fan and here is a lot more text."
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("too_long");
    }
  });

  it("rejects markdown when not allowed", () => {
    const bundle = buildSearchSingleMatchBundle({
      draft: "I think that was Sarah Fan.",
      match: { displayName: "Sarah Fan" }
    });
    const result = validateExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      output: "**Sarah Fan** from Photon."
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("markdown_not_allowed");
    }
  });

  it("rejects extra questions when requiresQuestion is false", () => {
    const bundle = buildSearchSingleMatchBundle({
      draft: "I think that was Sarah Fan.",
      match: { displayName: "Sarah Fan" },
      requiresQuestion: false
    });
    const result = validateExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      output: "Sarah Fan? From Photon? Maybe?"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("extra_questions");
    }
  });

  it("rejects invented relationship terms", () => {
    const bundle = buildSearchSingleMatchBundle({
      draft: "I think that was Sarah Fan.",
      match: { displayName: "Sarah Fan" }
    });
    const result = validateExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      output: "Yeah, Sarah Fan is your girlfriend from Photon."
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("invented_relationship_term");
    }
  });

  it("rejects email addresses", () => {
    const bundle = buildSearchSingleMatchBundle({
      draft: "I think that was Sarah Fan.",
      match: { displayName: "Sarah Fan" }
    });
    const result = validateExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      output: "Reach Sarah at sarah@example.com."
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("contact_detail_not_allowed");
    }
  });

  it("rejects full phone numbers even when abstract contact hints are allowed", () => {
    const bundle = buildSearchSingleMatchBundle({
      draft: "I think that was Sarah Fan.",
      match: {
        displayName: "Sarah Fan",
        contactHint: "number ending in 4567"
      }
    });
    expect(bundle.allowedContactHints).toEqual(["number ending in 4567"]);

    const result = validateExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      output: "Yeah, Sarah Fan — call her at 555-123-4567, number ending in 4567."
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("contact_detail_not_allowed");
    }
  });

  it("allows abstract contact hints without full phone numbers", () => {
    const bundle = buildSearchSingleMatchBundle({
      draft: "I think that was Sarah Fan.",
      match: {
        displayName: "Sarah Fan",
        event: "Photon Residency II",
        contactHint: "number ending in 4567"
      }
    });
    const result = validateExpressionReply({
      draft: bundle.deterministicDraft,
      bundle,
      output: "Yeah, Sarah Fan from Photon Residency II — number ending in 4567."
    });
    expect(result.ok).toBe(true);
  });
});
