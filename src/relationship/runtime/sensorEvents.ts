import { z } from "zod";

export const MACOS_SENSOR_NAME = "macos_contacts_calendar";
export const MACOS_SENSOR_SCHEMA_VERSION = 1;

const permissionStatusSchema = z.enum(["authorized", "denied", "restricted", "notDetermined", "unavailable"]);

const commonEventSchema = z.object({
  schemaVersion: z.literal(MACOS_SENSOR_SCHEMA_VERSION),
  eventId: z.string().min(1),
  type: z.string().min(1),
  sensorName: z.literal(MACOS_SENSOR_NAME),
  sensorVersion: z.string().min(1),
  runId: z.string().min(1),
  deviceId: z.string().min(1),
  emittedAt: z.string().min(1)
});

const contactMethodHintSchema = z.object({
  last4: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  label: z.string().min(1).optional()
});

const contactSchema = z.object({
  stableId: z.string().min(1),
  unifiedStableId: z.string().min(1).optional(),
  containerId: z.string().min(1).optional(),
  displayName: z.string().min(1),
  phoneNumberHashes: z.array(z.string().min(1)).default([]),
  phoneNumberHints: z.array(contactMethodHintSchema).default([]),
  emailHashes: z.array(z.string().min(1)).default([]),
  emailHints: z.array(contactMethodHintSchema).default([])
});

const calendarMatchSchema = z.object({
  eventIdentifier: z.string().min(1).optional(),
  calendarIdentifier: z.string().min(1).optional(),
  title: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  location: z.string().optional(),
  calendarSource: z.string().min(1),
  calendarTitle: z.string().min(1),
  isAllDay: z.boolean(),
  attendeeCount: z.number().int().nonnegative().default(0),
  availability: z.string().optional(),
  status: z.string().optional(),
  isRecurring: z.boolean().default(false)
});

const calendarQuerySchema = z.object({
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  resultCountBeforeLimit: z.number().int().nonnegative(),
  permissionStatus: permissionStatusSchema,
  errorCode: z.string().min(1).optional()
});

const readyEventSchema = commonEventSchema.extend({
  type: z.literal("ready"),
  contactsPermissionStatus: permissionStatusSchema,
  calendarPermissionStatus: permissionStatusSchema,
  baselineCreated: z.boolean()
});

const contactAddedEventSchema = commonEventSchema.extend({
  type: z.literal("contact_added"),
  observedAt: z.string().min(1),
  idempotencyKey: z.string().min(1),
  historyBatchId: z.string().min(1),
  historyBatchIndex: z.number().int().nonnegative(),
  historyBatchSize: z.number().int().positive(),
  historyTokenBeforeRef: z.string().min(1),
  historyTokenAfterRef: z.string().min(1),
  detectedAt: z.string().min(1),
  contact: contactSchema,
  calendarQuery: calendarQuerySchema,
  calendarMatches: z.array(calendarMatchSchema).default([])
});

const historyBatchCompleteEventSchema = commonEventSchema.extend({
  type: z.literal("history_batch_complete"),
  historyBatchId: z.string().min(1),
  contactEventIds: z.array(z.string().min(1)),
  ackPath: z.string().min(1)
});

const historyResetEventSchema = commonEventSchema.extend({
  type: z.literal("history_reset"),
  idempotencyKey: z.string().min(1),
  reason: z.string().min(1),
  detectedAt: z.string().min(1)
});

const permissionErrorEventSchema = commonEventSchema.extend({
  type: z.literal("permission_error"),
  idempotencyKey: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean()
});

const fatalErrorEventSchema = commonEventSchema.extend({
  type: z.literal("fatal_error"),
  idempotencyKey: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean()
});

const sensorEventSchema = z.discriminatedUnion("type", [
  readyEventSchema,
  contactAddedEventSchema,
  historyBatchCompleteEventSchema,
  historyResetEventSchema,
  permissionErrorEventSchema,
  fatalErrorEventSchema
]);

export type MacosPermissionStatus = z.infer<typeof permissionStatusSchema>;
export type MacosContactPayload = z.infer<typeof contactSchema>;
export type MacosCalendarMatch = z.infer<typeof calendarMatchSchema>;
export type MacosSensorEvent = z.infer<typeof sensorEventSchema>;
export type MacosContactAddedEvent = Extract<MacosSensorEvent, { type: "contact_added" }>;

export function parseSensorEventLine(line: string): MacosSensorEvent {
  const parsed = parseJsonObject(line);
  assertCommonContract(parsed);
  assertNoRawContactMethods(parsed);

  const result = sensorEventSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid macOS sensor event: ${z.prettifyError(result.error)}`);
  }

  return result.data;
}

function parseJsonObject(line: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("sensor event must be a JSON object");
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Malformed sensor JSON: ${error.message}`);
    }
    throw error;
  }
}

function assertCommonContract(payload: Record<string, unknown>): void {
  if (payload.schemaVersion !== MACOS_SENSOR_SCHEMA_VERSION) {
    throw new Error(`Invalid macOS sensor event: schemaVersion must be ${MACOS_SENSOR_SCHEMA_VERSION}`);
  }

  if (payload.sensorName !== MACOS_SENSOR_NAME) {
    throw new Error(`Invalid macOS sensor event: sensorName must be ${MACOS_SENSOR_NAME}`);
  }
}

function assertNoRawContactMethods(payload: Record<string, unknown>): void {
  if (payload.type !== "contact_added" || !isRecord(payload.contact)) {
    return;
  }

  const forbiddenKeys = ["phoneNumbers", "emails", "phoneNumber", "email"];
  const present = forbiddenKeys.filter((key) => Object.prototype.hasOwnProperty.call(payload.contact, key));
  if (present.length > 0) {
    throw new Error(`Invalid macOS sensor event: raw contact method fields are not allowed (${present.join(", ")})`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
