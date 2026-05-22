import { execFileSync as defaultExecFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type MacosSensorDoctorInput = {
  cwd?: string;
  env?: Partial<NodeJS.ProcessEnv>;
  platform?: NodeJS.Platform;
  execFileSync?: (command: string, args: string[]) => string | Buffer;
};

export type MacosSensorDoctorReport = {
  ok: boolean;
  binaryPath: string;
  lines: string[];
};

export function runMacosSensorDoctor({
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  execFileSync = defaultExecFileSync
}: MacosSensorDoctorInput = {}): MacosSensorDoctorReport {
  const binaryPath = resolve(cwd, env.FRIENDY_SENSOR_BINARY_PATH || "bin/friendy-macos-sensor");
  const lines = [`Friendy macOS sensor doctor`, `Binary path: ${binaryPath}`, `Platform: ${platform}`];
  lines.push(`Swift: ${readSwiftVersion(execFileSync)}`);
  lines.push(`Swift package: ${existsSync(join(cwd, "swift/FriendyMacOSSensor/Package.swift")) ? "present" : "missing"}`);
  lines.push(`Swift sources: ${requiredSwiftSourcesPresent(cwd) ? "present" : "missing"}`);
  lines.push(`Native Contacts/EventKit verification: ${platform === "darwin" ? "available on this host" : "requires macOS"}`);

  if (!existsSync(binaryPath)) {
    lines.push("Binary: missing");
    lines.push("Missing macOS sensor binary. Run npm run build:macos-sensor, or set FRIENDY_SENSOR_MOCK=1 for fake sensor testing.");
    return { ok: false, binaryPath, lines };
  }

  lines.push("Binary: present");

  if (platform === "darwin") {
    try {
      lines.push(String(execFileSync("codesign", ["-dv", "--verbose=4", binaryPath])));
    } catch (error) {
      lines.push(`Codesign: unavailable (${error instanceof Error ? error.message : String(error)})`);
    }
  } else {
    lines.push("Codesign: skipped outside macOS");
  }

  return { ok: true, binaryPath, lines };
}

function readSwiftVersion(execFileSync: (command: string, args: string[]) => string | Buffer): string {
  try {
    return firstLine(String(execFileSync("swift", ["--version"])));
  } catch {
    return "missing";
  }
}

function requiredSwiftSourcesPresent(cwd: string): boolean {
  const sourceRoot = join(cwd, "swift/FriendyMacOSSensor/Sources/FriendyMacOSSensor");
  return ["main.swift", "SensorCLI.swift", "SensorEvents.swift", "NativeMacosSensor.swift"].every((filename) =>
    existsSync(join(sourceRoot, filename))
  );
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0]?.trim() || "unknown";
}

export function main(): void {
  const report = runMacosSensorDoctor();
  for (const line of report.lines) {
    console.info(line);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
