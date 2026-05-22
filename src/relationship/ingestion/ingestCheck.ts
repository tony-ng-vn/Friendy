/**
 * Deterministic fixture ingestion check for `npm run ingest:check`.
 *
 * Uses fixture snapshots and calendar events only; never reads real macOS Contacts or calendars.
 */
import { fixtureLongEvent, fixtureShortEvent, fixtureUser } from "../fixtures";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import { fixtureAfterContactSnapshot, fixtureBeforeContactSnapshot } from "./contactSnapshot";
import { createFixtureCalendarEventProvider, ingestContactSnapshotDiff } from "./ingestionPipeline";

const repo = createRelationshipRepository({ users: [fixtureUser] });
const tools = createRelationshipTools(repo);
const calendarProvider = createFixtureCalendarEventProvider([fixtureLongEvent, fixtureShortEvent]);

const result = ingestContactSnapshotDiff({
  before: fixtureBeforeContactSnapshot,
  after: fixtureAfterContactSnapshot,
  calendarProvider,
  tools
});

console.log(result.summaryLines.join("\n"));
