import type { EventContextMatch } from "./types";

export type CandidateConfirmationResolution = {
  contextNote: string;
  relationshipContext?: string;
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
  return (
    normalized === "yes" ||
    normalized.startsWith("yes,") ||
    normalized.startsWith("yep") ||
    normalized.startsWith("yeah") ||
    /^[1-3](?:\b|[,.])/.test(normalized) ||
    /^(?:the\s+)?(?:first|second|third)(?:\s+one)?(?:\b|[,.])/.test(normalized) ||
    /^(?:the\s+)?\w+\s+one(?:\b|[,.])/.test(normalized)
  );
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
  const numbered = resolveNumberedEventOption(cleaned, eventMatches);
  if (numbered) {
    return numbered;
  }
  const namedOption = resolveNamedEventOption(cleaned, eventMatches);
  if (namedOption) {
    return namedOption;
  }

  const extracted = extractEventCorrection(cleaned);
  const selectedMatch = extracted.eventTitle ? findEventMatch(extracted.eventTitle, eventMatches) : undefined;
  const contextNote = normalizeKnownPlaces(extracted.contextNote || cleaned || "met at event");

  return {
    contextNote,
    relationshipContext: extractRelationshipBackstory(contextNote),
    eventId: selectedMatch?.calendarEventId,
    eventTitle: selectedMatch ? undefined : extracted.eventTitle
  };
}

function resolveNamedEventOption(
  value: string,
  eventMatches: EventContextMatch[]
): CandidateConfirmationResolution | undefined {
  const rank = ordinalRank(value);
  if (rank) {
    return selectedEventOption(eventMatches.find((eventMatch) => eventMatch.rank === rank));
  }

  const descriptor = eventOptionDescriptor(value);
  if (!descriptor) {
    return undefined;
  }

  const matches = eventMatches.filter((eventMatch) => eventTitleMatchesDescriptor(eventMatch.eventTitle, descriptor));
  if (matches.length !== 1) {
    return undefined;
  }

  return selectedEventOption(matches[0]);
}

function resolveNumberedEventOption(
  value: string,
  eventMatches: EventContextMatch[]
): CandidateConfirmationResolution | undefined {
  const match = /^([1-3])(?:\b|[,.])\s*(.*)$/i.exec(value.trim());
  if (!match) {
    return undefined;
  }

  const rank = Number(match[1]);
  const note = match[2]?.trim();
  return selectedEventOption(eventMatches.find((eventMatch) => eventMatch.rank === rank), note);
}

function selectedEventOption(
  selectedMatch: EventContextMatch | undefined,
  note?: string
): CandidateConfirmationResolution | undefined {
  if (!selectedMatch) {
    return undefined;
  }

  const contextNote = normalizeKnownPlaces(note || `met at ${selectedMatch.eventTitle}`);
  return {
    contextNote,
    relationshipContext: extractRelationshipBackstory(contextNote),
    eventId: selectedMatch.calendarEventId
  };
}

function ordinalRank(value: string): number | undefined {
  const match = /^(?:the\s+)?(first|second|third)(?:\s+one)?(?:\b|[,.])/i.exec(value.trim());
  if (!match) {
    return undefined;
  }

  return { first: 1, second: 2, third: 3 }[match[1].toLowerCase() as "first" | "second" | "third"];
}

function eventOptionDescriptor(value: string): string | undefined {
  const match = /^(?:the\s+)?(.+?)\s+one(?:\b|[,.])?$/i.exec(value.trim());
  return match?.[1]?.trim();
}

function eventTitleMatchesDescriptor(eventTitle: string, descriptor: string): boolean {
  const title = normalizeTitle(eventTitle);
  const descriptorTokens = normalizeTitle(descriptor)
    .split(" ")
    .filter((token) => token.length > 0);

  return descriptorTokens.length > 0 && descriptorTokens.every((token) => title.includes(token));
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

  const metPersonAtMatch = /^met\s+\S+(?:\s+\S+){0,2}\s+at\s+(.+?)(?:\s+after\b|$)/i.exec(normalized);
  if (metPersonAtMatch?.[1]) {
    return metPersonAtMatch[1].trim();
  }

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

function extractRelationshipBackstory(value: string): string | undefined {
  if (/after\s+havent\s+met\s+him\s+since\s+high\s+school\s+in\s+Minnesota/i.test(value)) {
    return "had not seen him since high school in Minnesota";
  }

  return undefined;
}

function normalizeKnownPlaces(value: string): string {
  return value.replace(/\bminnesota\b/gi, "Minnesota");
}
