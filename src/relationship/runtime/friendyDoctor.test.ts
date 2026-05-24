import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import { runFriendyDoctor } from "./friendyDoctor";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Friendy runtime doctor", () => {
  it("exposes the package script", () => {
    expect(packageJson.scripts["doctor:friendy"]).toBe("tsx src/relationship/runtime/friendyDoctor.ts");
  });

  it("reports ready mock runtime configuration with structured checks", () => {
    const cwd = tempDir();
    const report = runFriendyDoctor({
      cwd,
      env: {
        FRIENDY_SENSOR_MOCK: "1",
        FRIENDY_PROMPT_TRANSPORT: "console",
        FRIENDY_RUNTIME_STORE: "sqlite",
        OPENROUTER_API_KEY: "sk-test"
      },
      platform: "linux",
      nodeVersion: "v24.15.0"
    });

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.name === "node")?.ok).toBe(true);
    expect(report.checks.find((check) => check.name === "sqlite_runtime_store")?.ok).toBe(true);
    expect(report.checks.find((check) => check.name === "prompt_transport")?.status).toBe("console");
    expect(report.checks.find((check) => check.name === "macos_sensor")?.status).toBe("mock_enabled");
    expect(report.lines.join("\n")).toContain("macOS sensor: mock enabled");
  });

  it("reports actionable failures for missing real sensor and prompt recipient", () => {
    const cwd = tempDir();
    const report = runFriendyDoctor({
      cwd,
      env: {
        FRIENDY_RUNTIME_STORE: "sqlite"
      },
      platform: "darwin",
      nodeVersion: "v24.15.0"
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "prompt_recipient")).toMatchObject({
      ok: false,
      status: "missing"
    });
    expect(report.checks.find((check) => check.name === "macos_sensor")).toMatchObject({
      ok: false,
      status: "binary_missing"
    });
  });

  it("accepts a configured real sensor binary", () => {
    const cwd = tempDir();
    const binaryPath = join(cwd, "bin/friendy-macos-sensor");
    mkdirSync(dirname(binaryPath), { recursive: true });
    writeFileSync(binaryPath, "");

    const report = runFriendyDoctor({
      cwd,
      env: {
        FRIENDY_RUNTIME_STORE: "sqlite",
        FRIENDY_PROMPT_TRANSPORT: "console",
        FRIENDY_SENSOR_BINARY_PATH: binaryPath
      },
      platform: "darwin",
      nodeVersion: "v24.15.0"
    });

    expect(report.checks.find((check) => check.name === "macos_sensor")).toMatchObject({
      ok: true,
      status: "binary_present"
    });
  });

  it("reports .env.local as optional in mock mode and recommended in real mode", () => {
    const cwd = tempDir();
    const mockReport = runFriendyDoctor({
      cwd,
      env: { FRIENDY_SENSOR_MOCK: "1", FRIENDY_PROMPT_TRANSPORT: "console" },
      nodeVersion: "v24.15.0"
    });
    expect(mockReport.checks.find((check) => check.name === "env_file")?.status).toBe("optional_missing");

    const realReport = runFriendyDoctor({
      cwd,
      env: {},
      nodeVersion: "v24.15.0"
    });
    expect(realReport.checks.find((check) => check.name === "env_file")?.status).toBe("missing");
  });

  it("warns when strict mode is on but OPENROUTER_API_KEY is missing", () => {
    const cwd = tempDir();
    const report = runFriendyDoctor({
      cwd,
      env: {
        FRIENDY_SENSOR_MOCK: "1",
        FRIENDY_PROMPT_TRANSPORT: "console",
        FRIENDY_STRICT_MODE: "1"
      },
      nodeVersion: "v24.15.0"
    });

    expect(report.checks.find((check) => check.name === "strict_mode")?.status).toBe("enabled");
    expect(report.checks.find((check) => check.name === "openrouter_api_key")).toMatchObject({
      ok: false,
      status: "missing"
    });
    expect(report.lines.join("\n")).toContain("strictMode: true");
    expect(report.lines.join("\n")).toContain("OpenRouter model:");
    expect(report.lines.join("\n")).toContain("OpenRouter API key: missing");
  });

  it("reports OpenRouter readiness when strict mode is on and the API key is set", () => {
    const cwd = tempDir();
    const report = runFriendyDoctor({
      cwd,
      env: {
        FRIENDY_SENSOR_MOCK: "1",
        FRIENDY_PROMPT_TRANSPORT: "console",
        FRIENDY_STRICT_MODE: "1",
        OPENROUTER_API_KEY: "sk-test",
        OPENROUTER_MODEL: "custom-model"
      },
      nodeVersion: "v24.15.0"
    });

    expect(report.checks.find((check) => check.name === "openrouter_api_key")).toMatchObject({
      ok: true,
      status: "ready"
    });
    expect(report.lines.join("\n")).toContain("OpenRouter model: custom-model");
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-doctor-"));
  tempDirs.push(dir);
  return dir;
}
