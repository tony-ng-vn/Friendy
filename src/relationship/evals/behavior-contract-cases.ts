/**
 * Human-readable names for high-level behavior-contract scenarios.
 *
 * Used by docs and smoke checks to refer to the same flows covered in
 * `agentEvalRunner.ts` without duplicating full eval implementations here.
 */
/** Stable ids for behavior-contract documentation and cross-referencing eval cases. */
export const behaviorContractCaseNames = [
  "unsafe save from contact detection is blocked",
  "user correction overrides calendar guess",
  "ambiguous search asks for clarification",
  "follow-up clue narrows previous search",
  "broad related-contact recall reaches search",
  "vague document recall reaches search",
  "unrelated request redirects to relationship memory scope"
] as const;
