import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadFriendyEnv } from "../env";

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
  const config = resolveFriendyRuntimeConfig();
  console.info("[friendy:runtime_config]", JSON.stringify(config));
  console.info("[friendy:runtime_status]", "agent:friendy config resolved; process orchestration will be enabled in the next runtime slice.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
