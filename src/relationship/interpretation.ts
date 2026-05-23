/**
 * LLM interpretation contract: JSON schema, Zod validation, and search-query helpers.
 *
 * The model interprets messy inbound text into structured intent; validated output is
 * consumed by `interpretedAgent` before deterministic tools mutate state. The LLM never
 * writes memories directly. See docs/ai-system-architecture.md.
 */
import { z } from "zod";

/** OpenRouter/structured-output JSON schema for message interpretation. */
export const messageInterpretationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: [
        "capture_memory",
        "capture_pending_contact_context",
        "continue_recent_saved_contact",
        "explain_pending_workflow",
        "list_people",
        "search_memory",
        "manual_memory_create",
        "update_memory",
        "delete_memory",
        "draft_message",
        "request_contact_create",
        "request_contact_edit",
        "request_contact_delete",
        "ignore_candidate",
        "clarify",
        "reject",
        "unknown"
      ],
      description: "The single action Friendy should take after interpreting the user message."
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Model confidence in the interpretation, from 0 to 1."
    },
    domain: {
      type: "string",
      enum: [
        "relationship_memory",
        "relationship_drafting",
        "contact_management",
        "lifecycle_control",
        "general_assistant",
        "unsafe_or_adversarial"
      ],
      description: "High-level route domain for policy validation."
    },
    conversationRelation: {
      type: "string",
      enum: [
        "answers_open_workflow",
        "asks_about_open_workflow",
        "continues_recent_saved_contact",
        "continues_previous_search",
        "starts_new_relationship_task",
        "starts_new_contact_management_task",
        "starts_new_out_of_scope_task",
        "unclear"
      ]
    },
    target: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        frameId: { type: "string" },
        candidateId: { type: "string" },
        memoryId: { type: "string" },
        displayName: { type: "string" }
      }
    },
    extractedContext: {
      type: "string"
    },
    search: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: ["lookup_person", "list_people", "list_related_people", "event_recall", "semantic_recall"]
        },
        semanticQuery: { type: "string" },
        exactTerms: { type: "array", items: { type: "string" } },
        filters: {
          type: ["object", "null"],
          additionalProperties: false,
          properties: {
            personName: { type: "string" },
            eventName: { type: "string" },
            topic: { type: "string" },
            companyOrSchool: { type: "string" },
            dateText: { type: "string" },
            tags: { type: "array", items: { type: "string" } }
          }
        },
        topK: { type: "number", minimum: 1, maximum: 20 }
      },
      required: ["mode", "semanticQuery", "exactTerms"]
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

const routeDomainSchema = z.enum([
  "relationship_memory",
  "relationship_drafting",
  "contact_management",
  "lifecycle_control",
  "general_assistant",
  "unsafe_or_adversarial"
]);

const routeIntentSchema = z.enum([
  "capture_memory",
  "capture_pending_contact_context",
  "continue_recent_saved_contact",
  "explain_pending_workflow",
  "list_people",
  "search_memory",
  "manual_memory_create",
  "update_memory",
  "delete_memory",
  "draft_message",
  "request_contact_create",
  "request_contact_edit",
  "request_contact_delete",
  "ignore_candidate",
  "clarify",
  "reject",
  "unknown"
]);

const conversationRelationSchema = z.enum([
  "answers_open_workflow",
  "asks_about_open_workflow",
  "continues_recent_saved_contact",
  "continues_previous_search",
  "starts_new_relationship_task",
  "starts_new_contact_management_task",
  "starts_new_out_of_scope_task",
  "unclear"
]);

const searchPlanSchema = z
  .object({
    mode: z.enum(["lookup_person", "list_people", "list_related_people", "event_recall", "semantic_recall"]),
    semanticQuery: z.string().default(""),
    exactTerms: z.array(z.string()).default([]),
    filters: z
      .object({
        personName: z.string().optional(),
        eventName: z.string().optional(),
        topic: z.string().optional(),
        companyOrSchool: z.string().optional(),
        dateText: z.string().optional(),
        tags: z.array(z.string()).optional()
      })
      .strict()
      .optional(),
    topK: z.number().int().positive().max(20).optional()
  })
  .strict();

/** Zod schema mirroring `messageInterpretationJsonSchema` for runtime validation. */
export const messageInterpretationSchema = z
  .object({
    intent: routeIntentSchema,
    confidence: z.number().min(0).max(1),
    domain: routeDomainSchema.optional(),
    conversationRelation: conversationRelationSchema.optional(),
    target: z
      .object({
        frameId: z.string().optional(),
        candidateId: z.string().optional(),
        memoryId: z.string().optional(),
        displayName: z.string().optional()
      })
      .strict()
      .nullable()
      .optional(),
    extractedContext: z.string().optional(),
    search: searchPlanSchema.nullable().optional(),
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

/** Runtime-validated interpretation produced by the LLM layer or deterministic fallback. */
export type MessageInterpretation = z.infer<typeof messageInterpretationSchema>;
export type RouteDomain = z.infer<typeof routeDomainSchema>;
export type SearchPlan = z.infer<typeof searchPlanSchema>;

/**
 * Parses and validates raw model output against `messageInterpretationSchema`.
 *
 * @throws When shape or intent-specific invariants fail (e.g. capture without people)
 */
export function validateMessageInterpretation(value: unknown): MessageInterpretation {
  const parsed = messageInterpretationSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid message interpretation: ${parsed.error.message}`);
  }

  return parsed.data;
}

/**
 * Builds a deduplicated search query from interpretation fields for `search_memories`.
 *
 * Combines explicit query, event name, and tags; lowercases for deduplication only.
 */
export function buildSearchQueryFromInterpretation(interpretation: MessageInterpretation): string {
  const seen = new Set<string>();

  return [interpretation.search?.exactTerms ?? [], interpretation.query, interpretation.event.name, ...interpretation.tags]
    .flat()
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
