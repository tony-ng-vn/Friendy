import { createRuleBasedInterpreter } from "../openRouterInterpreter";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import type { CalendarEvent, RelationshipMemory } from "../types";
import { fixtureUser } from "../fixtures";
import type { ContactSnapshot } from "../ingestion/contactSnapshot";
import { createFixtureCalendarEventProvider, ingestContactSnapshotDiff } from "../ingestion/ingestionPipeline";
import { createSpectrumFriendyRuntime } from "./spectrumTransport";

const messyConfirmationReply =
  "yes, met abc at Photon Residency II after havent met him since high school in minnesota";
const laterSearch = "who did I run into from high school at Photon?";

export type ImessageContactConfirmationFlow = {
  lines: string[];
  memories: RelationshipMemory[];
  searchReply: string;
};

export async function runImessageContactConfirmationFlow(): Promise<ImessageContactConfirmationFlow> {
  const repo = createRelationshipRepository({ users: [fixtureUser] });
  const tools = createRelationshipTools(repo);
  const event = createPhotonResidencyEvent();
  const ingestion = ingestContactSnapshotDiff({
    before: createBeforeSnapshot(),
    after: createAfterSnapshot(),
    calendarProvider: createFixtureCalendarEventProvider([event]),
    tools
  });
  const candidate = ingestion.candidates[0];
  const eventGuess = ingestion.eventMatchesByCandidate[candidate.id][0];
  const runtime = createSpectrumFriendyRuntime({
    repo,
    tools,
    interpreter: createRuleBasedInterpreter(),
    now: () => "2026-05-20T12:00:00.000Z"
  });

  await runtime.handleInboundText({
    userId: fixtureUser.id,
    spaceId: "imessage_flow_space",
    text: messyConfirmationReply,
    receivedAt: "2026-05-20T12:00:00.000Z"
  });

  const search = await runtime.handleInboundText({
    userId: fixtureUser.id,
    spaceId: "imessage_flow_space",
    text: laterSearch,
    receivedAt: "2026-05-20T12:05:00.000Z"
  });

  const [memory] = repo.listMemories(fixtureUser.id);
  const lines = [
    `Detected contact: ${candidate.displayName}`,
    `Best event guess: ${eventGuess.eventTitle}`,
    `Friendy -> User: I noticed you added ${candidate.displayName} around ${eventGuess.eventTitle}. Did you meet them there?`,
    `User -> Friendy: ${messyConfirmationReply}`,
    `Saved memory: ${memory.displayName}`,
    `Event context: ${memory.eventTitle}`,
    `Relationship backstory: ${memory.relationshipContext}`,
    `User -> Friendy: ${laterSearch}`,
    `Friendy -> User: ${summarizeSearchReply(search.replyText)}`
  ];

  return {
    lines,
    memories: repo.listMemories(fixtureUser.id),
    searchReply: search.replyText
  };
}

function createPhotonResidencyEvent(): CalendarEvent {
  return {
    id: "event_photon_residency_ii",
    userId: fixtureUser.id,
    title: "Photon Residency II",
    startsAt: "2026-05-15T19:00:00-07:00",
    endsAt: "2026-05-15T22:00:00-07:00",
    timezone: "America/Los_Angeles",
    location: "San Francisco",
    calendarSource: "simulated",
    eventKind: "short"
  };
}

function createBeforeSnapshot(): ContactSnapshot {
  return {
    userId: fixtureUser.id,
    capturedAt: "2026-05-15T19:00:00-07:00",
    contacts: []
  };
}

function createAfterSnapshot(): ContactSnapshot {
  return {
    userId: fixtureUser.id,
    capturedAt: "2026-05-15T22:00:00-07:00",
    contacts: [
      {
        stableId: "contact_abc",
        displayName: "Abc",
        phoneNumbers: ["+15550101999"],
        emails: [],
        updatedAt: "2026-05-15T21:42:00-07:00"
      }
    ]
  };
}

function summarizeSearchReply(value: string): string {
  const sentence = value.split(".")[0]?.trim();
  return sentence || value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runImessageContactConfirmationFlow()
    .then((flow) => {
      console.log(flow.lines.join("\n"));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
