import { describe, expect, it } from "vitest";
import {
  buildSearchQueryFromInterpretation,
  messageInterpretationJsonSchema,
  validateMessageInterpretation
} from "./interpretation";

describe("message interpretation contract", () => {
  it("validates a capture-memory interpretation for the Amaya example", () => {
    const interpretation = validateMessageInterpretation({
      intent: "capture_memory",
      confidence: 0.89,
      people: [
        {
          name: "Amaya",
          aliases: []
        }
      ],
      event: {
        name: "Photon Residency II"
      },
      contextNote: "Met Amaya at Photon Residency II and shared a bed because beds ran out.",
      query: "",
      tags: ["Photon Residency II", "shared bed"],
      needsClarification: false,
      clarificationQuestion: ""
    });

    expect(interpretation.intent).toBe("capture_memory");
    expect(interpretation.people[0].name).toBe("Amaya");
    expect(interpretation.event?.name).toBe("Photon Residency II");
  });

  it("validates a capture-memory interpretation with aliases and project details", () => {
    const interpretation = validateMessageInterpretation({
      intent: "capture_memory",
      confidence: 0.92,
      people: [
        {
          name: "Zhiyuan",
          aliases: ["Zed"],
          companyOrSchool: "CMU",
          classYear: "2028",
          project:
            "Swift project that lets users control their computer through their phone with a clicky UI"
        }
      ],
      event: {
        name: "Photon Residency II"
      },
      contextNote:
        "Met Zhiyuan, also called Zed, at the residency. He goes to CMU class 2028 and is making a Swift project similar to Wispr Flow.",
      query: "",
      tags: ["CMU", "Swift", "computer control", "Wispr Flow"],
      needsClarification: false,
      clarificationQuestion: ""
    });

    expect(interpretation.people[0].aliases).toContain("Zed");
    expect(interpretation.people[0].companyOrSchool).toBe("CMU");
    expect(interpretation.tags).toContain("Swift");
  });

  it("validates a search-memory interpretation and builds an executable search query", () => {
    const interpretation = validateMessageInterpretation({
      intent: "search_memory",
      confidence: 0.84,
      people: [],
      event: {
        name: "Residency"
      },
      contextNote: "",
      query: "people I met at the Residency",
      tags: ["Residency"],
      needsClarification: false,
      clarificationQuestion: ""
    });

    expect(buildSearchQueryFromInterpretation(interpretation)).toBe("people I met at the Residency Residency");
  });

  it("accepts optional route domain and search plan", () => {
    const interpretation = validateMessageInterpretation({
      intent: "search_memory",
      confidence: 0.95,
      domain: "relationship_memory",
      search: {
        mode: "list_related_people",
        semanticQuery: "people or contacts related to Friendy",
        exactTerms: ["friendy"],
        filters: { tags: ["friendy"] },
        topK: 10
      },
      people: [],
      event: { name: "", dateText: "", location: "" },
      dateContext: null,
      contextNote: "",
      query: "Friendy",
      tags: ["friendy"],
      needsClarification: false,
      clarificationQuestion: ""
    });

    expect(interpretation.domain).toBe("relationship_memory");
    expect(interpretation.search?.mode).toBe("list_related_people");
    expect(buildSearchQueryFromInterpretation(interpretation)).toBe("friendy");
  });

  it("accepts nullable dateContext from strict structured model output", () => {
    const interpretation = validateMessageInterpretation({
      intent: "search_memory",
      confidence: 0.8,
      people: [],
      event: { name: "Photon Residency II", dateText: "", location: "" },
      dateContext: null,
      contextNote: "",
      query: "people from Photon Residency II",
      tags: ["Photon", "Residency"],
      needsClarification: false,
      clarificationQuestion: ""
    });

    expect(interpretation.dateContext).toBeUndefined();
  });

  it("accepts nullable search filters from strict structured model output", () => {
    const interpretation = validateMessageInterpretation({
      intent: "clarify",
      confidence: 0.9,
      domain: "relationship_memory",
      conversationRelation: "starts_new_relationship_task",
      target: null,
      extractedContext: "User asks to add that Sarah is also the community lead.",
      search: {
        mode: "lookup_person",
        semanticQuery: "Sarah",
        exactTerms: ["Sarah"],
        filters: null,
        topK: 10
      },
      people: [
        {
          name: "Sarah",
          aliases: [],
          companyOrSchool: "",
          classYear: "",
          project: "",
          role: ""
        }
      ],
      event: { name: "", dateText: "", location: "" },
      dateContext: null,
      contextNote: "Add role: community lead for Sarah.",
      query: "",
      tags: ["community lead", "role"],
      needsClarification: true,
      clarificationQuestion: "Which Sarah do you mean?"
    });

    expect(interpretation.search?.filters).toBeUndefined();
  });

  it("accepts Apple Contact mutation intents with identifier-first payloads", () => {
    const interpretation = validateMessageInterpretation({
      intent: "request_apple_contact_update",
      confidence: 0.93,
      domain: "contact_management",
      conversationRelation: "starts_new_contact_management_task",
      target: {
        appleContactIdentifier: "apple_contact_anna"
      },
      appleContact: {
        id: "apple_contact_anna",
        patch: {
          jobTitle: "Founder",
          emailAddresses: [{ label: "work", value: "anna@example.com" }]
        }
      },
      people: [{ name: "Anna Lee", aliases: [], companyOrSchool: "", classYear: "", project: "", role: "" }],
      event: { name: "", dateText: "", location: "" },
      dateContext: null,
      contextNote: "",
      query: "",
      tags: [],
      needsClarification: false,
      clarificationQuestion: ""
    });

    expect(interpretation.intent).toBe("request_apple_contact_update");
    expect(interpretation.target?.appleContactIdentifier).toBe("apple_contact_anna");
    expect(interpretation.appleContact?.patch?.jobTitle).toBe("Founder");
  });

  it("rejects malformed interpretations before tools execute", () => {
    expect(() =>
      validateMessageInterpretation({
        intent: "capture_memory",
        confidence: 2,
        people: [],
        tags: [],
        needsClarification: false
      })
    ).toThrow("Invalid message interpretation");
  });

  it("exports a strict JSON schema for OpenAI structured outputs", () => {
    expect(messageInterpretationJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
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
    });
  });

  it("accepts search semantic query when top-level query is empty", () => {
    const result = validateMessageInterpretation({
      intent: "search_memory",
      confidence: 0.9,
      domain: "relationship_memory",
      conversationRelation: "starts_new_relationship_task",
      target: null,
      extractedContext: "",
      search: {
        mode: "event_recall",
        semanticQuery: "AI dinner",
        exactTerms: [],
        filters: {
          personName: "",
          eventName: "AI dinner",
          topic: "",
          companyOrSchool: "",
          dateText: "",
          tags: []
        },
        topK: 10
      },
      people: [],
      event: { name: "AI dinner", dateText: "", location: "" },
      dateContext: null,
      contextNote: "",
      query: "",
      tags: [],
      needsClarification: false,
      clarificationQuestion: ""
    });

    expect(result.query).toBe("AI dinner");
  });
});
