import type { CalendarEvent, ContactCandidateDetected, EventContextMatch } from "./types";

const EVENT_KIND_CONFIDENCE = {
  short: 0.92,
  long: 0.62,
  all_day: 0.42
} as const;

const EVENT_KIND_RANK = {
  short: 1,
  long: 2,
  all_day: 3
} as const;

export function createCandidateId(contact: Pick<ContactCandidateDetected, "displayName" | "detectedAt">): string {
  return `candidate_${slug(contact.displayName)}_${new Date(contact.detectedAt).getTime()}`;
}

export function mapCandidateToEvents(
  candidateId: string,
  contact: ContactCandidateDetected,
  events: CalendarEvent[]
): EventContextMatch[] {
  const detectedAt = new Date(contact.detectedAt).getTime();
  const overlapping = events.filter((event) => {
    const startsAt = new Date(event.startsAt).getTime();
    const endsAt = new Date(event.endsAt).getTime();
    return startsAt <= detectedAt && detectedAt <= endsAt;
  });

  return overlapping
    .map((event) => ({
      id: `match_${candidateId}_${event.id}`,
      candidateId,
      calendarEventId: event.id,
      eventTitle: event.title,
      confidence: EVENT_KIND_CONFIDENCE[event.eventKind],
      reason: buildReason(event),
      rank: EVENT_KIND_RANK[event.eventKind]
    }))
    .sort((a, b) => a.rank - b.rank || b.confidence - a.confidence)
    .map((match, index) => ({ ...match, rank: index + 1 }));
}

function buildReason(event: CalendarEvent): string {
  if (event.eventKind === "short") {
    return `Detected during the specific event "${event.title}".`;
  }

  if (event.eventKind === "long") {
    return `Detected inside the longer background event "${event.title}".`;
  }

  return `Detected during the all-day event "${event.title}".`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
