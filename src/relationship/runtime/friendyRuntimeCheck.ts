/**
 * End-to-end smoke test for the Friendy sensor runtime without macOS APIs.
 *
 * Feeds fake NDJSON events through SQLite-backed runtime state, asserts that one
 * pending candidate is created, a calendar-aware prompt is sent, and the history
 * batch ack path is written. Used by `npm run check:friendy-runtime`.
 */
import { mkdirSync, mkdtempSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { OnboardingState } from "../onboardingState";
import { createSqliteRelationshipRepository, createSqliteRuntimeStateStore } from "../sqliteRepository";
import { createFakeMacosSensorEvents } from "./fakeMacosSensor";
import { createFriendySensorRuntime, type RuntimePromptSender } from "./friendyRuntime";

/** Pass/fail details from the SQLite-backed runtime smoke check. */
export type FriendyRuntimeCheckReport = {
  ok: boolean;
  candidateCount: number;
  promptTexts: string[];
  ackPaths: string[];
  startGateQueuedBeforeStart: boolean;
  replayedUnackedBatchAcked: boolean;
  lines: string[];
};

/** Optional cwd and clock override for deterministic CI runs. */
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
  let onboardingState: OnboardingState = "ready_pending_user_start";
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
    const activeContactEvent = contactEventWithIdentity(contactEvent, {
      eventId: "sensor_evt_mock_contact_2",
      stableId: "fixture-contact-2",
      idempotencyKey: "contacts:mac_mock:fixture-contact-2:add"
    });
    const activeBatchEvent = {
      ...batchEvent,
      contactEventIds: ["sensor_evt_mock_contact_2"]
    };

    let startGateQueuedBeforeStart = false;
    await withRuntime({ sqlitePath, ackPaths, lines, sender, getOnboardingState: () => onboardingState, now }, async (runtime, repo, state) => {
      await runtime.processLine(JSON.stringify(readyEvent));
      await runtime.processLine(JSON.stringify(contactEvent));
      const preStartProcessed = state.getProcessedEvent("contacts:mac_mock:fixture-contact-1:add");
      startGateQueuedBeforeStart =
        repo.listPendingCandidates("local_friendy_user").length === 1 &&
        promptTexts.length === 1 &&
        preStartProcessed?.status === "candidate_created";
    });

    onboardingState = "active";
    await withRuntime({ sqlitePath, ackPaths, lines, sender, getOnboardingState: () => onboardingState, now }, async (runtime) => {
      await runtime.processLine(JSON.stringify(activeContactEvent));
    });

    let candidateCount = 0;
    await withRuntime({ sqlitePath, ackPaths, lines, sender, getOnboardingState: () => onboardingState, now }, async (runtime, repo) => {
      await runtime.processLine(JSON.stringify(activeContactEvent));
      await runtime.processLine(JSON.stringify(activeBatchEvent));
      candidateCount = repo.listPendingCandidates("local_friendy_user").length;
    });

    const replayedUnackedBatchAcked =
      candidateCount === 2 &&
      promptTexts.length === 2 &&
      ackPaths.some((path) => path.includes("history_batch_mock_1.ack"));
    const ok =
      startGateQueuedBeforeStart &&
      candidateCount === 2 &&
      promptTexts.some((text) => text.includes("Photon Residency Dinner")) &&
      replayedUnackedBatchAcked;

    if (startGateQueuedBeforeStart) {
      lines.push("Start gate: queued contact event before user start");
    }
    if (replayedUnackedBatchAcked) {
      lines.push("Replayed unacked history batch: acked without duplicate prompt");
    }
    lines.push(ok ? "Friendy runtime check passed" : "Friendy runtime check failed");

    return {
      ok,
      candidateCount,
      promptTexts,
      ackPaths,
      startGateQueuedBeforeStart,
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

function contactEventWithIdentity(
  event: Record<string, unknown>,
  {
    eventId,
    stableId,
    idempotencyKey
  }: {
    eventId: string;
    stableId: string;
    idempotencyKey: string;
  }
): Record<string, unknown> {
  const contact = event.contact && typeof event.contact === "object" && !Array.isArray(event.contact)
    ? { ...(event.contact as Record<string, unknown>), stableId, unifiedStableId: stableId }
    : event.contact;
  return {
    ...event,
    eventId,
    idempotencyKey,
    contact
  };
}

async function withRuntime(
  {
    sqlitePath,
    ackPaths,
    lines,
    sender,
    getOnboardingState,
    now
  }: {
    sqlitePath: string;
    ackPaths: string[];
    lines: string[];
    sender: RuntimePromptSender;
    getOnboardingState: () => OnboardingState;
    now: () => string;
  },
  callback: (
    runtime: ReturnType<typeof createFriendySensorRuntime>,
    repo: ReturnType<typeof createSqliteRelationshipRepository>,
    state: ReturnType<typeof createSqliteRuntimeStateStore>
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
    getOnboardingState,
    now
  });

  try {
    await callback(runtime, repo, state);
  } finally {
    repo.close();
    state.close();
  }
}

/** CLI entrypoint for `npm run check:friendy-runtime`. */
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
