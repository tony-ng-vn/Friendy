import { describe, expect, it } from "vitest";
import { planCandidatePrompt } from "./promptPlanner";
import type { ScoredCalendarEvent } from "./calendarScorer";

describe("candidate prompt planner", () => {
  it("asks for manual context when no scored events survive", () => {
    const plan = planCandidatePrompt({ displayName: "Maya", scoredEvents: [] });

    expect(plan).toEqual({
      route: "none",
      text: "I noticed you added Maya. Where did you meet them?"
    });
  });

  it("uses a single-event confirmation when the top event is strong and separated", () => {
    const plan = planCandidatePrompt({
      displayName: "Maya",
      scoredEvents: [
        scoredEvent({ rank: 1, title: "Photon Residency Dinner", score: 95 }),
        scoredEvent({ rank: 2, title: "Founders Meetup", score: 60 })
      ]
    });

    expect(plan).toEqual({
      route: "single",
      eventMatchRank: 1,
      text: "I noticed you added Maya during Photon Residency Dinner. Did you meet them there?"
    });
  });

  it("uses numbered disambiguation for multiple plausible events", () => {
    const plan = planCandidatePrompt({
      displayName: "Maya",
      scoredEvents: [
        scoredEvent({ rank: 1, title: "Photon Residency Dinner", score: 70 }),
        scoredEvent({ rank: 2, title: "Founders Meetup", score: 62 }),
        scoredEvent({ rank: 3, title: "Coffee Social", score: 45 })
      ]
    });

    expect(plan.route).toBe("disambiguate");
    expect(plan.text).toBe(
      "I noticed you added Maya. Was this from:\n1. Photon Residency Dinner\n2. Founders Meetup\n3. Coffee Social\n\nOr somewhere else?"
    );
    if (plan.route !== "disambiguate") {
      throw new Error(`Expected disambiguate, received ${plan.route}`);
    }
    expect(plan.options).toEqual([
      { rank: 1, title: "Photon Residency Dinner" },
      { rank: 2, title: "Founders Meetup" },
      { rank: 3, title: "Coffee Social" }
    ]);
  });

  it("asks a weak event guess as a suggestion instead of confirmation", () => {
    const plan = planCandidatePrompt({
      displayName: "Maya",
      scoredEvents: [
        scoredEvent({
          rank: 1,
          title: "Photon Residency Dinner",
          score: 50,
          strength: "weak",
          reason: "Nearby but not clearly overlapping."
        })
      ]
    });

    expect(plan).toMatchObject({
      route: "weak",
      eventMatchRank: 1,
      text: "I noticed you added Maya. Was this from Photon Residency Dinner, or somewhere else?"
    });
  });

  it("falls back to no-event prompt when only weak events remain", () => {
    const plan = planCandidatePrompt({
      displayName: "Maya",
      scoredEvents: [scoredEvent({ rank: 1, title: "Maybe Relevant", score: 44 })]
    });

    expect(plan.route).toBe("none");
  });
});

function scoredEvent(overrides: Partial<ScoredCalendarEvent>): ScoredCalendarEvent {
  const title = overrides.title ?? "Photon Residency Dinner";
  const score = overrides.score ?? 90;
  return {
    eventId: `event_${title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    title,
    score,
    strength: strengthForScore(score),
    rank: 1,
    reason: "test event",
    snapshot: {
      eventIdentifier: `event_${title}`,
      calendarIdentifier: "calendar_work",
      title,
      startsAt: "2026-05-21T18:00:00-07:00",
      endsAt: "2026-05-21T21:00:00-07:00",
      location: "San Francisco",
      calendarSource: "iCloud",
      calendarTitle: "Work",
      isAllDay: false,
      attendeeCount: 8,
      availability: "busy",
      status: "confirmed",
      isRecurring: false
    },
    ...overrides
  };
}

function strengthForScore(score: number): ScoredCalendarEvent["strength"] {
  if (score >= 60) {
    return "strong";
  }

  if (score >= 45) {
    return "weak";
  }

  return "none";
}
