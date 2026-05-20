import { demoLongEvent, demoShortEvent, demoUser } from "../fixtures";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import { fixtureAfterContactSnapshot, fixtureBeforeContactSnapshot } from "./contactSnapshot";
import { createFixtureCalendarEventProvider, ingestContactSnapshotDiff } from "./ingestionPipeline";

const repo = createRelationshipRepository({ users: [demoUser] });
const tools = createRelationshipTools(repo);
const calendarProvider = createFixtureCalendarEventProvider([demoLongEvent, demoShortEvent]);

const result = ingestContactSnapshotDiff({
  before: fixtureBeforeContactSnapshot,
  after: fixtureAfterContactSnapshot,
  calendarProvider,
  tools
});

console.log(result.summaryLines.join("\n"));
