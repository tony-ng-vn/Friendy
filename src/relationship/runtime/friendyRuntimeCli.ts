import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { loadFriendyEnv } from "../env";
import { resolveConfiguredUserId } from "../identity";
import { createSqliteRelationshipRepository, createSqliteRuntimeStateStore, type SqliteRelationshipRepository, type SqliteRuntimeStateStore } from "../sqliteRepository";
import { createFriendySensorRuntime, type RuntimeAckWriter, type RuntimeLogger, type RuntimePromptSender } from "./friendyRuntime";
import { startSensorProcess, type SensorRuntimeLineProcessor, type StartedSensorProcess } from "./sensorProcess";

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
  ackWriter?: RuntimeAckWriter;
};

export type StartedFriendyForegroundRuntime = {
  config: FriendyRuntimeConfig;
  repo: SqliteRelationshipRepository;
  state: SqliteRuntimeStateStore;
  sensor: StartedSensorProcess;
  close(): void;
};

/** Resolves the foreground Friendy runtime config without starting Spectrum or a sensor process. */
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
  sender = createConsolePromptSender(),
  logger = console,
  ackWriter = createFileAckWriter(cwd),
  startSensor = defaultStartSensor
}: StartFriendyForegroundRuntimeInput = {}): Promise<StartedFriendyForegroundRuntime> {
  const config = resolveFriendyRuntimeConfig({ cwd, env });
  if (config.runtimeStore !== "sqlite") {
    throw new Error("agent:friendy requires FRIENDY_RUNTIME_STORE=sqlite for shared local runtime state.");
  }

  const userId = resolveConfiguredUserId(env, "local_friendy_user") ?? "local_friendy_user";
  const repo = createSqliteRelationshipRepository({ path: config.sqlitePath });
  const state = createSqliteRuntimeStateStore({ path: config.sqlitePath });
  const runtime = createFriendySensorRuntime({
    userId,
    repo,
    state,
    sender,
    ackWriter,
    logger
  });
  const sensor = startSensor({ launch: config.sensor, runtime });

  return {
    config,
    repo,
    state,
    sensor,
    close() {
      repo.close();
      state.close();
    }
  };
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

function createConsolePromptSender(): RuntimePromptSender {
  return {
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
