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

  it("exports a strict JSON schema for OpenRouter structured outputs", () => {
    expect(messageInterpretationJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: [
        "intent",
        "confidence",
        "domain",
        "conversationRelation",
        "target",
        "extractedContext",
        "search",
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
});
