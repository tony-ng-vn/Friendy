import type { EventContextMatch } from "./types";

export type CandidateConfirmationResolution = {
  contextNote: string;
  eventId?: string;
  eventTitle?: string;
};

/**
 * Detects lightweight approval replies before routing through search or manual capture.
 *
 * This remains deterministic because pending-contact confirmation is a consent action; the agent
 * should not need an LLM to decide that a direct "yes" is approving the queued candidate.
 */
export function isConfirmationReply(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "yes" || normalized.startsWith("yes,") || normalized.startsWith("yep") || normalized.startsWith("yeah");
}

/**
 * Converts a natural confirmation into the event correction and note used for memory creation.
 *
 * Event correction is intentionally conservative: exact event-title matches win before substring
 * matches so "Photon Residency" does not accidentally keep the more specific dinner guess.
 */
export function resolveCandidateConfirmation(
  value: string,
  eventMatches: EventContextMatch[]
): CandidateConfirmationResolution {
  const cleaned = cleanConfirmationNote(value);
  const extracted = extractEventCorrection(cleaned);
  const selectedMatch = extracted.eventTitle ? findEventMatch(extracted.eventTitle, eventMatches) : undefined;

  return {
    contextNote: extracted.contextNote || cleaned || "met at event",
    eventId: selectedMatch?.calendarEventId,
    eventTitle: selectedMatch ? undefined : extracted.eventTitle
  };
}

export function cleanConfirmationNote(value: string): string {
  return value.replace(/^(yes|yep|yeah)\s*,?\s*/i, "").trim() || "met at event";
}

function extractEventCorrection(value: string): { eventTitle?: string; contextNote: string } {
  const [firstSegment, ...restSegments] = value.split(",");
  const eventTitle = parseEventTitle(firstSegment);

  if (!eventTitle) {
    return { contextNote: value };
  }

  return {
    eventTitle,
    contextNote: restSegments.join(",").trim()
  };
}

function parseEventTitle(value: string): string | undefined {
  const normalized = value
    .trim()
    .replace(/^(actually|it was|it is|i think|maybe)\s+/i, "")
    .replace(/^i\s+/i, "");

  const match = /^(?:met\s+)?(?:them\s+)?(?:at|during|from)\s+(.+)$/i.exec(normalized);
  return match?.[1]?.trim();
}

function findEventMatch(eventTitle: string, eventMatches: EventContextMatch[]): EventContextMatch | undefined {
  const normalizedTitle = normalizeTitle(eventTitle);
  const byExactTitle = eventMatches.find((match) => normalizeTitle(match.eventTitle) === normalizedTitle);
  if (byExactTitle) {
    return byExactTitle;
  }

  return [...eventMatches]
    .filter((match) => normalizeTitle(match.eventTitle).includes(normalizedTitle))
    .sort((a, b) => a.rank - b.rank)[0];
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
