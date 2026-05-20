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
