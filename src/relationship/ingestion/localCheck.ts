/**
 * Explicit local contact/calendar check orchestration.
 *
 * Composes snapshot diffing, event matching, and optional prompt delivery for one-off CLI runs.
 * Prompt wording comes from `buildCandidateReviewPrompt` here; the durable runtime sensor path
 * uses `runtime/promptPlanner` instead. Neither path reads real macOS APIs unless the caller
 * supplies live snapshots from `localCheckCli`.
 */
import { buildCandidateReviewPrompt } from "../agentCore";
import { fixtureUser } from "../fixtures";
import { createRelationshipRepository, type RelationshipRepository } from "../repository";
import { createRuntimeRelationshipRepository } from "../runtimeRepository";
import { createRelationshipTools } from "../tools";
import type { CalendarEvent, ContactCandidate, EventContextMatch, User } from "../types";
import type { ContactSnapshot } from "./contactSnapshot";
import type { CalendarEventProvider } from "./ingestionPipeline";
import { createFixtureCalendarEventProvider, ingestContactSnapshotDiff } from "./ingestionPipeline";

/** Outbound review prompt payload for a queued contact candidate. */
export type LocalPromptPayload = {
  userId: string;
  candidateId: string;
  text: string;
};

/** Injectable sender used when live prompt delivery is explicitly enabled. */
export type LocalPromptSender = {
  sendPrompt(payload: LocalPromptPayload): Promise<void> | void;
};

/** Input for running one local check from before/after snapshots. */
export type RunLocalContactCalendarCheckInput = {
  before: ContactSnapshot;
  after: ContactSnapshot;
  calendarProvider: CalendarEventProvider;
  repo?: RelationshipRepository;
  sender?: LocalPromptSender;
  env?: Partial<Pick<NodeJS.ProcessEnv, "FRIENDY_LOCAL_CHECK_SEND">>;
};

/** Queued candidates, event guesses, and narrated CLI output lines. */
export type LocalContactCalendarCheckResult = {
  candidates: ContactCandidate[];
  eventMatchesByCandidate: Record<string, EventContextMatch[]>;
  lines: string[];
};

/** Deterministic before/after snapshots and calendar fixture for `--mock` runs. */
export type MockLocalCheckScenario = {
  before: ContactSnapshot;
  after: ContactSnapshot;
  calendarProvider: CalendarEventProvider;
};

/** Resolves the relationship repository for explicit local-check CLI runs. */
export function createLocalCheckRepository(
  snapshot: ContactSnapshot,
  env: Partial<NodeJS.ProcessEnv> = process.env
): RelationshipRepository {
  return createRuntimeRelationshipRepository({
    env,
    seed: { users: [localUser(snapshot)] }
  });
}

/**
 * Runs one explicit local check from contact snapshots into Friendy's existing candidate queue.
 *
 * Builds review prompts with `buildCandidateReviewPrompt`; the runtime sensor path uses
 * `runtime/promptPlanner` for the same product wording contract.
 */
export async function runLocalContactCalendarCheck({
  before,
  after,
  calendarProvider,
  repo: inputRepo,
  sender,
  env = process.env
}: RunLocalContactCalendarCheckInput): Promise<LocalContactCalendarCheckResult> {
  const repo = inputRepo ?? createRelationshipRepository({ users: [localUser(after)] });
  const tools = createRelationshipTools(repo);
  const ingestion = ingestContactSnapshotDiff({ before, after, calendarProvider, tools });
  const promptPayloads = ingestion.candidates.map((candidate) => {
    const bestMatch = ingestion.eventMatchesByCandidate[candidate.id]?.[0];
    return {
      userId: after.userId,
      candidateId: candidate.id,
      text: buildCandidateReviewPrompt(candidate.displayName, bestMatch?.eventTitle)
    };
  });

  const lines = [
    ...ingestion.summaryLines,
    ...promptPayloads.map((payload) => `Friendy -> User: ${payload.text}`)
  ];

  if (env.FRIENDY_LOCAL_CHECK_SEND === "1" && sender) {
    // Live iMessage delivery is opt-in; default runs stay dry and fixture-safe.
    for (const payload of promptPayloads) {
      await sender.sendPrompt(payload);
    }
    lines.push(`Live send: sent ${promptPayloads.length} ${promptPayloads.length === 1 ? "prompt" : "prompts"}`);
  } else if (env.FRIENDY_LOCAL_CHECK_SEND === "1") {
    lines.push("Live send: requested but no sender configured");
  } else {
    lines.push("Live send: skipped (dry run)");
  }

  return {
    candidates: ingestion.candidates,
    eventMatchesByCandidate: ingestion.eventMatchesByCandidate,
    lines
  };
}

/** Deterministic local-check scenario used when real macOS permissions are unavailable. */
export function createMockLocalCheckScenario(userId = fixtureUser.id): MockLocalCheckScenario {
  const before: ContactSnapshot = {
    userId,
    capturedAt: "2026-05-20T18:00:00.000Z",
    contacts: [
      {
        stableId: "contact_existing",
        displayName: "Existing Person",
        phoneNumbers: ["+15550100000"],
        emails: [],
        updatedAt: "2026-05-20T18:00:00.000Z"
      }
    ]
  };
  const after: ContactSnapshot = {
    userId,
    capturedAt: "2026-05-20T20:00:00.000Z",
    contacts: [
      ...before.contacts,
      {
        stableId: "contact_friendy_101",
        displayName: "Friendy-101",
        phoneNumbers: ["+1 (555) 010-0101"],
        emails: [],
        updatedAt: "2026-05-20T19:30:00.000Z"
      }
    ]
  };
  const event: CalendarEvent = {
    id: "event_photon_residency_dinner_local",
    userId,
    title: "Photon Residency Dinner",
    startsAt: "2026-05-20T19:00:00.000Z",
    endsAt: "2026-05-20T22:00:00.000Z",
    timezone: "America/Los_Angeles",
    location: "San Francisco",
    calendarSource: "simulated",
    eventKind: "short"
  };

  return {
    before,
    after,
    calendarProvider: createFixtureCalendarEventProvider([event])
  };
}

function localUser(snapshot: ContactSnapshot): User {
  return {
    id: snapshot.userId,
    phoneNumber: "",
    displayName: "Local Friendy User",
    createdAt: snapshot.capturedAt
  };
}
