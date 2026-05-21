import type { ScoredCalendarEvent } from "./calendarScorer";

export type CandidatePromptPlan =
  | { route: "none"; text: string }
  | { route: "single"; eventMatchRank: 1; text: string }
  | { route: "disambiguate"; options: Array<{ rank: number; title: string }>; text: string };

export type PlanCandidatePromptInput = {
  displayName: string;
  scoredEvents: ScoredCalendarEvent[];
};

const SINGLE_EVENT_MIN_SCORE = 60;
const SINGLE_EVENT_GAP = 15;
const DISAMBIGUATION_MIN_SCORE = 45;

/** Builds the deterministic iMessage prompt for a newly detected contact candidate. */
export function planCandidatePrompt({ displayName, scoredEvents }: PlanCandidatePromptInput): CandidatePromptPlan {
  const [top, second] = scoredEvents;

  if (!top || top.score < DISAMBIGUATION_MIN_SCORE) {
    return noEventPrompt(displayName);
  }

  if (top.score >= SINGLE_EVENT_MIN_SCORE && (!second || top.score - second.score > SINGLE_EVENT_GAP)) {
    return {
      route: "single",
      eventMatchRank: 1,
      text: `I noticed you added ${displayName} during ${top.title}. Did you meet them there?`
    };
  }

  const options = scoredEvents
    .filter((event) => event.score >= DISAMBIGUATION_MIN_SCORE)
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
