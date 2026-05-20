import { z } from "zod";

export const messageInterpretationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: ["capture_memory", "search_memory", "ignore_candidate", "clarify", "unknown"],
      description: "The single action Friendy should take after interpreting the user message."
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Model confidence in the interpretation, from 0 to 1."
    },
    people: {
      type: "array",
      description: "People mentioned by the user. Empty for pure search or clarification messages.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          companyOrSchool: { type: "string" },
          classYear: { type: "string" },
          project: { type: "string" },
          role: { type: "string" }
        },
        required: ["name", "aliases", "companyOrSchool", "classYear", "project", "role"]
      }
    },
    event: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        dateText: { type: "string" },
        location: { type: "string" }
      },
      required: ["name", "dateText", "location"]
    },
    dateContext: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        rawText: { type: "string" },
        localDate: { type: "string" },
        startsAt: { type: "string" },
        endsAt: { type: "string" },
        timezone: { type: "string" }
      },
      required: ["rawText", "localDate", "startsAt", "endsAt", "timezone"]
    },
    contextNote: {
      type: "string",
      description: "Human-readable memory note to save when intent is capture_memory."
    },
    query: {
      type: "string",
      description: "Search query to execute when intent is search_memory."
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Short searchable labels extracted from the message."
    },
    needsClarification: {
      type: "boolean",
      description: "Whether Friendy should ask a follow-up question before executing."
    },
    clarificationQuestion: {
      type: "string",
      description: "Short question to ask when intent is clarify or confidence is low."
    }
  },
  required: [
    "intent",
    "confidence",
    "people",
    "event",
    "dateContext",
    "contextNote",
    "query",
    "tags",
    "needsClarification",
    "clarificationQuestion"
  ]
} as const;

const personInterpretationSchema = z
  .object({
    name: z.string().trim().min(1),
    aliases: z.array(z.string()).default([]),
    companyOrSchool: z.string().optional().default(""),
    classYear: z.string().optional().default(""),
    project: z.string().optional().default(""),
    role: z.string().optional().default("")
  })
  .strict();

const eventInterpretationSchema = z
  .object({
    name: z.string().optional().default(""),
    dateText: z.string().optional().default(""),
    location: z.string().optional().default("")
  })
  .strict();

export const messageInterpretationSchema = z
  .object({
    intent: z.enum(["capture_memory", "search_memory", "ignore_candidate", "clarify", "unknown"]),
    confidence: z.number().min(0).max(1),
    people: z.array(personInterpretationSchema).default([]),
    event: eventInterpretationSchema.default({ name: "", dateText: "", location: "" }),
    dateContext: z
      .object({
        rawText: z.string(),
        localDate: z.string(),
        startsAt: z.string(),
        endsAt: z.string().optional(),
        timezone: z.string()
      })
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    contextNote: z.string().default(""),
    query: z.string().default(""),
    tags: z.array(z.string()).default([]),
    needsClarification: z.boolean(),
    clarificationQuestion: z.string().default("")
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.intent === "capture_memory" && value.people.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "capture_memory requires at least one person"
      });
    }

    if (value.intent === "search_memory" && value.query.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "search_memory requires a query"
      });
    }
  });

export type MessageInterpretation = z.infer<typeof messageInterpretationSchema>;

export function validateMessageInterpretation(value: unknown): MessageInterpretation {
  const parsed = messageInterpretationSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid message interpretation: ${parsed.error.message}`);
  }

  return parsed.data;
}

export function buildSearchQueryFromInterpretation(interpretation: MessageInterpretation): string {
  const seen = new Set<string>();

  return [interpretation.query, interpretation.event.name, ...interpretation.tags]
    .map((part) => part.trim())
    .filter((part) => {
      if (part.length === 0) {
        return false;
      }

      const normalized = part.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return true;
    })
    .join(" ")
}
