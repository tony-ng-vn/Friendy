/**
 * macOS Contacts and Calendar adapters behind an explicit AppleScript boundary.
 *
 * Real provider reads are Darwin-only and must be invoked from user-run CLI commands such as
 * `npm run ingest:local:check`, never from normal tests, builds, or agent runs.
 */
import { execFileSync as defaultExecFileSync } from "node:child_process";
import os from "node:os";
import type { CalendarEvent } from "../types";
import type { ContactSnapshot, ContactSnapshotContact } from "./contactSnapshot";
import { redactEmailMethod, redactPhoneMethod } from "./contactMethodRedaction";

type ExecFileSync = typeof defaultExecFileSync;

/** Input for parsing Contacts AppleScript stdout into a snapshot. */
export type ParseMacContactsSnapshotOutputInput = {
  userId: string;
  capturedAt: string;
  output: string;
};

/** Input for parsing Calendar AppleScript stdout into Friendy events. */
export type ParseMacCalendarEventsOutputInput = {
  userId: string;
  output: string;
};

/** Input for reading a live Contacts snapshot via AppleScript on macOS. */
export type ReadMacContactsSnapshotInput = {
  userId: string;
  capturedAt: string;
  platform?: NodeJS.Platform;
  execFileSync?: ExecFileSync;
};

/** Input for reading Calendar events in a time window via AppleScript on macOS. */
export type ReadMacCalendarEventsInput = {
  userId: string;
  windowStart: string;
  windowEnd: string;
  platform?: NodeJS.Platform;
  execFileSync?: ExecFileSync;
};

/** Parses the stable row format emitted by the Contacts AppleScript adapter. */
export function parseMacContactsSnapshotOutput({
  userId,
  capturedAt,
  output
}: ParseMacContactsSnapshotOutputInput): ContactSnapshot {
  return {
    userId,
    capturedAt,
    contacts: parseRows(output).map(([stableId, displayName, phoneNumbers, emails, updatedAt]) =>
      redactParsedContact({
        stableId,
        displayName,
        phoneNumbers: splitList(phoneNumbers),
        emails: splitList(emails),
        updatedAt: updatedAt || capturedAt
      })
    )
  };
}

function redactParsedContact(contact: ContactSnapshotContact): ContactSnapshotContact {
  const phoneMethods = contact.phoneNumbers.map(redactPhoneMethod);
  const emailMethods = contact.emails.map(redactEmailMethod);

  return {
    stableId: contact.stableId,
    displayName: contact.displayName,
    phoneNumbers: phoneMethods.map((method) => method.label),
    emails: emailMethods.map((method) => method.label),
    phoneNumberHashes: phoneMethods.map((method) => method.hash),
    emailHashes: emailMethods.map((method) => method.hash),
    phoneNumberHints: phoneMethods.map((method) => method.hint),
    emailHints: emailMethods.map((method) => method.hint),
    updatedAt: contact.updatedAt
  };
}

/** Parses the stable row format emitted by the Calendar AppleScript adapter. */
export function parseMacCalendarEventsOutput({ userId, output }: ParseMacCalendarEventsOutputInput): CalendarEvent[] {
  return parseRows(output).map(([id, title, startsAt, endsAt, timezone, location, eventKind]) => ({
    id,
    userId,
    title,
    startsAt,
    endsAt,
    timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    location: location || undefined,
    calendarSource: "apple_calendar",
    eventKind: eventKind === "all_day" || eventKind === "long" ? eventKind : "short"
  }));
}

/**
 * Reads the user's macOS Contacts into Friendy's snapshot format.
 *
 * Requires darwin and Contacts permission; call only from explicit local-check CLI flows.
 */
export function readMacContactsSnapshot({
  userId,
  capturedAt,
  platform = os.platform(),
  execFileSync = defaultExecFileSync
}: ReadMacContactsSnapshotInput): ContactSnapshot {
  ensureDarwin(platform, "Contacts");
  const output = execFileSync("osascript", ["-e", buildContactsAppleScript()], { encoding: "utf8" });
  return parseMacContactsSnapshotOutput({ userId, capturedAt, output });
}

/**
 * Reads macOS Calendar events overlapping the requested window.
 *
 * Requires darwin and Calendar permission; call only from explicit local-check CLI flows.
 */
export function readMacCalendarEvents({
  userId,
  windowStart,
  windowEnd,
  platform = os.platform(),
  execFileSync = defaultExecFileSync
}: ReadMacCalendarEventsInput): CalendarEvent[] {
  ensureDarwin(platform, "Calendar");
  const output = execFileSync("osascript", ["-e", buildCalendarAppleScript(windowStart, windowEnd)], { encoding: "utf8" });
  return parseMacCalendarEventsOutput({ userId, output });
}

function ensureDarwin(platform: NodeJS.Platform, appName: "Contacts" | "Calendar"): void {
  // Real macOS provider access is gated to darwin so tests and CI stay fixture-only.
  if (platform !== "darwin") {
    throw new Error(`macOS ${appName} local check is only available on darwin.`);
  }
}

function parseRows(output: string): string[][] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("\t"));
}

function splitList(value = ""): string[] {
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildContactsAppleScript(): string {
  return [
    'tell application "Contacts"',
    "set outputRows to {}",
    "repeat with targetPerson in people",
    "set phoneValues to {}",
    "repeat with targetPhone in phones of targetPerson",
    "set end of phoneValues to value of targetPhone as text",
    "end repeat",
    "set emailValues to {}",
    "repeat with targetEmail in emails of targetPerson",
    "set end of emailValues to value of targetEmail as text",
    "end repeat",
    "set rowParts to {id of targetPerson as text, name of targetPerson as text, my joinList(phoneValues, \"|\"), my joinList(emailValues, \"|\"), my isoDate(modification date of targetPerson)}",
    "set end of outputRows to my joinList(rowParts, tab)",
    "end repeat",
    "return my joinList(outputRows, linefeed)",
    "end tell",
    commonAppleScriptHandlers()
  ].join("\n");
}

function buildCalendarAppleScript(windowStartIso: string, windowEndIso: string): string {
  const start = dateParts(windowStartIso);
  const end = dateParts(windowEndIso);

  return [
    ...appleScriptDateAssignment("windowStart", start),
    ...appleScriptDateAssignment("windowEnd", end),
    'tell application "Calendar"',
    "set outputRows to {}",
    "repeat with targetCalendar in calendars",
    "repeat with targetEvent in events of targetCalendar",
    "set eventStart to start date of targetEvent",
    "set eventEnd to end date of targetEvent",
    "if eventStart <= windowEnd and eventEnd >= windowStart then",
    "set eventKind to \"short\"",
    "if allday event of targetEvent is true then set eventKind to \"all_day\"",
    "set durationSeconds to eventEnd - eventStart",
    "if durationSeconds >= 86400 then set eventKind to \"long\"",
    "set eventLocation to \"\"",
    "try",
    "set eventLocation to location of targetEvent as text",
    "end try",
    "set rowParts to {uid of targetEvent as text, summary of targetEvent as text, my isoDate(eventStart), my isoDate(eventEnd), system attribute \"TZ\", eventLocation, eventKind}",
    "set end of outputRows to my joinList(rowParts, tab)",
    "end if",
    "end repeat",
    "end repeat",
    "return my joinList(outputRows, linefeed)",
    "end tell",
    commonAppleScriptHandlers()
  ].join("\n");
}

function appleScriptDateAssignment(variableName: string, parts: DateParts): string[] {
  return [
    `set ${variableName} to current date`,
    `set year of ${variableName} to ${parts.year}`,
    `set month of ${variableName} to ${parts.month}`,
    `set day of ${variableName} to ${parts.day}`,
    `set hours of ${variableName} to ${parts.hour}`,
    `set minutes of ${variableName} to ${parts.minute}`,
    `set seconds of ${variableName} to ${parts.second}`
  ];
}

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function dateParts(value: string): DateParts {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date for macOS Calendar local check: ${value}`);
  }

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds()
  };
}

function commonAppleScriptHandlers(): string {
  return [
    "on joinList(itemsToJoin, delimiter)",
    "set oldDelimiters to AppleScript's text item delimiters",
    "set AppleScript's text item delimiters to delimiter",
    "set joinedText to itemsToJoin as text",
    "set AppleScript's text item delimiters to oldDelimiters",
    "return joinedText",
    "end joinList",
    "on isoDate(targetDate)",
    "set y to year of targetDate as integer",
    "set m to month of targetDate as integer",
    "set d to day of targetDate as integer",
    "set h to hours of targetDate as integer",
    "set minValue to minutes of targetDate as integer",
    "set s to seconds of targetDate as integer",
    "return y & \"-\" & my pad2(m) & \"-\" & my pad2(d) & \"T\" & my pad2(h) & \":\" & my pad2(minValue) & \":\" & my pad2(s)",
    "end isoDate",
    "on pad2(valueToPad)",
    "if valueToPad < 10 then return \"0\" & valueToPad",
    "return valueToPad as text",
    "end pad2"
  ].join("\n");
}
