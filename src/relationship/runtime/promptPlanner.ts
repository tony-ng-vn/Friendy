/**
 * Deterministic iMessage prompt planner for newly detected contacts.
 *
 * Routing thresholds (see constants below):
 * - `single`: top score >= 60 and lead over second place > 15
 * - `weak`: one plausible event survives but is not strong enough to confirm
 * - `disambiguate`: two or more events >= 45
 * - `none`: no confident calendar match; ask an open-ended "where did you meet?" prompt
 */
import type { ScoredCalendarEvent } from "./calendarScorer";

/** Prompt route and user-facing text for a contact candidate. */
export type CandidatePromptPlan =
  | { route: "none"; text: string }
  | { route: "single"; eventMatchRank: 1; text: string }
  | { route: "weak"; eventMatchRank: 1; text: string }
  | { route: "disambiguate"; options: Array<{ rank: number; title: string }>; text: string }
  | { route: "duplicate_resolution"; suspectedDuplicatePersonId: string; text: string };

export type PlanCandidatePromptInput = {
  displayName: string;
  scoredEvents: ScoredCalendarEvent[];
};

/** Minimum top score to assert a single calendar match in the prompt. */
const SINGLE_EVENT_MIN_SCORE = 60;
/** Minimum score gap between first and second place required for the single route. */
const SINGLE_EVENT_GAP = 15;
/** Minimum score to include an event in disambiguation options or stay in contention. */
const DISAMBIGUATION_MIN_SCORE = 45;

/**
 * Builds the deterministic iMessage prompt for a newly detected contact candidate.
 *
 * Chooses `single`, `disambiguate`, or `none` from scored calendar context only;
 * the LLM does not participate in this routing.
 */
export function planCandidatePrompt({ displayName, scoredEvents }: PlanCandidatePromptInput): CandidatePromptPlan {
  const [top, second] = scoredEvents;

  if (!top || top.strength === "none" || top.score < DISAMBIGUATION_MIN_SCORE) {
    return noEventPrompt(displayName);
  }

  if (top.strength === "strong" && top.score >= SINGLE_EVENT_MIN_SCORE && (!second || top.score - second.score > SINGLE_EVENT_GAP)) {
    return {
      route: "single",
      eventMatchRank: 1,
      text: `I noticed you added ${displayName} during ${top.title}. Did you meet them there?`
    };
  }

  if (top.strength === "weak") {
    return {
      route: "weak",
      eventMatchRank: 1,
      text: `I noticed you added ${displayName}. Was this from ${top.title}, or somewhere else?`
    };
  }

  const options = scoredEvents
    .filter((event) => event.strength !== "none" && event.score >= DISAMBIGUATION_MIN_SCORE)
    .slice(0, 3)
    .map((event) => ({ rank: event.rank, title: event.title }));

  if (options.length < 2) {
    return noEventPrompt(displayName);
  }

  return {
    route: "disambiguate",
    options,
    text: [
      `I noticed you added ${displayName}. Was this from:`,
      ...options.map((option, index) => `${index + 1}. ${option.title}`),
      "",
      "Or somewhere else?"
    ].join("\n")
  };
}

function noEventPrompt(displayName: string): CandidatePromptPlan {
  return {
    route: "none",
    text: `I noticed you added ${displayName}. Where did you meet them?`
  };
}
