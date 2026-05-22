import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import { runMacosSensorDoctor } from "./macosSensorDoctor";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("macOS sensor doctor and build scaffold", () => {
  it("exposes build and doctor package scripts for the standalone Swift sensor", () => {
    expect(packageJson.scripts["build:macos-sensor"]).toBe("node scripts/build-macos-sensor.mjs");
    expect(packageJson.scripts["doctor:macos-sensor"]).toBe("tsx src/relationship/runtime/macosSensorDoctor.ts");
  });

  it("keeps the build script on swift build instead of swift run", () => {
    const script = readFileSync("scripts/build-macos-sensor.mjs", "utf8");

    expect(script).toContain("swift");
    expect(script).toContain("build");
    expect(script).toContain("--package-path");
    expect(script).not.toContain("swift run");
  });

  it("reports the expected binary path and clear missing-binary guidance", () => {
    const cwd = tempDir();
    const report = runMacosSensorDoctor({
      cwd,
      platform: "linux",
      execFileSync() {
        throw new Error("should not inspect codesign for a missing binary");
      }
    });

    expect(report.ok).toBe(false);
    expect(report.binaryPath).toBe(join(cwd, "bin/friendy-macos-sensor"));
    expect(report.lines.join("\n")).toContain("Missing macOS sensor binary");
    expect(report.lines.join("\n")).toContain("npm run build:macos-sensor");
  });

  it("reports Swift availability and required source files before native verification", () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, "swift/FriendyMacOSSensor"), { recursive: true });
    writeFileSync(join(cwd, "swift/FriendyMacOSSensor/Package.swift"), "");
    mkdirSync(join(cwd, "swift/FriendyMacOSSensor/Sources/FriendyMacOSSensor"), { recursive: true });
    for (const filename of ["main.swift", "SensorCLI.swift", "SensorEvents.swift", "NativeMacosSensor.swift"]) {
      writeFileSync(join(cwd, "swift/FriendyMacOSSensor/Sources/FriendyMacOSSensor", filename), "");
    }

    const report = runMacosSensorDoctor({
      cwd,
      platform: "linux",
      execFileSync(command, args) {
        if (command === "swift" && args[0] === "--version") {
          return "Swift version 5.10";
        }
        throw new Error("unexpected command");
      }
    });

    const output = report.lines.join("\n");
    expect(output).toContain("Swift: Swift version 5.10");
    expect(output).toContain("Swift package: present");
    expect(output).toContain("Swift sources: present");
    expect(output).toContain("Native Contacts/EventKit verification: requires macOS");
  });

  it("reports missing Swift clearly when the toolchain is unavailable", () => {
    const cwd = tempDir();
    const report = runMacosSensorDoctor({
      cwd,
      platform: "linux",
      execFileSync(command, args) {
        if (command === "swift" && args[0] === "--version") {
          throw new Error("swift not found");
        }
        throw new Error("unexpected command");
      }
    });

    expect(report.lines.join("\n")).toContain("Swift: missing");
  });

  it("reports a present binary and captures signing diagnostics when available", () => {
    const cwd = tempDir();
    const binaryPath = join(cwd, "bin/friendy-macos-sensor");
    mkdirSync(join(cwd, "bin"), { recursive: true });
    writeFileSync(binaryPath, "");

    const report = runMacosSensorDoctor({
      cwd,
      platform: "darwin",
      execFileSync(command, args) {
        return `${command} ${args.join(" ")}: ad-hoc signed`;
      }
    });

    expect(existsSync(binaryPath)).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.lines.join("\n")).toContain("Binary: present");
    expect(report.lines.join("\n")).toContain("ad-hoc signed");
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-macos-doctor-"));
  tempDirs.push(dir);
  return dir;
}
