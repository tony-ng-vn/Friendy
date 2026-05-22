import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { startSensorProcess, type SensorChildProcess } from "./sensorProcess";

describe("macOS sensor process wiring", () => {
  it("streams newline-delimited sensor stdout into the runtime with chunk-safe splitting", async () => {
    const child = createFakeChild();
    const processedLines: string[] = [];

    startSensorProcess({
      launch: { kind: "executable", command: "fake-sensor", args: ["--state-dir", ".friendy/state"] },
      spawnProcess() {
        return child;
      },
      runtime: {
        async processLine(line) {
          processedLines.push(line);
        }
      },
      logger: testLogger()
    });

    child.stdout.write('{"type":"ready"}\n{"type"');
    child.stdout.write(':"history_reset"}\n\n');
    child.stdout.end();
    await waitForStreamEnd(child.stdout);

    expect(processedLines).toEqual(['{"type":"ready"}', '{"type":"history_reset"}']);
  });

  it("flushes a final unterminated stdout line before process exit", async () => {
    const child = createFakeChild();
    const processedLines: string[] = [];

    startSensorProcess({
      launch: { kind: "executable", command: "fake-sensor", args: [] },
      spawnProcess() {
        return child;
      },
      runtime: {
        async processLine(line) {
          processedLines.push(line);
        }
      },
      logger: testLogger()
    });

    child.stdout.write('{"type":"ready"}');
    child.emit("exit", 0, null);
    await Promise.resolve();

    expect(processedLines).toEqual(['{"type":"ready"}']);
  });

  it("logs stderr diagnostics and nonzero exits without throwing", async () => {
    const child = createFakeChild();
    const logs: string[] = [];

    expect(() =>
      startSensorProcess({
        launch: { kind: "executable", command: "fake-sensor", args: [] },
        spawnProcess() {
          return child;
        },
        runtime: {
          async processLine() {
            throw new Error("runtime should not receive stderr");
          }
        },
        logger: testLogger(logs)
      })
    ).not.toThrow();

    child.stderr.write("Contacts permission denied\n");
    child.emit("exit", 1, null);
    await Promise.resolve();

    expect(logs).toContain("[friendy:macos_sensor:stderr] Contacts permission denied");
    expect(logs).toContain("[friendy:macos_sensor:exit] code=1 signal=null");
  });

  it("creates a missing app-bundle event log before tailing", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "friendy-sensor-"));
    const eventLogPath = join(stateDir, "sensor-events.ndjson");
    const child = createFakeChild();

    startSensorProcess({
      launch: {
        kind: "app_bundle",
        appPath: "/Applications/Friendy macOS Sensor.app",
        args: ["--state-dir", stateDir],
        eventLogPath
      },
      spawnProcess() {
        return child;
      },
      runtime: {
        async processLine() {}
      },
      logger: testLogger()
    });

    expect(existsSync(eventLogPath)).toBe(true);
    child.emit("exit", 0, null);
  });
});

type FakeSensorChildProcess = SensorChildProcess & {
  stdout: PassThrough;
  stderr: PassThrough;
};

function createFakeChild(): FakeSensorChildProcess {
  const child = new EventEmitter() as FakeSensorChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

function testLogger(logs: string[] = []) {
  return {
    info(message: string) {
      logs.push(message);
    },
    warn(message: string) {
      logs.push(message);
    },
    error(message: string) {
      logs.push(message);
    }
  };
}

function waitForStreamEnd(stream: PassThrough): Promise<void> {
  return new Promise((resolve) => stream.on("end", resolve));
}
