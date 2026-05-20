import { describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import {
  getEvalExitCode,
  relationshipAgentEvalCases,
  runRelationshipAgentEvals,
  shouldRunModelBackedEvals
} from "./agentEvalRunner";

describe("relationship agent eval runner", () => {
  it("defines the required 12 trajectory eval cases with measurable assertions", () => {
    const requiredIds = [
      "clear-event-contact-confirmation",
      "overlapping-event-correction",
      "no-event-user-supplied-event",
      "ignored-candidate",
      "post-confirmation-search",
      "vague-search-clarification",
      "multi-person-event-recall",
      "context-carryover",
      "hallucination-guard",
      "unsafe-save-guard",
      "spectrum-first-inbound-identity",
      "messy-human-wording"
    ];

    expect(relationshipAgentEvalCases).toHaveLength(12);
    expect(relationshipAgentEvalCases.map((item) => item.id)).toEqual(requiredIds);
    for (const evalCase of relationshipAgentEvalCases) {
      expect(evalCase.required).toBe(true);
      expect(evalCase.agentMode).toMatch(/^(deterministic|interpreted|spectrum)$/);
      expect(evalCase.assertionNames.length).toBeGreaterThan(0);
      expect(evalCase.assertionNames.every((name) => !/exact prose|exact text/i.test(name))).toBe(true);
    }
  });

  it("runs the deterministic required eval set and reports metric categories", async () => {
    const summary = await runRelationshipAgentEvals({
      runModelBackedEvals: false,
      now: () => "2026-05-20T12:00:00.000Z"
    });

    expect(summary.total).toBe(12);
    expect(summary.requiredTotal).toBe(12);
    expect(summary.failed).toBe(0);
    expect(summary.metrics.passRate).toBe(1);
    expect(summary.metrics.intentAccuracy).toBe(1);
    expect(summary.metrics.memoryWriteCorrectness).toBe(1);
    expect(summary.metrics.searchRecallAt3).toBe(1);
    expect(summary.metrics.unsafeMutationCount).toBe(0);
    expect(summary.metrics.hallucinationCount).toBe(0);
    expect(summary.metrics.clarificationCorrectness).toBe(1);
    expect(summary.optionalModelBacked.enabled).toBe(false);
    expect(summary.results.every((result) => result.assertions.every((assertion) => assertion.passed))).toBe(true);
  });

  it("returns nonzero exit code when any required eval fails", () => {
    expect(
      getEvalExitCode({
        requiredFailed: 1
      })
    ).toBe(1);
    expect(
      getEvalExitCode({
        requiredFailed: 0
      })
    ).toBe(0);
  });

  it("gates stochastic OpenRouter evals behind an explicit flag and API key", () => {
    expect(shouldRunModelBackedEvals({ OPENROUTER_API_KEY: "", FRIENDY_EVAL_RUN_MODEL: "1" })).toBe(false);
    expect(shouldRunModelBackedEvals({ OPENROUTER_API_KEY: "sk-test", FRIENDY_EVAL_RUN_MODEL: "" })).toBe(false);
    expect(shouldRunModelBackedEvals({ OPENROUTER_API_KEY: "sk-test", FRIENDY_EVAL_RUN_MODEL: "1" })).toBe(true);
  });

  it("exposes the agent eval runner as an npm script", () => {
    expect(packageJson.scripts["eval:agent"]).toBe("tsx src/relationship/evals/agentEvalCli.ts");
  });
});
