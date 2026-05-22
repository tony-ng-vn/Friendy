/**
 * Foreground Friendy runtime CLI composition.
 *
 * Environment variables:
 * - `FRIENDY_RUNTIME_STORE` — must be `sqlite` for shared local state
 * - `FRIENDY_SQLITE_PATH` — relationship and runtime SQLite file (default `.friendy/friendy.sqlite`)
 * - `FRIENDY_MACOS_SENSOR_STATE_DIR` — native sensor state root (default `.friendy/macos-sensor-state`)
 * - `FRIENDY_SENSOR_MOCK=1` — run `fakeMacosSensor.ts` via `tsx` instead of the compiled binary
 * - `FRIENDY_SENSOR_BINARY_PATH` — path to `friendy-macos-sensor` when mock is off
 * - `FRIENDY_PROMPT_TRANSPORT` — `console` or `spectrum` (defaults to console in mock mode)
 * - `FRIENDY_DISABLE_INBOUND_AGENT` / `FRIENDY_START_INBOUND_AGENT` — inbound Spectrum agent toggles
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { loadFriendyEnv } from "../env";
import { resolveConfiguredUserId } from "../identity";
import type { RelationshipRepository } from "../repository";
import { createSqliteRelationshipRepository, createSqliteRuntimeStateStore, type SqliteRelationshipRepository, type SqliteRuntimeStateStore } from "../sqliteRepository";
import { createFriendySensorRuntime, type RuntimeAckWriter, type RuntimeLogger, type RuntimePromptSender } from "./friendyRuntime";
import { startSensorProcess, type SensorRuntimeLineProcessor, type StartedSensorProcess } from "./sensorProcess";
import { createLiveSpectrumPromptSender } from "../transports/spectrumPromptSender";
import { startSpectrumFriendyAgent } from "../transports/spectrumTransport";

export type FriendyRuntimeConfigInput = {
  cwd?: string;
  env?: Partial<NodeJS.ProcessEnv>;
};

export type FriendySensorLaunchConfig =
  | {
      mode: "mock";
      command: "tsx";
      args: string[];
    }
  | {
      mode: "real";
      command: string;
      args: string[];
    };

/** Resolved local runtime paths and whether the sensor runs in mock or real mode. */
export type FriendyRuntimeConfig = {
  runtimeStore: "sqlite" | string;
  sqlitePath: string;
  sensorStateDir: string;
  sensor: FriendySensorLaunchConfig;
};

export type StartFriendyForegroundRuntimeInput = FriendyRuntimeConfigInput & {
  sender?: RuntimePromptSender;
  logger?: RuntimeLogger;
  startSensor?: (input: { launch: FriendySensorLaunchConfig; runtime: SensorRuntimeLineProcessor }) => StartedSensorProcess;
  startInboundAgent?: FriendyInboundAgentStarter;
  ackWriter?: RuntimeAckWriter;
};

export type RuntimePromptSenderWithKind = RuntimePromptSender & {
  kind: "console" | "spectrum";
};

export type StartedFriendyForegroundRuntime = {
  config: FriendyRuntimeConfig;
  repo: SqliteRelationshipRepository;
  state: SqliteRuntimeStateStore;
  sensor: StartedSensorProcess;
  inboundAgent?: StartedInboundAgent;
  close(): void;
};

export type StartedInboundAgent = {
  close?(): void;
} | void;

export type FriendyInboundAgentStarter = (input: {
  repo: RelationshipRepository;
  userId: string;
  env: Partial<NodeJS.ProcessEnv>;
  logger: RuntimeLogger;
}) => StartedInboundAgent;

/**
 * Resolves the foreground Friendy runtime config without starting Spectrum or a sensor process.
 *
 * Mock mode (`FRIENDY_SENSOR_MOCK=1`) launches the TypeScript fake sensor; real mode requires
 * a built binary at `FRIENDY_SENSOR_BINARY_PATH` or `bin/friendy-macos-sensor`.
 */
export function resolveFriendyRuntimeConfig({
  cwd = process.cwd(),
  env = process.env
}: FriendyRuntimeConfigInput = {}): FriendyRuntimeConfig {
  const runtimeStore = env.FRIENDY_RUNTIME_STORE || "sqlite";
  const sqlitePath = resolve(cwd, env.FRIENDY_SQLITE_PATH || ".friendy/friendy.sqlite");
  const sensorStateDir = resolve(cwd, env.FRIENDY_MACOS_SENSOR_STATE_DIR || ".friendy/macos-sensor-state");

  return {
    runtimeStore,
    sqlitePath,
    sensorStateDir,
    sensor: resolveSensorLaunchConfig({ cwd, env, sensorStateDir })
  };
}

/** Starts the foreground Friendy runtime pieces that are safe to compose without real macOS APIs. */
export async function startFriendyForegroundRuntime({
  cwd = process.cwd(),
  env = process.env,
  sender,
  logger = console,
  ackWriter = createFileAckWriter(cwd),
  startSensor = defaultStartSensor,
  startInboundAgent = defaultStartInboundAgent
}: StartFriendyForegroundRuntimeInput = {}): Promise<StartedFriendyForegroundRuntime> {
  const config = resolveFriendyRuntimeConfig({ cwd, env });
  if (config.runtimeStore !== "sqlite") {
    throw new Error("agent:friendy requires FRIENDY_RUNTIME_STORE=sqlite for shared local runtime state.");
  }
  warnIfRuntimePathIsCloudSynced(config, logger);

  const userId = resolveConfiguredUserId(env, "local_friendy_user") ?? "local_friendy_user";
  const repo = createSqliteRelationshipRepository({ path: config.sqlitePath });
  const state = createSqliteRuntimeStateStore({ path: config.sqlitePath });
  const promptSender = sender ?? (await createRuntimePromptSender({ env, sensorMode: config.sensor.mode, logger }));
  const runtime = createFriendySensorRuntime({
    userId,
    repo,
    state,
    sender: promptSender,
    ackWriter,
    logger
  });
  const inboundAgent = shouldStartInboundAgent(config, env)
    ? startInboundAgent({ repo, userId, env, logger })
    : undefined;
  const sensor = startSensor({ launch: config.sensor, runtime });

  return {
    config,
    repo,
    state,
    sensor,
    inboundAgent,
    close() {
      inboundAgent?.close?.();
      repo.close();
      state.close();
    }
  };
}

/** Selects console or Spectrum prompt delivery from env and sensor mode. */
export async function createRuntimePromptSender({
  env = process.env,
  sensorMode,
  logger = console
}: {
  env?: Partial<NodeJS.ProcessEnv>;
  sensorMode: FriendySensorLaunchConfig["mode"];
  logger?: RuntimeLogger;
}): Promise<RuntimePromptSenderWithKind> {
  const mode = env.FRIENDY_PROMPT_TRANSPORT || (sensorMode === "mock" ? "console" : "spectrum");

  if (mode === "console") {
    return createConsolePromptSender();
  }

  if (mode === "spectrum") {
    logger.info("[friendy:prompt_transport] spectrum");
    return createLiveSpectrumPromptSender({ env });
  }

  throw new Error(`Unknown FRIENDY_PROMPT_TRANSPORT: ${mode}`);
}

function resolveSensorLaunchConfig({
  cwd,
  env,
  sensorStateDir
}: {
  cwd: string;
  env: Partial<NodeJS.ProcessEnv>;
  sensorStateDir: string;
}): FriendySensorLaunchConfig {
  if (env.FRIENDY_SENSOR_MOCK === "1") {
    return {
      mode: "mock",
      command: "tsx",
      args: ["src/relationship/runtime/fakeMacosSensor.ts"]
    };
  }

  const sensorBinaryPath = resolve(cwd, env.FRIENDY_SENSOR_BINARY_PATH || "bin/friendy-macos-sensor");
  if (!existsSync(sensorBinaryPath)) {
    throw new Error(
      `Missing macOS sensor binary at ${sensorBinaryPath}. Run npm run build:macos-sensor, or set FRIENDY_SENSOR_MOCK=1 for the fake sensor.`
    );
  }

  return {
    mode: "real",
    command: sensorBinaryPath,
    args: ["--state-dir", sensorStateDir]
  };
}

/** CLI entrypoint for `npm run agent:friendy`. */
export async function main(): Promise<void> {
  loadFriendyEnv();
  const started = await startFriendyForegroundRuntime();
  console.info("[friendy:runtime_config]", JSON.stringify(started.config));
  console.info("[friendy:runtime_status]", "agent:friendy started foreground sensor runtime.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

function defaultStartSensor({
  launch,
  runtime
}: {
  launch: FriendySensorLaunchConfig;
  runtime: SensorRuntimeLineProcessor;
}): StartedSensorProcess {
  return startSensorProcess({
    launch: {
      command: launch.command,
      args: launch.args
    },
    runtime
  });
}

function defaultStartInboundAgent({
  repo,
  env,
  logger
}: {
  repo: RelationshipRepository;
  env: Partial<NodeJS.ProcessEnv>;
  logger: RuntimeLogger;
}): StartedInboundAgent {
  void startSpectrumFriendyAgent({ repo, env }).catch((error) => {
    logger.error(`[friendy:inbound_agent:error] ${error instanceof Error ? error.message : String(error)}`);
  });

  return undefined;
}

function shouldStartInboundAgent(config: FriendyRuntimeConfig, env: Partial<NodeJS.ProcessEnv>): boolean {
  if (env.FRIENDY_DISABLE_INBOUND_AGENT === "1") {
    return false;
  }

  return config.sensor.mode === "real" || env.FRIENDY_START_INBOUND_AGENT === "1";
}

function warnIfRuntimePathIsCloudSynced(config: FriendyRuntimeConfig, logger: RuntimeLogger): void {
  for (const [label, path] of [
    ["SQLite runtime store", config.sqlitePath],
    ["macOS sensor state", config.sensorStateDir]
  ] as const) {
    if (isCloudSyncedOrNetworkPath(path)) {
      logger.warn(
        `[friendy:runtime_store:warning] ${label} is under a common cloud-synced or network folder; SQLite WAL should stay on a local same-host filesystem. Path: ${path}`
      );
    }
  }
}

function isCloudSyncedOrNetworkPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  if (normalized.startsWith("//")) {
    return true;
  }

  return [
    "/icloud drive/",
    "/mobile documents/",
    "/dropbox/",
    "/google drive/",
    "/onedrive/",
    "/box/",
    "/volumes/"
  ].some((marker) => normalized.includes(marker));
}

function createConsolePromptSender(): RuntimePromptSenderWithKind {
  return {
    kind: "console",
    async sendPrompt(input) {
      console.info("[friendy:prompt]", JSON.stringify(input));
      return {};
    }
  };
}

function createFileAckWriter(cwd: string): RuntimeAckWriter {
  return {
    async writeAck(path) {
      const ackPath = isAbsolute(path) ? path : resolve(cwd, path);
      mkdirSync(dirname(ackPath), { recursive: true });
      writeFileSync(ackPath, new Date().toISOString());
    }
  };
}
