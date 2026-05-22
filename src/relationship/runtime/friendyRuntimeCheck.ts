/**
 * End-to-end smoke test for the Friendy sensor runtime without macOS APIs.
 *
 * Feeds fake NDJSON events through SQLite-backed runtime state, asserts that one
 * pending candidate is created, a calendar-aware prompt is sent, and the history
 * batch ack path is written. Used by `npm run check:friendy-runtime`.
 */
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
  replayedUnackedBatchAcked: boolean;
  lines: string[];
};

export type FriendyRuntimeCheckInput = {
  cwd?: string;
  now?: () => string;
};

/** Runs the runtime smoke check in a temporary SQLite directory and returns pass/fail details. */
export async function runFriendyRuntimeCheck({
  cwd = process.cwd(),
  now = () => "2026-05-22T00:00:00.000Z"
}: FriendyRuntimeCheckInput = {}): Promise<FriendyRuntimeCheckReport> {
  const tempRoot = join(cwd, ".friendy-runtime-check");
  mkdirSync(tempRoot, { recursive: true });
  const tempDir = mkdtempSync(join(tempRoot, "run-"));
  const sqlitePath = join(tempDir, "friendy.sqlite");
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
    const events = createFakeMacosSensorEvents({ mode: "contact_added", now: now() });
    const [readyEvent, contactEvent, batchEvent] = events;
    if (!readyEvent || !contactEvent || !batchEvent) {
      throw new Error("Fake macOS sensor did not emit the expected contact batch sequence.");
    }

    await withRuntime({ sqlitePath, ackPaths, lines, sender, now }, async (runtime) => {
      await runtime.processLine(JSON.stringify(readyEvent));
      await runtime.processLine(JSON.stringify(contactEvent));
    });

    let candidateCount = 0;
    await withRuntime({ sqlitePath, ackPaths, lines, sender, now }, async (runtime, repo) => {
      await runtime.processLine(JSON.stringify(contactEvent));
      await runtime.processLine(JSON.stringify(batchEvent));
      candidateCount = repo.listPendingCandidates("local_friendy_user").length;
    });

    const replayedUnackedBatchAcked =
      candidateCount === 1 &&
      promptTexts.length === 1 &&
      ackPaths.some((path) => path.includes("history_batch_mock_1.ack"));
    const ok =
      candidateCount === 1 &&
      promptTexts.some((text) => text.includes("Photon Residency Dinner")) &&
      replayedUnackedBatchAcked;

    if (replayedUnackedBatchAcked) {
      lines.push("Replayed unacked history batch: acked without duplicate prompt");
    }
    lines.push(ok ? "Friendy runtime check passed" : "Friendy runtime check failed");

    return {
      ok,
      candidateCount,
      promptTexts,
      ackPaths,
      replayedUnackedBatchAcked,
      lines
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    try {
      rmdirSync(tempRoot);
    } catch {
      // The root may be shared by concurrent checks; only the per-run directory is owned here.
    }
  }
}

async function withRuntime(
  {
    sqlitePath,
    ackPaths,
    lines,
    sender,
    now
  }: {
    sqlitePath: string;
    ackPaths: string[];
    lines: string[];
    sender: RuntimePromptSender;
    now: () => string;
  },
  callback: (
    runtime: ReturnType<typeof createFriendySensorRuntime>,
    repo: ReturnType<typeof createSqliteRelationshipRepository>
  ) => Promise<void>
): Promise<void> {
  const repo = createSqliteRelationshipRepository({ path: sqlitePath });
  const state = createSqliteRuntimeStateStore({ path: sqlitePath });
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

  try {
    await callback(runtime, repo);
  } finally {
    repo.close();
    state.close();
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
