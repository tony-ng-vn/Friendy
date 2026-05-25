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
      "state-envelope-stale-prompt-complaint",
      "pending-reminder-search-footer",
      "pending-reminder-same-name-suppression",
      "pending-reminder-ttl-defer",
      "pending-reminder-list-never-footer",
      "strict-ambiguous-delete-clarifies-regression",
      "duplicate-exact-name-delete-disambiguation-regression",
      "delete-everyone-confirmation-regression",
      "sarah-fan-beside-role-update-regression",
      "sarah-fan-named-role-update-regression",
      "daniel-list-all-memory-regression",
      "photon-residency-what-people-event-recall-regression"
    ];

    expect(relationshipAgentEvalCases).toHaveLength(53);
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

    expect(summary.total).toBe(53);
    expect(summary.requiredTotal).toBe(53);
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

  it("tracks the delete-everyone confirmation regression assertions", () => {
    expect(
      relationshipAgentEvalCases.find((evalCase) => evalCase.id === "delete-everyone-confirmation-regression")?.assertionNames
    ).toEqual([
      "delete everyone opens confirmation",
      "delete everyone does not mutate before confirmation",
      "delete everyone removes all memories after yes"
    ]);
  });

  it("tracks the Sarah Fan beside role update regression assertions", () => {
    expect(
      relationshipAgentEvalCases.find((evalCase) => evalCase.id === "sarah-fan-beside-role-update-regression")
        ?.assertionNames
    ).toEqual([
      "Sarah Fan beside role update opens confirmation",
      "Sarah Fan beside role update does not mutate before confirmation",
      "Sarah Fan beside role update updates existing memory only"
    ]);
  });

  it("tracks the Sarah Fan named role update regression assertions", () => {
    expect(
      relationshipAgentEvalCases.find((evalCase) => evalCase.id === "sarah-fan-named-role-update-regression")
        ?.assertionNames
    ).toEqual([
      "Sarah Fan named role update opens confirmation",
      "Sarah Fan named role update does not create duplicate memory",
      "Sarah Fan named role update appends after confirmation"
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

  it("gates stochastic model evals behind an explicit flag and model API key", () => {
    expect(shouldRunModelBackedEvals({ OPENAI_API_KEY: "", FRIENDY_EVAL_RUN_MODEL: "1" })).toBe(false);
    expect(shouldRunModelBackedEvals({ OPENAI_API_KEY: "sk-test", FRIENDY_EVAL_RUN_MODEL: "" })).toBe(false);
    expect(shouldRunModelBackedEvals({ OPENAI_API_KEY: "sk-test", FRIENDY_EVAL_RUN_MODEL: "1" })).toBe(true);
  });

  it("exposes the agent eval runner as an npm script", () => {
    expect(packageJson.scripts["eval:agent"]).toBe("tsx src/relationship/evals/agentEvalCli.ts");
  });
});
