import { describe, expect, it } from "vitest";
import { buildRedactedInteractionTrace } from "./runtimeTrace";

describe("redacted runtime trace", () => {
  it("does not leak names, phone numbers, notes, event titles, emails, raw JSON, or raw errors", () => {
    const trace = buildRedactedInteractionTrace({
      inboundText:
        "Actually Maya from Photon Dinner works on recruiting agents and her email is maya@example.com, phone +1 555 123 4567",
      interpretedIntentJson: {
        intent: "capture_memory",
        confidence: 0.9,
        rawName: "Maya",
        rawEvent: "Photon Dinner",
        rawNote: "recruiting agents"
      },
      toolCalls: ["confirm_candidate"],
      outboundText: "Got it, saved Maya from Photon Dinner. I'll remember she works on recruiting agents.",
      candidateIdsTouched: ["candidate_1"],
      memoryIdsTouched: ["memory_1"],
      search: {
        query: "Photon Dinner recruiting agents maya@example.com",
        topMatches: [{ memoryId: "memory_1", score: 12, reasons: ["note matched recruiting agents"] }],
        outcome: "single"
      },
      model: { used: true, provider: "openrouter", modelName: "test-model", fallbackUsed: false },
      errors: ["raw provider error included Maya and Photon Dinner"],
      now: "2026-05-22T12:00:00.000Z"
    });

    const serialized = JSON.stringify(trace);
    expect(trace.candidateIdsTouched).toEqual(["candidate_1"]);
    expect(trace.memoryIdsTouched).toEqual(["memory_1"]);
    expect(trace.createdAt).toBe("2026-05-22T12:00:00.000Z");
    expect(trace.interpretedIntent).toEqual({ intent: "capture_memory", confidence: 0.9 });
    expect(trace.toolCalls).toEqual([{ name: "confirm_candidate", result: "success" }]);
    expect(trace.errors).toEqual(["present"]);
    expect(serialized).not.toContain("Maya");
    expect(serialized).not.toContain("Photon Dinner");
    expect(serialized).not.toContain("recruiting agents");
    expect(serialized).not.toContain("maya@example.com");
    expect(serialized).not.toContain("+1 555 123 4567");
    expect(serialized).not.toContain("raw provider error");
    expect(serialized).not.toContain("rawName");
    expect(serialized).not.toContain("rawNote");
  });

  it("records redacted route policy and tool status", () => {
    const trace = buildRedactedInteractionTrace({
      inboundText: "Anyone in my contacts related to friendy?",
      interpretedIntentJson: {
        intent: "search_memory",
        confidence: 0.95,
        domain: "relationship_memory",
        search: {
          mode: "list_related_people",
          exactTerms: ["friendy"]
        },
        policyDecision: { decision: "allow" },
        normalizedQuery: "friendy"
      },
      toolCalls: ["search_memories"],
      outboundText: "I found Testing 1 and Testing 12.",
      now: "2026-05-22T12:00:00.000Z"
    });

    expect(trace.route).toMatchObject({
      domain: "relationship_memory",
      intent: "search_memory",
      confidence: 0.95,
      searchMode: "list_related_people",
      exactTerms: ["friendy"],
      normalizedQuery: "friendy"
    });
    expect(trace.policy).toEqual({ decision: "allow" });
    expect(trace.tools).toEqual([{ name: "search_memories", status: "called" }]);
  });

  it("records the Friendy trace envelope without leaking raw route text", () => {
    const trace = buildRedactedInteractionTrace({
      inboundText: "She is a community lead at Photon Residency II and her email is sarah@example.com",
      interpretedIntentJson: {
        intent: "capture_pending_contact_context",
        confidence: 1,
        target: {
          frameId: "frame_1",
          candidateId: "candidate_sarah",
          displayName: "Sarah Fan"
        },
        extractedContext: "community lead at Photon Residency II",
        policyDecision: { decision: "allow" }
      },
      toolCalls: ["list_pending_candidates", "confirm_candidate"],
      outboundText: "Got it, saved Sarah Fan.",
      friendyTrace: {
        strictMode: true,
        routeSource: "deterministic",
        fallbackUsed: false,
        route: {
          intent: "capture_pending_contact_context",
          confidence: 1,
          target: {
            frameId: "frame_1",
            candidateId: "candidate_sarah",
            hasDisplayName: true
          }
        },
        policyDecision: "allow",
        activeFrameId: "frame_1",
        activeCandidateId: "candidate_sarah",
        toolCalls: ["list_pending_candidates", "confirm_candidate"]
      },
      now: "2026-05-22T12:00:00.000Z"
    });

    expect(trace.strictMode).toBe(true);
    expect(trace.routeSource).toBe("deterministic");
    expect(trace.fallbackUsed).toBe(false);
    expect(trace.policyDecision).toBe("allow");
    expect(trace.activeFrameId).toBe("frame_1");
    expect(trace.activeCandidateId).toBe("candidate_sarah");
    expect(trace.friendyToolCalls).toEqual(["list_pending_candidates", "confirm_candidate"]);
    expect(JSON.stringify(trace)).not.toContain("Sarah Fan");
    expect(JSON.stringify(trace)).not.toContain("community lead");
    expect(JSON.stringify(trace)).not.toContain("Photon Residency II");
    expect(JSON.stringify(trace)).not.toContain("sarah@example.com");
  });

  it("preserves pending reminder decision metadata without raw text", () => {
    const trace = buildRedactedInteractionTrace({
      inboundText: "Who did I meet at Photon while Sarah Fan is still pending?",
      interpretedIntentJson: {
        intent: "search_memory",
        confidence: 0.94,
        search: {
          mode: "event_recall",
          exactTerms: ["Photon"]
        },
        target: {
          displayName: "Sarah Fan"
        },
        policyDecision: { decision: "allow" }
      },
      toolCalls: ["search_memories"],
      outboundText:
        "You met Maya at Photon Dinner.\n\nPending contact: I still need context for Sarah Fan before I can save them.",
      friendyTrace: {
        strictMode: true,
        routeSource: "deterministic",
        fallbackUsed: false,
        route: {
          intent: "search_memory",
          confidence: 0.94,
          searchMode: "event_recall",
          exactTerms: ["Photon"],
          target: {
            hasDisplayName: true
          }
        },
        policyDecision: "allow",
        suppressedPendingReminder: false,
        pendingReminderDecision: "appended_footer",
        pendingReminderReason: "eligible_search_interrupt",
        toolCalls: ["search_memories"]
      },
      now: "2026-05-22T12:00:00.000Z"
    });

    const serialized = JSON.stringify(trace);
    expect(trace.pendingReminderDecision).toBe("appended_footer");
    expect(trace.pendingReminderReason).toBe("eligible_search_interrupt");
    expect(serialized).not.toContain("Sarah Fan");
    expect(serialized).not.toContain("Maya");
    expect(serialized).not.toContain("Photon Dinner");
    expect(serialized).not.toContain("I still need context");
  });
});
