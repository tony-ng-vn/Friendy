import * as chrono from "chrono-node";

export type TemporalContext = {
  rawText: string;
  localDate: string;
  startsAt: string;
  endsAt?: string;
  timezone: string;
};

type ParseTemporalContextOptions = {
  receivedAt: string;
  timezone?: string;
};

/**
 * Parses natural-language time references against the message timestamp.
 *
 * chrono-node owns phrase recognition; this wrapper only supplies the reference instant,
 * timezone, and stable storage shape that relationship memories can persist.
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
