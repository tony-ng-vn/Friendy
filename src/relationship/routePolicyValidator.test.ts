import { describe, expect, it } from "vitest";
import { shouldSuppressPendingReminder, validateRoutePolicy } from "./routePolicyValidator";
import type { MessageInterpretation } from "./interpretation";
import type { ConversationState } from "./conversationState";

const emptyState: ConversationState = { pendingContactQueue: [] };

function route(intent: MessageInterpretation["intent"], extra: Partial<MessageInterpretation> = {}): MessageInterpretation {
  return {
    intent,
    confidence: 0.9,
    domain: "relationship_memory",
    people: [],
    event: { name: "", dateText: "", location: "" },
    dateContext: undefined,
    contextNote: "",
    query: "",
    tags: [],
    needsClarification: false,
    clarificationQuestion: "",
    ...extra
  };
}

describe("route policy validator", () => {
  it("suppresses pending reminders for list and meta intents", () => {
    expect(shouldSuppressPendingReminder("list_people")).toBe(true);
    expect(shouldSuppressPendingReminder("duplicate_audit")).toBe(true);
    expect(shouldSuppressPendingReminder("explain_agent_state")).toBe(true);
    expect(shouldSuppressPendingReminder("conversation_repair")).toBe(true);
    expect(shouldSuppressPendingReminder("delete_memory_request")).toBe(true);
    expect(shouldSuppressPendingReminder("search_memory")).toBe(false);
  });

  it("allows duplicate_audit without pending frame", () => {
    const decision = validateRoutePolicy(route("duplicate_audit"), emptyState);
    expect(decision).toMatchObject({ decision: "allow", suppressPendingReminder: true });
  });

  it("keeps suppressPendingReminder only as compatibility metadata", () => {
    const decision = validateRoutePolicy(
      route("search_memory", {
        query: "Photon",
        search: {
          mode: "event_recall",
          semanticQuery: "people met at Photon",
          exactTerms: ["photon"],
          filters: { eventName: "Photon" },
          topK: 10
        }
      }),
      emptyState
    );

    expect(decision).toMatchObject({ decision: "allow", suppressPendingReminder: false });
  });

  it("allows explain_agent_state when pending frame exists", () => {
    const state: ConversationState = {
      activeFrame: {
        type: "pending_contact_context",
        frameId: "frame_1",
        userId: "user_1",
        candidateId: "candidate_testing_3",
        displayName: "Testing 3",
        openedAt: "2026-05-23T12:00:00.000Z",
        lastFriendyPrompt: "I noticed you added Testing 3. Where did you meet them?",
        expectedInput: "any_useful_relationship_context",
        priority: "high",
        status: "active"
      },
      pendingContactQueue: [{ candidateId: "candidate_testing_3", displayName: "Testing 3", status: "prompted" }]
    };

    const decision = validateRoutePolicy(route("explain_agent_state"), state);
    expect(decision).toMatchObject({ decision: "allow", suppressPendingReminder: true });
  });
});
