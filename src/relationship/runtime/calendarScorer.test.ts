import { describe, expect, it } from "vitest";
import { scoreCalendarContext } from "./calendarScorer";
import type { MacosCalendarMatch } from "./sensorEvents";

describe("macOS calendar context scorer", () => {
  it("discards generic personal blocks without social or location signals", () => {
    const scored = scoreCalendarContext({
      detectedAt: "2026-05-21T10:30:00-07:00",
      calendarMatches: [
        calendarMatch({
          title: "Read paper",
          startsAt: "2026-05-21T10:00:00-07:00",
          endsAt: "2026-05-21T11:00:00-07:00",
          location: "",
          attendeeCount: 0
        })
      ]
    });

    expect(scored).toEqual([]);
  });

  it("scores a strong overlapping social event above the single-event threshold", () => {
    const [event] = scoreCalendarContext({
      detectedAt: "2026-05-21T20:30:00-07:00",
      calendarMatches: [
        calendarMatch({
          title: "Photon Residency Dinner",
          startsAt: "2026-05-21T18:00:00-07:00",
          endsAt: "2026-05-21T21:00:00-07:00",
          location: "San Francisco",
          attendeeCount: 12
        })
      ]
    });

    expect(event).toMatchObject({
      title: "Photon Residency Dinner",
      rank: 1
    });
    expect(event.score).toBeGreaterThanOrEqual(60);
    expect(event.reason).toContain("overlaps detection time");
  });

  it("penalizes logistics and work blocks even when they overlap", () => {
    const scored = scoreCalendarContext({
      detectedAt: "2026-05-21T09:30:00-07:00",
      calendarMatches: [
        calendarMatch({
          title: "Uber to office",
          startsAt: "2026-05-21T09:00:00-07:00",
          endsAt: "2026-05-21T10:00:00-07:00",
          location: "San Francisco",
          attendeeCount: 0
        }),
        calendarMatch({
          title: "Deep work block",
          startsAt: "2026-05-21T09:00:00-07:00",
          endsAt: "2026-05-21T11:00:00-07:00",
          location: "",
          attendeeCount: 0
        })
      ]
    });

    expect(scored).toEqual([]);
  });

  it("collapses duplicate calendar results and keeps the highest-scoring snapshot", () => {
    const scored = scoreCalendarContext({
      detectedAt: "2026-05-21T20:30:00-07:00",
      calendarMatches: [
        calendarMatch({
          eventIdentifier: "event_duplicate_low",
          calendarIdentifier: "calendar_low",
          title: "Photon Residency Dinner",
          startsAt: "2026-05-21T18:00:00-07:00",
          endsAt: "2026-05-21T21:00:00-07:00",
          location: "",
          attendeeCount: 0
        }),
        calendarMatch({
          eventIdentifier: "event_duplicate_high",
          calendarIdentifier: "calendar_high",
          title: "Photon Residency Dinner",
          startsAt: "2026-05-21T18:00:00-07:00",
          endsAt: "2026-05-21T21:00:00-07:00",
          location: "San Francisco",
          attendeeCount: 12
        })
      ]
    });

    expect(scored).toHaveLength(1);
    expect(scored[0].eventId).toBe("event_duplicate_high");
  });

  it("keeps at most three ranked prompt options with deterministic tie-breaks", () => {
    const scored = scoreCalendarContext({
      detectedAt: "2026-05-21T12:00:00-07:00",
      calendarMatches: [
        calendarMatch({ title: "Founders Meetup", startsAt: "2026-05-21T11:00:00-07:00", endsAt: "2026-05-21T13:00:00-07:00" }),
        calendarMatch({ title: "Photon Lunch", startsAt: "2026-05-21T11:30:00-07:00", endsAt: "2026-05-21T13:00:00-07:00" }),
        calendarMatch({ title: "AI Workshop", startsAt: "2026-05-21T10:30:00-07:00", endsAt: "2026-05-21T13:30:00-07:00" }),
        calendarMatch({ title: "Coffee Social", startsAt: "2026-05-21T10:00:00-07:00", endsAt: "2026-05-21T14:00:00-07:00" })
      ]
    });

    expect(scored).toHaveLength(3);
    expect(scored.map((event) => event.rank)).toEqual([1, 2, 3]);
    expect(scored[0].score).toBeGreaterThanOrEqual(scored[1].score);
  });
});

function calendarMatch(overrides: Partial<MacosCalendarMatch>): MacosCalendarMatch {
  return {
    eventIdentifier: `event_${slug(overrides.title ?? "event")}`,
    calendarIdentifier: "calendar_work",
    title: "Photon Residency Dinner",
    startsAt: "2026-05-21T18:00:00-07:00",
    endsAt: "2026-05-21T21:00:00-07:00",
    location: "San Francisco",
    calendarSource: "iCloud",
    calendarTitle: "Work",
    isAllDay: false,
    attendeeCount: 8,
    availability: "busy",
    status: "confirmed",
    isRecurring: false,
    ...overrides
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
