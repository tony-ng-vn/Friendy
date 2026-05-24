/**
 * Ensures a single macOS sensor owns NDJSON stdout and on-disk state.
 *
 * Kills stray `friendy-macos-sensor` processes before the runtime spawns a new child,
 * avoiding duplicate event streams and conflicting writes to the sensor state directory.
 */
import { spawnSync } from "node:child_process";
import type { RuntimeLogger } from "./friendyRuntime";

function countMatchingSensorProcesses(): number {
  const result = spawnSync("pgrep", ["-fl", "friendy-macos-sensor"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    return 0;
  }

  return result.stdout.trim().split("\n").filter(Boolean).length;
}

/** Stops stray macOS sensor processes so only the agent-launched instance owns state files. */
export function terminateExistingMacosSensorProcesses(logger: RuntimeLogger = console): number {
  const existing = countMatchingSensorProcesses();
  if (existing === 0) {
    return 0;
  }

  spawnSync("pkill", ["-f", "friendy-macos-sensor"], { stdio: "ignore" });
  logger.info("[friendy] terminated existing macOS sensor process(es) before launch");
  return existing;
}
