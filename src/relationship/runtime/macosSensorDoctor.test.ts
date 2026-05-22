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

  it("reports TCC usage descriptions and entitlements required by packaged macOS runs", () => {
    const cwd = tempDir();
    writePackagingFiles(cwd, {
      infoPlist: `
        <plist><dict>
          <key>NSContactsUsageDescription</key><string>Friendy detects newly added contacts.</string>
          <key>NSCalendarsFullAccessUsageDescription</key><string>Friendy uses nearby calendar events as context.</string>
          <key>NSCalendarsUsageDescription</key><string>Friendy uses nearby calendar events as context.</string>
        </dict></plist>
      `,
      entitlements: `
        <plist><dict>
          <key>com.apple.security.personal-information.addressbook</key><true/>
          <key>com.apple.security.personal-information.calendars</key><true/>
        </dict></plist>
      `
    });

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
    expect(output).toContain("TCC Info.plist: present");
    expect(output).toContain("Contacts usage description: present");
    expect(output).toContain("Calendar full-access usage description: present");
    expect(output).toContain("Calendar legacy usage description: present");
    expect(output).toContain("TCC entitlements: present");
    expect(output).toContain("AddressBook entitlement: present");
    expect(output).toContain("Calendar entitlement: present");
  });

  it("reports missing TCC packaging metadata clearly", () => {
    const cwd = tempDir();
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
    expect(output).toContain("TCC Info.plist: missing");
    expect(output).toContain("Contacts usage description: missing");
    expect(output).toContain("Calendar full-access usage description: missing");
    expect(output).toContain("TCC entitlements: missing");
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

function writePackagingFiles(cwd: string, input: { infoPlist: string; entitlements: string }): void {
  const packagingDir = join(cwd, "swift/FriendyMacOSSensor/Packaging");
  mkdirSync(packagingDir, { recursive: true });
  writeFileSync(join(packagingDir, "Info.plist"), input.infoPlist);
  writeFileSync(join(packagingDir, "FriendyMacOSSensor.entitlements"), input.entitlements);
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-macos-doctor-"));
  tempDirs.push(dir);
  return dir;
}
