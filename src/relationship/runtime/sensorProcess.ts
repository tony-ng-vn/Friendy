/**
 * Child-process bridge for macOS sensor NDJSON stdout.
 *
 * Stdout is buffered into lines and fed to the runtime sequentially: each line
 * waits for the previous `processLine` promise to settle before the next runs.
 * This preserves event ordering and avoids concurrent writes to SQLite state.
 */
import { spawn } from "node:child_process";
import { closeSync, openSync, readSync, statSync, truncateSync, unwatchFile, watchFile } from "node:fs";
import type { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import type { RuntimeLogger } from "./friendyRuntime";

export type SensorLaunchConfig =
  | {
      kind: "executable";
      command: string;
      args: string[];
    }
  | {
      kind: "app_bundle";
      appPath: string;
      args: string[];
      eventLogPath: string;
    };

export type SensorRuntimeLineProcessor = {
  processLine(line: string): Promise<void> | void;
};

export type SensorChildProcess = EventEmitter & {
  stdout: Readable;
  stderr: Readable;
};

export type StartSensorProcessInput = {
  launch: SensorLaunchConfig;
  runtime: SensorRuntimeLineProcessor;
  logger?: RuntimeLogger;
  spawnProcess?: (command: string, args: string[]) => SensorChildProcess;
};

export type StartedSensorProcess = {
  child: SensorChildProcess;
};

/**
 * Starts a macOS sensor child process and streams NDJSON stdout into Friendy's runtime.
 *
 * Lines are trimmed, empty lines are skipped, and stderr is logged without blocking
 * stdout processing.
 */
export function startSensorProcess({
  launch,
  runtime,
  logger = console,
  spawnProcess = defaultSpawnProcess
}: StartSensorProcessInput): StartedSensorProcess {
  if (launch.kind === "app_bundle") {
    return startAppBundleSensorProcess({ launch, runtime, logger, spawnProcess });
  }

  const child = spawnProcess(launch.command, launch.args);
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let processing = Promise.resolve();

  child.stdout.on("data", (chunk: Buffer | string) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      enqueueLine(line);
    }
  });

  child.stdout.on("end", () => {
    flushStdoutBuffer();
  });

  child.stderr.on("data", (chunk: Buffer | string) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() ?? "";

    for (const line of lines) {
      logStderr(line);
    }
  });

  child.stderr.on("end", () => {
    logStderr(stderrBuffer);
    stderrBuffer = "";
  });

  child.on("exit", (code: number | null, signal: string | null) => {
    flushStdoutBuffer();
    logStderr(stderrBuffer);
    stderrBuffer = "";
    logger.warn(`[friendy:macos_sensor:exit] code=${code} signal=${signal}`);
  });

  function enqueueLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    processing = processing
      .then(() => runtime.processLine(trimmed))
      .catch((error) => {
        logger.error(`[friendy:macos_sensor:line_error] ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  function flushStdoutBuffer(): void {
    const line = stdoutBuffer.trim();
    stdoutBuffer = "";
    if (line) {
      enqueueLine(line);
    }
  }

  function logStderr(line: string): void {
    const trimmed = line.trim();
    if (trimmed) {
      logger.warn(`[friendy:macos_sensor:stderr] ${trimmed}`);
    }
  }

  return { child };
}

function defaultSpawnProcess(command: string, args: string[]): SensorChildProcess {
  return spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"]
  }) as SensorChildProcess;
}

function startAppBundleSensorProcess({
  launch,
  runtime,
  logger,
  spawnProcess
}: {
  launch: Extract<SensorLaunchConfig, { kind: "app_bundle" }>;
  runtime: SensorRuntimeLineProcessor;
  logger: RuntimeLogger;
  spawnProcess: (command: string, args: string[]) => SensorChildProcess;
}): StartedSensorProcess {
  truncateSync(launch.eventLogPath, 0);

  let stdoutBuffer = "";
  let processing = Promise.resolve();
  let readPosition = 0;

  const enqueueLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    processing = processing
      .then(() => runtime.processLine(trimmed))
      .catch((error) => {
        logger.error(`[friendy:macos_sensor:line_error] ${error instanceof Error ? error.message : String(error)}`);
      });
  };

  const drainEventLog = (): void => {
    let fd: number | undefined;
    try {
      const { size } = statSync(launch.eventLogPath);
      if (size <= readPosition) {
        return;
      }

      fd = openSync(launch.eventLogPath, "r");
      const chunk = Buffer.alloc(size - readPosition);
      readSync(fd, chunk, 0, chunk.length, readPosition);
      readPosition = size;
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        enqueueLine(line);
      }
    } catch {
      // Event log may not exist until the sensor emits its first line.
    } finally {
      if (fd !== undefined) {
        closeSync(fd);
      }
    }
  };

  watchFile(launch.eventLogPath, { interval: 100 }, () => {
    drainEventLog();
  });

  const child = spawnProcess("open", ["-W", "-n", "-a", launch.appPath, "--args", ...launch.args]);
  logger.info(`[friendy:macos_sensor] launching app bundle via open: ${launch.appPath}`);

  child.on("exit", (code: number | null, signal: string | null) => {
    unwatchFile(launch.eventLogPath);
    drainEventLog();
    const trailing = stdoutBuffer.trim();
    stdoutBuffer = "";
    if (trailing) {
      enqueueLine(trailing);
    }
    logger.warn(`[friendy:macos_sensor:exit] code=${code} signal=${signal}`);
  });

  return { child };
}
