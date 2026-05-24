import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MACOS_SENSOR_APP_BUNDLE_RELATIVE_PATH,
  MACOS_SENSOR_APP_RELATIVE_PATH,
  resolveMacosSensorAppBundlePath,
  resolveMacosSensorBinaryPath,
  shouldLaunchMacosSensorViaAppBundle
} from "./macosSensorBinaryPath";

describe("resolveMacosSensorBinaryPath", () => {
  it("prefers the packaged app executable when present", () => {
    const cwd = join(process.cwd(), "tmp-macos-sensor-binary-path-test");
    const appExecutable = join(cwd, MACOS_SENSOR_APP_RELATIVE_PATH);
    mkdirSync(join(appExecutable, ".."), { recursive: true });
    writeFileSync(appExecutable, "");

    expect(resolveMacosSensorBinaryPath(cwd)).toBe(appExecutable);
  });

  it("falls back to the flat bin binary when the app bundle is missing", () => {
    const cwd = join(process.cwd(), "tmp-macos-sensor-flat-binary-test");
    expect(resolveMacosSensorBinaryPath(cwd)).toBe(join(cwd, "bin/friendy-macos-sensor"));
  });

  it("honors FRIENDY_SENSOR_BINARY_PATH overrides", () => {
    const cwd = "/tmp/friendy";
    expect(resolveMacosSensorBinaryPath(cwd, { FRIENDY_SENSOR_BINARY_PATH: "custom/sensor" })).toBe(
      join(cwd, "custom/sensor")
    );
  });

  it("detects the packaged app bundle for TCC-correct launches", () => {
    const cwd = join(process.cwd(), "tmp-macos-sensor-app-bundle-test");
    const appBundle = join(cwd, MACOS_SENSOR_APP_BUNDLE_RELATIVE_PATH);
    mkdirSync(join(appBundle, "Contents/MacOS"), { recursive: true });
    writeFileSync(join(appBundle, "Contents/MacOS/friendy-macos-sensor"), "");

    expect(resolveMacosSensorAppBundlePath(cwd)).toBe(appBundle);
    expect(shouldLaunchMacosSensorViaAppBundle(cwd)).toBe(true);
    expect(shouldLaunchMacosSensorViaAppBundle(cwd, { FRIENDY_SENSOR_LAUNCH_VIA_APP_BUNDLE: "0" })).toBe(false);
  });
});
