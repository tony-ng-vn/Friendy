#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const packagePath = join(repoRoot, "swift/FriendyMacOSSensor");
const builtBinaryPath = join(packagePath, ".build/release/friendy-macos-sensor");
const outputBinaryPath = join(repoRoot, "bin/friendy-macos-sensor");

try {
  execFileSync("swift", ["build", "-c", "release", "--package-path", packagePath], {
    stdio: "inherit"
  });

  if (!existsSync(builtBinaryPath)) {
    throw new Error(`Swift build finished, but ${builtBinaryPath} was not found.`);
  }

  mkdirSync(dirname(outputBinaryPath), { recursive: true });
  copyFileSync(builtBinaryPath, outputBinaryPath);
  console.info(`Copied macOS sensor binary to ${outputBinaryPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Build requires Swift Package Manager and is intended for local macOS sensor verification.");
  process.exit(1);
}
