/**
 * Natural-language date parsing for relationship memories and interpretation.
 *
 * Wraps chrono-node with message `receivedAt` as reference instant. Callers:
 * `openAIInterpreter`, `interpretedAgent`, tests. Do not hand-roll relative-date
 * rules elsewhere — use this module. Output shape aligns with `RelationshipDateContext`.
 */
import * as chrono from "chrono-node";

/** Parsed temporal context storable on memories and interpretation payloads. */
export type TemporalContext = {
  rawText: string;
  localDate: string;
  startsAt: string;
  endsAt?: string;
  timezone: string;
};

/** Reference instant and timezone for anchoring relative phrases ("last Tuesday"). */
type ParseTemporalContextOptions = {
  receivedAt: string;
  timezone?: string;
};

/**
 * Parses natural-language time references against the message timestamp.
 *
 * @param text - User message containing a date phrase
 * @param options.receivedAt - ISO instant used as chrono reference
 * @param options.timezone - IANA timezone for local date extraction (default UTC)
 * @returns Parsed context, or undefined when no complete date is found
 */
export function parseTemporalContext(
  text: string,
  { receivedAt, timezone = "UTC" }: ParseTemporalContextOptions
): TemporalContext | undefined {
  const instant = new Date(receivedAt);
  const timezoneOffset = getTimezoneOffsetMinutes(timezone, instant);
  const [result] = chrono.parse(text, { instant, timezone: timezoneOffset });

  if (!result) {
    return undefined;
  }

  const year = result.start.get("year");
  const month = result.start.get("month");
  const day = result.start.get("day");

  if (!year || !month || !day) {
    return undefined;
  }

  return {
    rawText: result.text,
    localDate: `${year}-${pad2(month)}-${pad2(day)}`,
    startsAt: result.start.date().toISOString(),
    endsAt: result.end?.date().toISOString(),
    timezone
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getTimezoneOffsetMinutes(timezone: string, instant: Date): number {
  if (timezone === "UTC") {
    return 0;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(instant);

  const valueFor = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const localAsUtc = Date.UTC(
    valueFor("year"),
    valueFor("month") - 1,
    valueFor("day"),
    valueFor("hour"),
    valueFor("minute"),
    valueFor("second")
  );

  return Math.round((localAsUtc - instant.getTime()) / 60_000);
}
