/**
 * Deterministic contact-to-calendar event matching at detection time.
 *
 * Maps a newly detected contact's `detectedAt` to overlapping calendar windows and
 * ranks matches so narrow events outrank long background events. Callers: ingestion
 * pipeline, fixture checks, tests. Does not persist — repository stores matches.
 */
import type { CalendarEvent, ContactCandidateDetected, EventContextMatch } from "./types";

// Short events beat long background events because users usually remember the specific dinner or meetup, not the whole residency.
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

/**
 * Creates a stable candidate id from contact identity and detection time.
 *
 * Deterministic for fixture replay and idempotent ingestion retries. Real persistence
 * may replace this with database ids without changing agent behavior.
 *
 * @param contact - Display name, detection instant, optional contact identifier, source
 */
export function createCandidateId(
  contact: Pick<ContactCandidateDetected, "displayName" | "detectedAt" | "contactIdentifier" | "source">
): string {
  if (contact.source === "manual_imessage" && contact.contactIdentifier) {
    return `candidate_${slug(contact.displayName)}_${slug(contact.contactIdentifier)}`;
  }

  const identity = contact.contactIdentifier ? `_${slug(contact.contactIdentifier)}` : "";
  return `candidate_${slug(contact.displayName)}_${new Date(contact.detectedAt).getTime()}${identity}`;
}

/**
 * Maps a newly detected contact to calendar events whose windows contain detection time.
 *
 * @param candidateId - Id assigned to the pending candidate
 * @param contact - Detected contact delta including `detectedAt`
 * @param events - User calendar events to search for overlap
 * @returns Ranked matches; rank 1 is the preferred event guess for consent prompts
 */
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
