import { describe, expect, it } from "vitest";
import { EXPRESSION_GOLDEN_CASES, hasCasualToneHeuristic } from "./expressionGoldenCases";
import { validateExpressionReply } from "./expressionValidator";

describe("EXPRESSION_GOLDEN_CASES", () => {
  it("includes at least six expression constraint cases", () => {
    expect(EXPRESSION_GOLDEN_CASES.length).toBeGreaterThanOrEqual(6);
  });

  it.each(EXPRESSION_GOLDEN_CASES)("$id accepts good examples and rejects bad examples", (goldenCase) => {
    for (const good of goldenCase.goodExamples) {
      const result = validateExpressionReply({
        draft: goldenCase.draft,
        bundle: goldenCase.bundle,
        output: good
      });
      expect(result.ok, `${goldenCase.id} good example failed: ${good}`).toBe(true);
      expect(hasCasualToneHeuristic(good)).toBe(true);
    }

    for (const bad of goldenCase.badExamples) {
      const result = validateExpressionReply({
        draft: goldenCase.draft,
        bundle: goldenCase.bundle,
        output: bad
      });
      expect(result.ok, `${goldenCase.id} bad example unexpectedly passed: ${bad}`).toBe(false);
    }
  });
});
