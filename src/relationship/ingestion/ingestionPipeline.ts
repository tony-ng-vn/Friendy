import type { createRelationshipTools } from "../tools";
import type { CalendarEvent, ContactCandidate, ContactCandidateDetected, EventContextMatch } from "../types";
import type { ContactSnapshot } from "./contactSnapshot";
import { detectNewContactMethods } from "./contactSnapshot";

type RelationshipTools = ReturnType<typeof createRelationshipTools>;

export type CalendarEventProvider = {
  source: "fixture" | "apple_calendar";
  listEvents(userId: string): CalendarEvent[];
};

export type IngestContactSnapshotDiffInput = {
  before: ContactSnapshot;
  after: ContactSnapshot;
  calendarProvider: CalendarEventProvider;
  tools: RelationshipTools;
};

export type IngestContactSnapshotDiffResult = {
  detectedContacts: ContactCandidateDetected[];
  candidates: ContactCandidate[];
  eventMatchesByCandidate: Record<string, EventContextMatch[]>;
  summaryLines: string[];
};

/** Fixture-only calendar provider used by the ingestion prototype. */
export function createFixtureCalendarEventProvider(events: CalendarEvent[]): CalendarEventProvider {
  return {
    source: "fixture",
    listEvents(userId: string) {
      return events.filter((event) => event.userId === userId);
    }
  };
}

/**
 * Runs the safe ingestion prototype from snapshots into the existing candidate queue.
 *
 * The provider is synced into the repository before candidates are created because event matching
 * intentionally happens inside the repository boundary used by the agent tools.
 */
export function ingestContactSnapshotDiff({
  before,
  after,
  calendarProvider,
  tools
}: IngestContactSnapshotDiffInput): IngestContactSnapshotDiffResult {
  const events = calendarProvider.listEvents(after.userId);
  tools.sync_calendar_events(after.userId, events);

  const detectedContacts = detectNewContactMethods(before, after);
  const candidates = detectedContacts.map((contact) => tools.create_contact_candidate(contact));
  const eventMatchesByCandidate = Object.fromEntries(
    candidates.map((candidate) => [candidate.id, tools.list_candidate_event_matches(after.userId, candidate.id)])
  );

  return {
    detectedContacts,
    candidates,
    eventMatchesByCandidate,
    summaryLines: buildSummaryLines(detectedContacts, candidates, eventMatchesByCandidate, tools, after.userId)
  };
}

function buildSummaryLines(
  detectedContacts: ContactCandidateDetected[],
  candidates: ContactCandidate[],
  eventMatchesByCandidate: Record<string, EventContextMatch[]>,
  tools: RelationshipTools,
  userId: string
): string[] {
  const lines = [`Detected contacts: ${detectedContacts.map((contact) => contact.displayName).join(", ") || "none"}`];

  for (const candidate of candidates) {
    const matches = eventMatchesByCandidate[candidate.id] ?? [];
    lines.push(`Candidate ${candidate.id}: ${candidate.displayName}`);
    lines.push(
      `Event guesses: ${
        matches.length > 0 ? matches.map((match) => `${match.rank}. ${match.eventTitle}`).join(" | ") : "none"
      }`
    );
  }

  lines.push(`Pending queue: ${tools.list_pending_candidates(userId).map((candidate) => candidate.displayName).join(", ") || "none"}`);
  return lines;
}
