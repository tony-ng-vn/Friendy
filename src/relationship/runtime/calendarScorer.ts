/**
 * Heuristic calendar scorer for macOS sensor `contact_added` events.
 *
 * Raw EventKit snapshots are filtered and ranked with additive weights (overlap,
 * social title, location, attendees, duration) and penalties (logistics, work
 * blocks, all-day, long events). Only events above `MIN_SURVIVING_SCORE` survive;
 * the top three deduplicated matches feed `promptPlanner`.
 */
import type { MacosCalendarMatch } from "./sensorEvents";

export type EventGuessStrength = "strong" | "weak" | "none";

export type ScoredCalendarEvent = {
  eventId: string;
  title: string;
  score: number;
  strength: EventGuessStrength;
  rank: number;
  reason: string;
  snapshot: MacosCalendarMatch;
};

export type ScoreCalendarContextInput = {
  detectedAt: string;
  calendarMatches: MacosCalendarMatch[];
};

const STRONG_EVENT_TERMS = [
  "dinner",
  "lunch",
  "coffee",
  "meetup",
  "hackathon",
  "residency",
  "conference",
  "summit",
  "presentation day",
  "party",
  "social",
  "founders",
  "workshop",
  "offsite"
];

const LOGISTICS_TERMS = [
  "commute",
  "flight",
  "travel",
  "uber",
  "lyft",
  "train",
  "bus",
  "gym",
  "doctor",
  "dentist",
  "laundry",
  "errand"
];

const WORK_BLOCK_TERMS = ["focus", "deep work", "heads down", "work block"];
const NOISE_CALENDAR_TERMS = ["holidays", "holiday", "birthday", "birthdays", "weather", "sports"];
const GENERIC_AVAILABILITY_TITLES = new Set(["busy", "hold", "blocked", "ooo"]);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * Scores raw EventKit snapshots for product-safe Friendy prompt routing.
 *
 * Weight highlights: +40 overlap with detection time, +25 strong social title,
 * +15 location, +10 attendees, +10 social-length duration; penalties include
 * -35 logistics titles, -25 work blocks, -30 all-day, and -15 when there is
 * no location or attendee signal.
 */
export function scoreCalendarContext({ detectedAt, calendarMatches }: ScoreCalendarContextInput): ScoredCalendarEvent[] {
  const detectedAtMs = new Date(detectedAt).getTime();
  const scored = calendarMatches
    .map((event) => scoreEvent(event, detectedAtMs))
    .filter((event): event is Omit<ScoredCalendarEvent, "rank"> => event !== undefined);

  return collapseDuplicates(scored)
    .sort((a, b) => compareScoredEvents(a, b, detectedAtMs))
    .slice(0, 3)
    .map((event, index) => ({ ...event, rank: index + 1 }));
}

function scoreEvent(event: MacosCalendarMatch, detectedAtMs: number): Omit<ScoredCalendarEvent, "rank"> | undefined {
  const title = event.title.trim();
  if (!title) {
    return undefined;
  }

  const normalizedTitle = normalize(title);
  const normalizedCalendar = normalize(`${event.calendarSource} ${event.calendarTitle}`);
  const durationMs = new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime();
  const hasStrongEventTerm = includesAny(normalizedTitle, STRONG_EVENT_TERMS);
  const hasLocation = Boolean(event.location?.trim());
  const attendeeCount = event.attendeeCount ?? 0;

  if (event.status && /cancelled|canceled|declined/i.test(event.status)) {
    return undefined;
  }

  if ((normalizedTitle === "private" || normalizedTitle === "unavailable") && !hasLocation && attendeeCount === 0) {
    return undefined;
  }

  if (GENERIC_AVAILABILITY_TITLES.has(normalizedTitle)) {
    return undefined;
  }

  if (includesAny(normalizedCalendar, NOISE_CALENDAR_TERMS)) {
    return undefined;
  }

  if ((event.isAllDay || durationMs > 24 * HOUR) && !hasStrongEventTerm) {
    return undefined;
  }

  let score = 0;
  const reasons: string[] = [];
  const startsAtMs = new Date(event.startsAt).getTime();
  const endsAtMs = new Date(event.endsAt).getTime();

  if (startsAtMs <= detectedAtMs && detectedAtMs <= endsAtMs) {
    score += 40;
    reasons.push("overlaps detection time");
  }

  if (hasStrongEventTerm) {
    score += 25;
    reasons.push("strong social event title");
  }

  if (hasLocation) {
    score += 15;
    reasons.push("has location");
  }

  if (attendeeCount > 1) {
    score += 10;
    reasons.push("has attendees");
  }

  if (durationMs >= 30 * MINUTE && durationMs <= 6 * HOUR) {
    score += 10;
    reasons.push("social-length duration");
  }

  if (endsAtMs <= detectedAtMs && endsAtMs >= detectedAtMs - 2 * HOUR) {
    score += 8;
    reasons.push("ended recently");
  }

  if (startsAtMs >= detectedAtMs && startsAtMs <= detectedAtMs + HOUR) {
    score += 5;
    reasons.push("starts soon");
  }

  if (includesAny(normalizedTitle, LOGISTICS_TERMS)) {
    score -= 35;
    reasons.push("logistics title penalty");
  }

  if (includesAny(normalizedTitle, WORK_BLOCK_TERMS)) {
    score -= 25;
    reasons.push("work block title penalty");
  }

  if (!hasLocation && attendeeCount === 0) {
    score -= 15;
    reasons.push("no location or attendee signal");
  }

  if (durationMs > 8 * HOUR) {
    score -= 20;
    reasons.push("long duration penalty");
  }

  if (event.isAllDay) {
    score -= 30;
    reasons.push("all-day penalty");
  }

  const strength = eventGuessStrength(score);
  if (strength === "none") {
    return undefined;
  }

  return {
    eventId: event.eventIdentifier || snapshotId(event),
    title,
    score,
    strength,
    reason: reasons.join("; "),
    snapshot: event
  };
}

function eventGuessStrength(score: number): EventGuessStrength {
  if (score >= 60) {
    return "strong";
  }

  if (score >= 45) {
    return "weak";
  }

  return "none";
}

function collapseDuplicates(events: Array<Omit<ScoredCalendarEvent, "rank">>): Array<Omit<ScoredCalendarEvent, "rank">> {
  const byKey = new Map<string, Omit<ScoredCalendarEvent, "rank">>();
  for (const event of events) {
    const key = duplicateKey(event.snapshot);
    const existing = byKey.get(key);
    if (!existing || event.score > existing.score || (event.score === existing.score && eventIdSortKey(event) < eventIdSortKey(existing))) {
      byKey.set(key, event);
    }
  }

  return [...byKey.values()];
}

function compareScoredEvents(
  a: Omit<ScoredCalendarEvent, "rank">,
  b: Omit<ScoredCalendarEvent, "rank">,
  detectedAtMs: number
): number {
  return (
    b.score - a.score ||
    durationMs(a.snapshot) - durationMs(b.snapshot) ||
    Math.abs(new Date(a.snapshot.startsAt).getTime() - detectedAtMs) -
      Math.abs(new Date(b.snapshot.startsAt).getTime() - detectedAtMs) ||
    a.title.localeCompare(b.title) ||
    eventIdSortKey(a).localeCompare(eventIdSortKey(b))
  );
}

function duplicateKey(event: MacosCalendarMatch): string {
  return [normalize(event.title), event.startsAt, event.endsAt].join("|");
}

function durationMs(event: MacosCalendarMatch): number {
  return new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime();
}

function eventIdSortKey(event: Pick<ScoredCalendarEvent, "eventId" | "snapshot">): string {
  return `${event.snapshot.calendarIdentifier ?? ""}|${event.eventId}`;
}

function snapshotId(event: MacosCalendarMatch): string {
  return `calendar_snapshot_${hash([event.title, event.startsAt, event.endsAt, event.calendarIdentifier ?? "", event.location ?? ""].join("|"))}`;
}

function hash(value: string): string {
  let output = 5381;
  for (let index = 0; index < value.length; index += 1) {
    output = (output * 33) ^ value.charCodeAt(index);
  }
  return (output >>> 0).toString(36);
}

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
