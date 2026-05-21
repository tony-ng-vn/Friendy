import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { loadFriendyEnv, readSpectrumCredentials } from "../env";
import { resolveConfiguredUserId } from "../identity";
import { createRuntimeRelationshipRepository } from "../runtimeRepository";
import type { CalendarEvent, User } from "../types";
import type { ContactSnapshot } from "./contactSnapshot";
import type { CalendarEventProvider } from "./ingestionPipeline";
import { createMockLocalCheckScenario, type LocalPromptSender, runLocalContactCalendarCheck } from "./localCheck";
import { readMacCalendarEvents, readMacContactsSnapshot } from "./localMacAdapters";

type LocalCheckArgs = {
  mock: boolean;
  stateFile: string;
  userId: string;
};

async function main() {
  loadFriendyEnv();
  const args = parseArgs(process.argv.slice(2), process.env);
  const sender = await maybeCreateLiveSender(process.env);
  const result = args.mock ? await runMockLocalCheck(args, sender) : await runRealLocalCheck(args, sender);

  console.log(result.lines.join("\n"));
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): LocalCheckArgs {
  const stateFile = valueAfter(argv, "--state-file") ?? resolve(process.cwd(), ".friendy/local-contact-snapshot.json");
  return {
    mock: argv.includes("--mock"),
    stateFile,
    userId: resolveConfiguredUserId(env, "user_local") ?? "user_local"
  };
}

async function runMockLocalCheck(args: LocalCheckArgs, sender?: LocalPromptSender) {
  const scenario = createMockLocalCheckScenario(args.userId);
  const repo =
    process.env.FRIENDY_RUNTIME_STORE === "sqlite"
      ? createRuntimeRelationshipRepository({
          env: process.env,
          seed: { users: [localUser(scenario.after)] }
        })
      : undefined;

  return runLocalContactCalendarCheck({ ...scenario, repo, sender, env: process.env });
}

async function runRealLocalCheck(args: LocalCheckArgs, sender?: LocalPromptSender) {
  const capturedAt = new Date().toISOString();
  const after = readMacContactsSnapshot({ userId: args.userId, capturedAt });
  if (!existsSync(args.stateFile)) {
    writeSnapshot(args.stateFile, after);
    return {
      candidates: [],
      eventMatchesByCandidate: {},
      lines: [
        `Baseline saved: ${args.stateFile}`,
        "Add a Friendy-<number> contact, then run npm run ingest:local:check again."
      ]
    };
  }

  const before = readSnapshot(args.stateFile);
  const calendarProvider = createAppleCalendarProvider(args.userId, capturedAt);
  const repo = createRuntimeRelationshipRepository({ seed: { users: [localUser(after)] } });
  const result = await runLocalContactCalendarCheck({ before, after, calendarProvider, repo, sender, env: process.env });
  writeSnapshot(args.stateFile, after);
  return result;
}

function createAppleCalendarProvider(userId: string, nowIso: string): CalendarEventProvider {
  const now = new Date(nowIso);
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - 2);
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + 1);
  const events = readMacCalendarEvents({
    userId,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString()
  });

  return {
    source: "apple_calendar",
    listEvents(requestedUserId: string): CalendarEvent[] {
      return requestedUserId === userId ? events : [];
    }
  };
}

async function maybeCreateLiveSender(env: NodeJS.ProcessEnv): Promise<LocalPromptSender | undefined> {
  if (env.FRIENDY_LOCAL_CHECK_SEND !== "1") {
    return undefined;
  }

  const toPhone = env.FRIENDY_LOCAL_CHECK_TO_PHONE || env.FRIENDY_OWNER_PHONE;
  if (!toPhone) {
    throw new Error("FRIENDY_LOCAL_CHECK_SEND=1 requires FRIENDY_LOCAL_CHECK_TO_PHONE or FRIENDY_OWNER_PHONE.");
  }

  const { projectId, projectSecret } = readSpectrumCredentials(env);
  const app = await Spectrum({
    projectId,
    projectSecret,
    providers: [imessage.config()]
  });
  const im = imessage(app);
  const user = await im.user(toPhone);
  const space = await im.space(user);

  return {
    async sendPrompt(payload) {
      await space.send(payload.text);
    }
  };
}

function readSnapshot(path: string): ContactSnapshot {
  return JSON.parse(readFileSync(path, "utf8")) as ContactSnapshot;
}

function writeSnapshot(path: string, snapshot: ContactSnapshot): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function localUser(snapshot: ContactSnapshot): User {
  return {
    id: snapshot.userId,
    phoneNumber: "",
    displayName: "Local Friendy User",
    createdAt: snapshot.capturedAt
  };
}

function valueAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (os.platform() !== "darwin") {
    console.error("Use npm run ingest:local:check -- --mock for deterministic local verification off macOS.");
  }
  process.exit(1);
});
