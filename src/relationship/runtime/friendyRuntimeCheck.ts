import { mkdirSync, mkdtempSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createSqliteRelationshipRepository, createSqliteRuntimeStateStore } from "../sqliteRepository";
import { createFakeMacosSensorEvents } from "./fakeMacosSensor";
import { createFriendySensorRuntime, type RuntimePromptSender } from "./friendyRuntime";

export type FriendyRuntimeCheckReport = {
  ok: boolean;
  candidateCount: number;
  promptTexts: string[];
  ackPaths: string[];
  lines: string[];
};

export type FriendyRuntimeCheckInput = {
  cwd?: string;
  now?: () => string;
};

export async function runFriendyRuntimeCheck({
  cwd = process.cwd(),
  now = () => "2026-05-22T00:00:00.000Z"
}: FriendyRuntimeCheckInput = {}): Promise<FriendyRuntimeCheckReport> {
  const tempRoot = join(cwd, ".friendy-runtime-check");
  mkdirSync(tempRoot, { recursive: true });
  const tempDir = mkdtempSync(join(tempRoot, "run-"));
  const sqlitePath = join(tempDir, "friendy.sqlite");
  const repo = createSqliteRelationshipRepository({ path: sqlitePath });
  const state = createSqliteRuntimeStateStore({ path: sqlitePath });
  const promptTexts: string[] = [];
  const ackPaths: string[] = [];
  const lines = ["Friendy foreground runtime check", `SQLite runtime: ${sqlitePath}`];
  const sender: RuntimePromptSender = {
    async sendPrompt(input) {
      promptTexts.push(input.text);
      return { interactionId: "runtime_check_prompt_1" };
    }
  };

  try {
    const runtime = createFriendySensorRuntime({
      userId: "local_friendy_user",
      repo,
      state,
      sender,
      ackWriter: {
        async writeAck(path) {
          ackPaths.push(path);
        }
      },
      logger: {
        info(message) {
          lines.push(message);
        },
        warn(message) {
          lines.push(message);
        },
        error(message) {
          lines.push(message);
        }
      },
      now
    });

    for (const event of createFakeMacosSensorEvents({ mode: "contact_added", now: now() })) {
      await runtime.processLine(JSON.stringify(event));
    }

    const candidates = repo.listPendingCandidates("local_friendy_user");
    const ok =
      candidates.length === 1 &&
      promptTexts.some((text) => text.includes("Photon Residency Dinner")) &&
      ackPaths.some((path) => path.includes("history_batch_mock_1.ack"));

    lines.push(ok ? "Friendy runtime check passed" : "Friendy runtime check failed");

    return {
      ok,
      candidateCount: candidates.length,
      promptTexts,
      ackPaths,
      lines
    };
  } finally {
    repo.close();
    state.close();
    rmSync(tempDir, { recursive: true, force: true });
    try {
      rmdirSync(tempRoot);
    } catch {
      // The root may be shared by concurrent checks; only the per-run directory is owned here.
    }
  }
}

export async function main(): Promise<void> {
  const report = await runFriendyRuntimeCheck();
  for (const line of report.lines) {
    console.info(line);
  }
  if (!report.ok) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
