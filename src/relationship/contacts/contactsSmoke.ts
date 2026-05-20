import { execFileSync as defaultExecFileSync } from "node:child_process";
import os from "node:os";

type SmokeContactInput = {
  name: string;
  phoneNumber: string;
};

type RunContactsSmokeOptions = {
  argv: string[];
  platform?: NodeJS.Platform;
  execFileSync?: typeof defaultExecFileSync;
};

export type ContactsSmokeResult = {
  ok: boolean;
  message: string;
  name?: string;
  phoneNumber?: string;
};

export function validateFriendySmokeContactName(name: string): { ok: true } | { ok: false; reason: string } {
  if (/^Friendy-\d+$/.test(name)) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: "Contact smoke names must match Friendy-<number>, for example Friendy-001."
  };
}

export function parseContactsSmokeArgs(argv: string[]): SmokeContactInput {
  const nameIndex = argv.indexOf("--name");
  const name = nameIndex >= 0 ? argv[nameIndex + 1] : "";
  const validation = validateFriendySmokeContactName(name);

  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  return {
    name,
    phoneNumber: phoneForFriendyName(name)
  };
}

export function runContactsSmoke({
  argv,
  platform = os.platform(),
  execFileSync = defaultExecFileSync
}: RunContactsSmokeOptions): ContactsSmokeResult {
  let input: SmokeContactInput;
  try {
    input = parseContactsSmokeArgs(argv);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }

  if (platform !== "darwin") {
    return {
      ok: false,
      message: "macOS Contacts smoke test is only available on darwin. Fixture ingestion still works with npm run ingest:demo.",
      name: input.name,
      phoneNumber: input.phoneNumber
    };
  }

  const script = buildMacContactsAppleScript(input);
  execFileSync("osascript", ["-e", script], { encoding: "utf8" });

  return {
    ok: true,
    message: `Created or reused Contacts smoke contact ${input.name} with ${input.phoneNumber}.`,
    name: input.name,
    phoneNumber: input.phoneNumber
  };
}

export function buildMacContactsAppleScript({ name, phoneNumber }: SmokeContactInput): string {
  const safeName = appleScriptString(name);
  const safePhone = appleScriptString(phoneNumber);

  return [
    'tell application "Contacts"',
    `set friendyName to "${safeName}"`,
    `set friendyPhone to "${safePhone}"`,
    "set matches to people whose name is friendyName",
    "if (count of matches) is 0 then",
    "set targetPerson to make new person with properties {first name:friendyName}",
    "else",
    "set targetPerson to item 1 of matches",
    "end if",
    "set existingPhones to value of phones of targetPerson",
    "if existingPhones does not contain friendyPhone then",
    'make new phone at end of phones of targetPerson with properties {label:"mobile", value:friendyPhone}',
    "end if",
    "save",
    'return friendyName & " " & friendyPhone',
    "end tell"
  ].join("\n");
}

function phoneForFriendyName(name: string): string {
  const digits = name.replace(/\D/g, "");
  return `+1555${digits.padStart(7, "0")}`;
}

function appleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
