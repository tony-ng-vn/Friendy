import { execFileSync as defaultExecFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

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

export function main(): void {
  const report = runMacosSensorDoctor();
  for (const line of report.lines) {
    console.info(line);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
