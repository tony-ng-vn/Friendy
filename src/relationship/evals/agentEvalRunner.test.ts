import { describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import {
  formatEvalSummary,
  getEvalExitCode,
  relationshipAgentEvalCases,
  runRelationshipAgentEvals,
  shouldRunModelBackedEvals
} from "./agentEvalRunner";

describe("relationship agent eval runner", () => {
  it("defines the required trajectory eval cases with measurable assertions", () => {
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
      "messy-human-wording",
      "scope-out-of-scope-math",
      "scope-person-laundered-coding",
      "scope-in-scope-refusal-draft",
      "scope-ambiguous-message-draft",
      "scope-adversarial-instruction",
      "follow-up-search-narrowing",
      "follow-up-search-expiry",
      "active-memory-correction",
      "ambiguous-memory-correction",
      "untargeted-memory-correction",
      "natural-save-confirmation-wording",
      "calendar-missing-contact-prompt",
      "weak-event-guess-prompt",
      "candidate-detection-no-unsafe-save",
      "multi-candidate-bare-yes-ambiguity",
      "delete-removes-memory-from-search",
      "broad-related-contact-recall",
      "list-all-contact-recall",
      "hybrid-document-vague-recall",
      "pending-contact-pronoun-context",
      "event-recall-not-list-all",
      "manual-add-as-memory",
      "friendy-doctor-setup-failure-copy",
      "strict-mode-fallback-rejection",
      "duplicate-pending-filtered-list-regression",
      "duplicate-audit-in-scope-regression",
      "conversation-repair-pending-vs-saved-regression",
      "fuzzy-delete-memory-confirmation-regression",
      "same-name-pending-contact-disambiguation-regression",
      "state-envelope-stale-prompt-complaint"
    ];

    expect(relationshipAgentEvalCases).toHaveLength(42);
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

    expect(summary.total).toBe(42);
    expect(summary.requiredTotal).toBe(42);
    expect(summary.failed).toBe(0);
    expect(summary.metrics.passRate).toBe(1);
    expect(summary.metrics.intentAccuracy).toBe(1);
    expect(summary.metrics.memoryWriteCorrectness).toBe(1);
    expect(summary.metrics.searchRecallAt3).toBe(1);
    expect(summary.metrics.unsafeMutationCount).toBe(0);
    expect(summary.metrics.hallucinationCount).toBe(0);
    expect(summary.metrics.clarificationCorrectness).toBe(1);
    expect(summary.metrics.scopeBoundaryCorrectness).toBe(1);
    expect(summary.metrics.fallbackUsageCount).toBeGreaterThan(0);
    expect(summary.optionalModelBacked.enabled).toBe(false);
    expect(summary.results.every((result) => result.assertions.every((assertion) => assertion.passed))).toBe(true);
    expect(summary.results.find((result) => result.id === "strict-mode-fallback-rejection")).toMatchObject({
      passed: true
    });
    expect(formatEvalSummary(summary)).toContain("Fallback usage count:");
  });

  it("tracks the dedicated list_people regression assertions", () => {
    expect(
      relationshipAgentEvalCases.find((evalCase) => evalCase.id === "duplicate-pending-filtered-list-regression")
        ?.assertionNames
    ).toEqual([
      "filtered bullet list uses list_people route",
      "filtered bullet list does not use search fallback",
      "filtered bullet list returns matching saved people",
      "filtered bullet list respects bullet formatting",
      "filtered bullet list suppresses stale pending reminder",
      "filtered bullet list excludes unrelated people"
    ]);
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
