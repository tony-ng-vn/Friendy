/**
 * Resolves paths to the compiled macOS sensor binary and packaged `.app` bundle.
 *
 * Prefers `FRIENDY_SENSOR_*` overrides, then the checked-in app bundle (for TCC),
 * then the standalone Mach-O under `bin/`.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Checked-in `.app` used for `open -a` launches so Contacts TCC binds to the app identity. */
export const MACOS_SENSOR_APP_BUNDLE_RELATIVE_PATH = "bin/Friendy macOS Sensor.app";
/** Mach-O inside the app bundle; preferred over the standalone binary when the bundle exists. */
export const MACOS_SENSOR_APP_RELATIVE_PATH =
  "bin/Friendy macOS Sensor.app/Contents/MacOS/friendy-macos-sensor";
/** NDJSON log filename written when launching via app bundle (stdout may be empty). */
export const MACOS_SENSOR_EVENT_LOG_FILENAME = "sensor-events.ndjson";

/** Prefer the packaged .app executable on macOS so TCC registers a visible app identity. */
export function resolveMacosSensorBinaryPath(
  cwd: string,
  env: Partial<NodeJS.ProcessEnv> = process.env
): string {
  if (env.FRIENDY_SENSOR_BINARY_PATH?.trim()) {
    return resolve(cwd, env.FRIENDY_SENSOR_BINARY_PATH);
  }

  const appBundleBinary = join(cwd, MACOS_SENSOR_APP_RELATIVE_PATH);
  if (existsSync(appBundleBinary)) {
    return appBundleBinary;
  }

  return join(cwd, "bin/friendy-macos-sensor");
}

/** Returns the `.app` bundle path when present (used for TCC-correct launches via `open`). */
export function resolveMacosSensorAppBundlePath(
  cwd: string,
  env: Partial<NodeJS.ProcessEnv> = process.env
): string | null {
  if (env.FRIENDY_SENSOR_APP_BUNDLE_PATH?.trim()) {
    return resolve(cwd, env.FRIENDY_SENSOR_APP_BUNDLE_PATH);
  }

  const appBundlePath = join(cwd, MACOS_SENSOR_APP_BUNDLE_RELATIVE_PATH);
  return existsSync(appBundlePath) ? appBundlePath : null;
}

/**
 * macOS attributes Contacts access to the launching app. Running the Mach-O inside `.app/Contents/MacOS`
 * from Terminal uses Terminal's TCC identity even when the app toggle is ON in Settings.
 */
export function shouldLaunchMacosSensorViaAppBundle(
  cwd: string,
  env: Partial<NodeJS.ProcessEnv> = process.env
): boolean {
  if (env.FRIENDY_SENSOR_LAUNCH_VIA_APP_BUNDLE === "0") {
    return false;
  }

  return resolveMacosSensorAppBundlePath(cwd, env) !== null;
}
