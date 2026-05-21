import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import { resolveFriendyRuntimeConfig } from "./friendyRuntimeCli";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Friendy foreground runtime CLI configuration", () => {
  it("exposes the agent:friendy script", () => {
    expect(packageJson.scripts["agent:friendy"]).toBe("tsx src/relationship/runtime/friendyRuntimeCli.ts");
  });

  it("defaults the foreground runtime to local SQLite and the repo-local sensor state directory", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "friendy-macos-sensor"), "");

    const config = resolveFriendyRuntimeConfig({
      cwd,
      env: {
        FRIENDY_SENSOR_BINARY_PATH: join(cwd, "friendy-macos-sensor")
      }
    });

    expect(config.runtimeStore).toBe("sqlite");
    expect(config.sqlitePath).toBe(join(cwd, ".friendy/friendy.sqlite"));
    expect(config.sensorStateDir).toBe(join(cwd, ".friendy/macos-sensor-state"));
    expect(config.sensor.mode).toBe("real");
    expect(config.sensor.command).toBe(join(cwd, "friendy-macos-sensor"));
    expect(config.sensor.args).toEqual(["--state-dir", join(cwd, ".friendy/macos-sensor-state")]);
  });

  it("uses the fake sensor when FRIENDY_SENSOR_MOCK=1", () => {
    const cwd = tempDir();

    const config = resolveFriendyRuntimeConfig({
      cwd,
      env: {
        FRIENDY_SENSOR_MOCK: "1"
      }
    });

    expect(config.sensor.mode).toBe("mock");
    expect(config.sensor.command).toBe("tsx");
    expect(config.sensor.args).toEqual(["src/relationship/runtime/fakeMacosSensor.ts"]);
  });

  it("throws a clear error when the real sensor binary is missing", () => {
    const cwd = tempDir();

    expect(() => resolveFriendyRuntimeConfig({ cwd, env: {} })).toThrow(/friendy-macos-sensor/);
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-runtime-cli-"));
  tempDirs.push(dir);
  return dir;
}
