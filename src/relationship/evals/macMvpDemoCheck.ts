import { createInterpretedRelationshipAgent } from "../interpretedAgent";
import { createOnboardingStateController } from "../onboardingState";
import { createRuleBasedInterpreter } from "../openAIInterpreter";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import { fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent, fixtureUser } from "../fixtures";
import { buildCandidateReviewPrompt } from "../agentCore";
import type { InboundAgentMessage } from "../types";

/** Scripted Mac MVP transcript lines plus whether onboarding, save, recall, and update succeeded. */
export type MacMvpDemoCheckReport = {
  ok: boolean;
  lines: string[];
};

/** Runs the deterministic Mac-only MVP demo path without live Spectrum, Contacts, or Calendar. */
export async function runMacMvpDemoCheck(): Promise<MacMvpDemoCheckReport> {
  const repo = createRelationshipRepository({
    users: [fixtureUser],
    calendarEvents: [fixtureLongEvent, fixtureShortEvent]
  });
  const tools = createRelationshipTools(repo);
  const onboarding = createOnboardingStateController("ready_pending_user_start");
  const agent = createInterpretedRelationshipAgent({
    repo,
    tools,
    onboarding,
    interpreter: createRuleBasedInterpreter(),
    strictMode: false,
    now: () => "2026-05-22T12:00:00.000Z",
    timezone: "America/Los_Angeles"
  });
  const lines = ["phone verified (mock)"];

  const start = await agent.handleMessage(message("start", "2026-05-22T12:00:00.000Z"));
  lines.push(start.outbound.text);

  const candidate = tools.create_contact_candidate(fixtureDetectedContact);
  const eventMatch = repo.listEventMatches(candidate.id)[0];
  lines.push(buildCandidateReviewPrompt(candidate.displayName, eventMatch?.eventTitle));

  const save = await agent.handleMessage(message("yes, building recruiting agents and played piano after dinner"));
  lines.push(save.outbound.text);

  const recall = await agent.handleMessage(message("Who was building recruiting agents?", "2026-05-22T12:05:00.000Z"));
  lines.push(recall.outbound.text.replace(/^I think that was/, "That was"));

  const update = await agent.handleMessage(
    message("Actually she was working on hiring workflows, not recruiting agents", "2026-05-22T12:06:00.000Z")
  );
  lines.push(update.outbound.text);
  const updateConfirmation = await agent.handleMessage(message("yes", "2026-05-22T12:06:30.000Z"));
  lines.push(updateConfirmation.outbound.text);

  const ok =
    onboarding.getState() === "active" &&
    repo.listMemories(fixtureUser.id).length === 1 &&
    repo.listMemories(fixtureUser.id)[0].contextNote.includes("hiring workflows") &&
    lines.some((line) => line.includes("I noticed you added Maya")) &&
    lines.some((line) => line.includes("saved Maya")) &&
    lines.some((line) => line.includes("That was Maya")) &&
    lines.some((line) => line.includes("updated Maya"));

  return { ok, lines };
}

/** CLI entry for `npm run check:mac-mvp-demo`. */
export async function main(): Promise<void> {
  const report = await runMacMvpDemoCheck();
  for (const line of report.lines) {
    console.info(line);
  }
  if (!report.ok) {
    process.exitCode = 1;
  }
}

function message(text: string, receivedAt = "2026-05-22T12:01:00.000Z"): InboundAgentMessage {
  return {
    userId: fixtureUser.id,
    platform: "terminal",
    text,
    receivedAt
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
