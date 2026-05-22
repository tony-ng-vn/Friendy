#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const packagePath = join(repoRoot, "swift/FriendyMacOSSensor");
const infoPlistPath = join(packagePath, "Packaging/Info.plist");
const appInfoPlistPath = join(packagePath, "Packaging/App-Info.plist");
const entitlementsPath = join(packagePath, "Packaging/FriendyMacOSSensor.entitlements");
const builtBinaryPath = join(packagePath, ".build/release/friendy-macos-sensor");
const outputBinaryPath = join(repoRoot, "bin/friendy-macos-sensor");
const appBundlePath = join(repoRoot, "bin/Friendy macOS Sensor.app");
const appExecutablePath = join(appBundlePath, "Contents/MacOS/friendy-macos-sensor");
const appInfoPlistDestination = join(appBundlePath, "Contents/Info.plist");
const codesignIdentity = process.env.FRIENDY_CODESIGN_IDENTITY || "-";

try {
  execFileSync("swift", [
    "build",
    "-c",
    "release",
    "--package-path",
    packagePath,
    "-Xlinker",
    "-sectcreate",
    "-Xlinker",
    "__TEXT",
    "-Xlinker",
    "__info_plist",
    "-Xlinker",
    infoPlistPath
  ], {
    stdio: "inherit"
  });

  if (!existsSync(builtBinaryPath)) {
    throw new Error(`Swift build finished, but ${builtBinaryPath} was not found.`);
  }

  mkdirSync(dirname(outputBinaryPath), { recursive: true });
  copyFileSync(builtBinaryPath, outputBinaryPath);
  console.info(`Copied macOS sensor binary to ${outputBinaryPath}`);

  if (process.platform === "darwin") {
    mkdirSync(dirname(appExecutablePath), { recursive: true });
    copyFileSync(outputBinaryPath, appExecutablePath);
    copyFileSync(appInfoPlistPath, appInfoPlistDestination);

    execFileSync("codesign", [
      "--force",
      "--sign",
      codesignIdentity,
      "--entitlements",
      entitlementsPath,
      outputBinaryPath
    ], {
      stdio: "inherit"
    });
    console.info(`Signed macOS sensor binary with identity ${codesignIdentity}`);

    execFileSync("codesign", [
      "--force",
      "--deep",
      "--sign",
      codesignIdentity,
      "--entitlements",
      entitlementsPath,
      appBundlePath
    ], {
      stdio: "inherit"
    });
    console.info(`Signed macOS sensor app bundle at ${appBundlePath}`);
  } else {
    console.info("Skipped codesign and app bundle outside macOS.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Build requires Swift Package Manager and is intended for local macOS sensor verification.");
  process.exit(1);
}
