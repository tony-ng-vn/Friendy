import { execFileSync as nodeExecFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parseSensorEventLine, type MacosContactAddedEvent, type MacosSensorEvent } from "./sensorEvents";

type ExecFileSync = (
  command: string,
  args: string[],
  options?: {
    encoding?: BufferEncoding;
  }
) => string | Buffer;

export type MacosSensorFixtureCheckReport = {
  ok: boolean;
  skipped: boolean;
  binaryPath: string;
  eventTypes: string[];
  ackPath?: string;
  lines: string[];
};

export function runMacosSensorFixtureCheck({
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  execFileSync = nodeExecFileSync
}: {
  cwd?: string;
  env?: Partial<NodeJS.ProcessEnv>;
  platform?: NodeJS.Platform;
  execFileSync?: ExecFileSync;
} = {}): MacosSensorFixtureCheckReport {
  const binaryPath = resolveBinaryPath(cwd, env);
  const lines = [`macOS sensor binary: ${binaryPath}`];

  if (!existsSync(binaryPath)) {
    if (platform !== "darwin") {
      lines.push("Skipped compiled macOS sensor fixture check: requires macOS binary.");
      lines.push("Run npm run build:macos-sensor on macOS, then rerun npm run check:macos-sensor-fixture.");
      return { ok: true, skipped: true, binaryPath, eventTypes: [], lines };
    }

    lines.push("Missing macOS sensor binary.");
    lines.push("Run npm run build:macos-sensor, then rerun npm run check:macos-sensor-fixture.");
    return { ok: false, skipped: false, binaryPath, eventTypes: [], lines };
  }

  const stateDir = mkdtempSync(join(tmpdir(), "friendy-macos-sensor-fixture-state-"));
  try {
    const stdout = String(
      execFileSync(binaryPath, ["--state-dir", stateDir, "--emit-fixture", "contact_batch"], {
        encoding: "utf8"
      })
    );
    const parsed = parseFixtureOutput(stdout);
    lines.push(`Fixture event types: ${parsed.eventTypes.join(", ")}`);
    lines.push(`Fixture ack path: ${parsed.ackPath}`);
    lines.push("Redacted contact methods: present");
    lines.push("Compiled macOS sensor fixture check passed.");

    return {
      ok: true,
      skipped: false,
      binaryPath,
      eventTypes: parsed.eventTypes,
      ackPath: parsed.ackPath,
      lines
    };
  } catch (error) {
    lines.push(`Compiled macOS sensor fixture check failed: ${errorMessage(error)}`);
    return { ok: false, skipped: false, binaryPath, eventTypes: [], lines };
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

export function main(): void {
  const report = runMacosSensorFixtureCheck();
  for (const line of report.lines) {
    console.log(line);
  }
  if (!report.ok) {
    process.exitCode = 1;
  }
}

function resolveBinaryPath(cwd: string, env: Partial<NodeJS.ProcessEnv>): string {
  const configured = env.FRIENDY_SENSOR_BINARY_PATH;
  if (configured) {
    return isAbsolute(configured) ? configured : resolve(cwd, configured);
  }
  return join(cwd, "bin/friendy-macos-sensor");
}

function parseFixtureOutput(stdout: string): { eventTypes: string[]; ackPath: string } {
  const rawLines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    throw new Error("sensor fixture emitted no NDJSON lines");
  }

  const events = rawLines.map((line) => parseSensorEventLine(line));
  const contactEvents = events.filter((event): event is MacosContactAddedEvent => event.type === "contact_added");
  const batchEvents = events.filter(isHistoryBatchCompleteEvent);
  if (events.length !== 2 || contactEvents.length !== 1 || batchEvents.length !== 1) {
    throw new Error("sensor fixture must emit contact_added followed by history_batch_complete");
  }

  const [contactEvent] = contactEvents;
  const [batchEvent] = batchEvents;
  if (events[0].type !== "contact_added" || events[1].type !== "history_batch_complete") {
    throw new Error("sensor fixture must emit contact_added before history_batch_complete");
  }

  if (batchEvent.historyBatchId !== contactEvent.historyBatchId) {
    throw new Error("history_batch_complete must reference the contact_added history batch");
  }

  if (!batchEvent.contactEventIds.includes(contactEvent.eventId)) {
    throw new Error("history_batch_complete must include the contact_added event id");
  }

  assertRedactedContactMethods(contactEvent);
  return {
    eventTypes: events.map((event) => event.type),
    ackPath: batchEvent.ackPath
  };
}

function assertRedactedContactMethods(event: MacosContactAddedEvent): void {
  const hasHashes = event.contact.phoneNumberHashes.length > 0 || event.contact.emailHashes.length > 0;
  const hasHints = event.contact.phoneNumberHints.length > 0 || event.contact.emailHints.length > 0;
  if (!hasHashes && !hasHints) {
    throw new Error("contact_added fixture must include redacted contact method hashes or hints");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isHistoryBatchCompleteEvent(
  event: MacosSensorEvent
): event is Extract<MacosSensorEvent, { type: "history_batch_complete" }> {
  return event.type === "history_batch_complete";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
