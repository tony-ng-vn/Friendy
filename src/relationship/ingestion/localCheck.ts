import { buildCandidateReviewPrompt } from "../agentCore";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import type { ContactCandidate, EventContextMatch, User } from "../types";
import type { ContactSnapshot } from "./contactSnapshot";
import type { CalendarEventProvider } from "./ingestionPipeline";
import { ingestContactSnapshotDiff } from "./ingestionPipeline";

export type LocalPromptPayload = {
  userId: string;
  candidateId: string;
  text: string;
};

export type LocalPromptSender = {
  sendPrompt(payload: LocalPromptPayload): Promise<void> | void;
};

export type RunLocalContactCalendarCheckInput = {
  before: ContactSnapshot;
  after: ContactSnapshot;
  calendarProvider: CalendarEventProvider;
  sender?: LocalPromptSender;
  env?: Partial<Pick<NodeJS.ProcessEnv, "FRIENDY_LOCAL_CHECK_SEND">>;
};

export type LocalContactCalendarCheckResult = {
  candidates: ContactCandidate[];
  eventMatchesByCandidate: Record<string, EventContextMatch[]>;
  lines: string[];
};

/** Runs one explicit local check from contact snapshots into Friendy's existing candidate queue. */
export async function runLocalContactCalendarCheck({
  before,
  after,
  calendarProvider,
  sender,
  env = process.env
}: RunLocalContactCalendarCheckInput): Promise<LocalContactCalendarCheckResult> {
  const repo = createRelationshipRepository({ users: [localUser(after)] });
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
    for (const payload of promptPayloads) {
      await sender.sendPrompt(payload);
    }
    lines.push(`Live send: sent ${promptPayloads.length} ${promptPayloads.length === 1 ? "prompt" : "prompts"}`);
  } else {
    lines.push("Live send: skipped (dry run)");
  }

  return {
    candidates: ingestion.candidates,
    eventMatchesByCandidate: ingestion.eventMatchesByCandidate,
    lines
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
