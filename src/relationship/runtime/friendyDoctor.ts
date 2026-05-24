/**
 * Local preflight checks for `agent:friendy` without starting Spectrum or the sensor.
 *
 * Validates Node version, writable SQLite/sensor paths, strict-mode model config,
 * prompt transport recipients, and macOS sensor binary presence. Native TCC is
 * reported as informational only — this module does not call Contacts or Calendar.
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadFriendyEnv } from "../env";
import { readOpenAIConfig } from "../openAIInterpreter";
import { readFriendyStrictMode } from "../strictMode";
import { resolveFriendyRuntimeConfig } from "./friendyRuntimeCli";
import { resolveMacosSensorBinaryPath } from "./macosSensorBinaryPath";

/** One named readiness check with optional remediation when `ok` is false. */
export type FriendyDoctorCheck = {
  name: string;
  ok: boolean;
  status: string;
  remediation?: string;
};

/** Aggregated doctor output; `ok` is false when any required check fails. */
export type FriendyDoctorReport = {
  ok: boolean;
  checks: FriendyDoctorCheck[];
  lines: string[];
};

/** Overrides for cwd, env, platform, and Node version in unit tests. */
export type FriendyDoctorInput = {
  cwd?: string;
  env?: Partial<NodeJS.ProcessEnv>;
  platform?: NodeJS.Platform;
  nodeVersion?: string;
};

/** Runs local Friendy runtime setup checks without starting Spectrum or the macOS sensor. */
export function runFriendyDoctor({
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  nodeVersion = process.version
}: FriendyDoctorInput = {}): FriendyDoctorReport {
  const checks: FriendyDoctorCheck[] = [];
  const nodeMajor = Number(nodeVersion.replace(/^v/, "").split(".")[0] ?? "0");

  checks.push({
    name: "node",
    ok: nodeMajor >= 24,
    status: nodeVersion,
    remediation: nodeMajor >= 24 ? undefined : "Use Node 24 or newer because Friendy uses node:sqlite."
  });
  checks.push(envFileCheck(cwd, env));

  try {
    const config = resolveFriendyRuntimeConfig({ cwd, env });
    checks.push(writableFilePathCheck("sqlite_runtime_store", config.sqlitePath));
    checks.push(writableDirectoryCheck("sensor_state_directory", config.sensorStateDir));
  } catch (error) {
    checks.push({
      name: "runtime_config",
      ok: false,
      status: "invalid",
      remediation: errorMessage(error)
    });
  }

  const strictMode = readFriendyStrictMode(env);
  const modelConfig = readOpenAIConfig(env);
  checks.push(strictModeCheck(strictMode));
  if (strictMode) {
    checks.push(modelApiKeyCheck(modelConfig.apiKey));
  }

  const promptTransport = env.FRIENDY_PROMPT_TRANSPORT || (env.FRIENDY_SENSOR_MOCK === "1" ? "console" : "spectrum");
  checks.push({ name: "prompt_transport", ok: true, status: promptTransport });
  checks.push(promptRecipientCheck(env, promptTransport));
  checks.push(sensorCheck(cwd, env));
  checks.push({
    name: "native_permissions",
    ok: platform === "darwin",
    status: platform === "darwin" ? "available" : "requires_macos",
    remediation: platform === "darwin" ? undefined : "Run native Contacts/Calendar verification on macOS."
  });

  return {
    ok: checks.every((check) => check.ok || check.name === "env_file" || check.name === "native_permissions"),
    checks,
    lines: renderDoctorLines({
      platform,
      nodeVersion,
      checks,
      strictMode,
      model: modelConfig.model,
      provider: modelConfig.provider
    })
  };
}

function strictModeCheck(strictMode: boolean): FriendyDoctorCheck {
  return {
    name: "strict_mode",
    ok: true,
    status: strictMode ? "enabled" : "disabled"
  };
}

function modelApiKeyCheck(apiKey: string): FriendyDoctorCheck {
  const ready = Boolean(apiKey.trim());
  return {
    name: "model_api_key",
    ok: ready,
    status: ready ? "ready" : "missing",
    remediation: ready ? undefined : "Set OPENAI_API_KEY before strict-mode dogfood runs."
  };
}

function envFileCheck(cwd: string, env: Partial<NodeJS.ProcessEnv>): FriendyDoctorCheck {
  const present = existsSync(join(cwd, ".env.local"));
  const mockMode = env.FRIENDY_SENSOR_MOCK === "1" || env.FRIENDY_PROMPT_TRANSPORT === "console";
  return {
    name: "env_file",
    ok: present || mockMode,
    status: present ? "present" : mockMode ? "optional_missing" : "missing",
    remediation: present || mockMode ? undefined : "Create .env.local with Spectrum and Friendy runtime settings."
  };
}

function promptRecipientCheck(env: Partial<NodeJS.ProcessEnv>, promptTransport: string): FriendyDoctorCheck {
  const hasRecipient = Boolean(env.FRIENDY_PROMPT_TO_PHONE?.trim() || env.FRIENDY_OWNER_PHONE?.trim());
  if (promptTransport !== "spectrum") {
    return { name: "prompt_recipient", ok: true, status: "not_required" };
  }

  return {
    name: "prompt_recipient",
    ok: hasRecipient,
    status: hasRecipient ? "ready" : "missing",
    remediation: hasRecipient ? undefined : "Set FRIENDY_PROMPT_TO_PHONE or FRIENDY_OWNER_PHONE."
  };
}

function sensorCheck(cwd: string, env: Partial<NodeJS.ProcessEnv>): FriendyDoctorCheck {
  if (env.FRIENDY_SENSOR_MOCK === "1") {
    return { name: "macos_sensor", ok: true, status: "mock_enabled" };
  }

  const binaryPath = resolveMacosSensorBinaryPath(cwd, env);
  const present = existsSync(binaryPath);
  return {
    name: "macos_sensor",
    ok: present,
    status: present ? "binary_present" : "binary_missing",
    remediation: present ? undefined : "Run npm run build:macos-sensor or set FRIENDY_SENSOR_MOCK=1."
  };
}

function writableFilePathCheck(name: string, filePath: string): FriendyDoctorCheck {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const probe = `${filePath}.doctor-probe`;
    writeFileSync(probe, "");
    unlinkSync(probe);
    return { name, ok: true, status: "ready" };
  } catch (error) {
    return { name, ok: false, status: "not_writable", remediation: errorMessage(error) };
  }
}

function writableDirectoryCheck(name: string, dirPath: string): FriendyDoctorCheck {
  try {
    mkdirSync(dirPath, { recursive: true });
    const probe = join(dirPath, ".doctor-probe");
    writeFileSync(probe, "");
    unlinkSync(probe);
    return { name, ok: true, status: "ready" };
  } catch (error) {
    return { name, ok: false, status: "not_writable", remediation: errorMessage(error) };
  }
}

function renderDoctorLines({
  platform,
  nodeVersion,
  checks,
  strictMode,
  model,
  provider
}: {
  platform: NodeJS.Platform;
  nodeVersion: string;
  checks: FriendyDoctorCheck[];
  strictMode: boolean;
  model: string;
  provider: string;
}): string[] {
  const lines = ["Friendy runtime doctor", `Platform: ${platform}`, `Node: ${nodeVersion}`];
  if (strictMode) {
    lines.push("strictMode: true");
    lines.push(`Model provider: ${provider}`);
    lines.push(`Model: ${model}`);
  }
  for (const check of checks) {
    lines.push(`${formatCheckName(check.name)}: ${formatStatus(check.status)}`);
    if (!check.ok && check.remediation) {
      lines.push(`Next step: ${check.remediation}`);
    }
  }
  return lines;
}

function formatCheckName(name: string): string {
  const labels: Record<string, string> = {
    env_file: ".env.local",
    macos_sensor: "macOS sensor",
    native_permissions: "native permissions",
    prompt_recipient: "prompt recipient",
    model_api_key: "Model API key",
    prompt_transport: "prompt transport",
    runtime_config: "runtime config",
    strict_mode: "strict mode",
    sensor_state_directory: "sensor state directory",
    sqlite_runtime_store: "SQLite runtime store"
  };

  return labels[name] ?? name.replace(/_/g, " ");
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** CLI entrypoint for `npm run doctor:friendy`. */
export function main(): void {
  loadFriendyEnv();
  const report = runFriendyDoctor();
  for (const line of report.lines) {
    console.info(line);
  }
  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
