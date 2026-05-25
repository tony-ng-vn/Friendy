/**
 * One-shot CLI to re-prompt ignored contacts on the live SQLite store after `start`.
 * Use when sensor replay left contacts ignored but intake should resume.
 */
import { loadFriendyEnv } from "../env";
import { resolveConfiguredUserId } from "../identity";
import { createOnboardingStateController } from "../onboardingState";
import { createSqliteRelationshipRepository, createSqliteRuntimeStateStore } from "../sqliteRepository";
import { createFriendySensorRuntime } from "./friendyRuntime";
import { createRuntimePromptSender, resolveFriendyRuntimeConfig } from "./friendyRuntimeCli";

export async function runFriendyIgnoredReintake(cwd = process.cwd(), env = process.env): Promise<void> {
  loadFriendyEnv();
  const config = resolveFriendyRuntimeConfig({ cwd, env });
  if (config.runtimeStore !== "sqlite") {
    throw new Error("friendy:reintake-ignored requires FRIENDY_RUNTIME_STORE=sqlite");
  }

  const userId = resolveConfiguredUserId(env, "local_friendy_user") ?? "local_friendy_user";
  const repo = createSqliteRelationshipRepository({ path: config.sqlitePath });
  const state = createSqliteRuntimeStateStore({ path: config.sqlitePath });
  const logger = console;
  const onboarding = createOnboardingStateController("ready_pending_user_start");
  onboarding.applyControl("started");

  const sender = await createRuntimePromptSender({
    env,
    sensorMode: config.sensor.mode,
    logger
  });

  const runtime = createFriendySensorRuntime({
    userId,
    repo,
    state,
    sender,
    ackWriter: {
      async writeAck(path: string) {
        const { mkdirSync, writeFileSync } = await import("node:fs");
        const { dirname, isAbsolute, resolve } = await import("node:path");
        const ackPath = isAbsolute(path) ? path : resolve(cwd, path);
        mkdirSync(dirname(ackPath), { recursive: true });
        writeFileSync(ackPath, new Date().toISOString());
      }
    },
    logger,
    sqlitePath: config.sqlitePath,
    getOnboardingState: () => onboarding.getState(),
    getContactIntakeStartedAt: () => onboarding.getContactIntakeStartedAt()
  });

  const lookbackIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const eligibleBefore = repo.listIgnoredCandidateIdsForReintake(userId, {
    sensorActivitySince: lookbackIso
  });

  console.info(`[friendy:reintake] db=${config.sqlitePath} user=${userId} eligible=${eligibleBefore.length}`);
  await runtime.requeueDeferredReintakeCandidatesOnStart();

  const pending = repo.listPendingCandidates(userId);
  console.info(
    `[friendy:reintake] done pending=${pending.length}`,
    pending.map((candidate) => `${candidate.displayName}:${candidate.status}`).join(", ") || "(none)"
  );

  repo.close();
  state.close();
}

async function main(): Promise<void> {
  await runFriendyIgnoredReintake();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
