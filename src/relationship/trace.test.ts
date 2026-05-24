import { describe, expect, it } from "vitest";
import { createFriendyTrace, extractFriendyTrace } from "./trace";

describe("createFriendyTrace", () => {
  it("records scope-boundary routing without model fields", () => {
    const trace = createFriendyTrace({
      strictMode: true,
      routeSource: "scope_boundary",
      scopeDecision: "out_of_scope",
      activeWorkflowKind: "duplicate_resolution",
      toolCalls: []
    });

    expect(trace.routeSource).toBe("scope_boundary");
    expect(trace.scopeDecision).toBe("out_of_scope");
    expect(trace.activeWorkflowKind).toBe("duplicate_resolution");
    expect(trace.fallbackUsed).toBe(false);
    expect(trace.modelRequested).toBeUndefined();
    expect(trace.modelResponseSchemaValid).toBeUndefined();
    expect(trace.modelErrorCode).toBeUndefined();
  });

  it("records OpenRouter model metadata on llm routes", () => {
    const trace = createFriendyTrace({
      strictMode: true,
      routeSource: "llm",
      modelRequested: "openrouter/google/gemini-2.5-flash-preview",
      modelResponseSchemaValid: true,
      selectedTool: "list_people",
      toolCalls: ["list_people"]
    });

    expect(trace.modelRequested).toBe("openrouter/google/gemini-2.5-flash-preview");
    expect(trace.modelResponseSchemaValid).toBe(true);
    expect(trace.selectedTool).toBe("list_people");
    expect(trace.fallbackUsed).toBe(false);
  });

  it("records model error metadata on strict failure paths", () => {
    const trace = createFriendyTrace({
      strictMode: true,
      routeSource: "fallback",
      fallbackUsed: true,
      fallbackReason: "invalid_route_schema",
      modelRequested: "openrouter/google/gemini-2.5-flash-preview",
      modelResponseSchemaValid: false,
      modelErrorCode: "INVALID_ROUTE_SCHEMA",
      toolCalls: []
    });

    expect(trace.modelResponseSchemaValid).toBe(false);
    expect(trace.modelErrorCode).toBe("INVALID_ROUTE_SCHEMA");
    expect(trace.fallbackUsed).toBe(true);
  });

  it("defaults fallbackUsed to true only for fallback route source", () => {
    expect(createFriendyTrace({ strictMode: false, routeSource: "fallback", toolCalls: [] }).fallbackUsed).toBe(true);
    expect(createFriendyTrace({ strictMode: true, routeSource: "llm", toolCalls: [] }).fallbackUsed).toBe(false);
    expect(
      createFriendyTrace({ strictMode: true, routeSource: "scope_boundary", toolCalls: [] }).fallbackUsed
    ).toBe(false);
  });

  it("omits optional delta fields when not provided", () => {
    const trace = createFriendyTrace({
      strictMode: false,
      routeSource: "deterministic",
      toolCalls: []
    });

    expect(trace.scopeDecision).toBeUndefined();
    expect(trace.activeWorkflowKind).toBeUndefined();
    expect(trace.selectedTool).toBeUndefined();
    expect(trace.modelRequested).toBeUndefined();
    expect(trace.modelResponseSchemaValid).toBeUndefined();
    expect(trace.modelErrorCode).toBeUndefined();
  });
});

describe("extractFriendyTrace", () => {
  it("returns embedded trace with scope_boundary route source", () => {
    const embedded = {
      trace: createFriendyTrace({
        strictMode: true,
        routeSource: "scope_boundary",
        scopeDecision: "clarify",
        activeWorkflowKind: "pending_contact_confirm",
        toolCalls: []
      })
    };

    expect(extractFriendyTrace(embedded)).toEqual(embedded.trace);
  });

  it("returns deterministic defaults when trace is missing", () => {
    expect(extractFriendyTrace({})).toEqual({
      strictMode: false,
      routeSource: "deterministic",
      fallbackUsed: false,
      route: undefined,
      policyDecision: undefined,
      suppressedPendingReminder: undefined,
      activeFrameId: undefined,
      activeCandidateId: undefined,
      activeMemoryId: undefined,
      toolCalls: [],
      scopeDecision: undefined,
      activeWorkflowKind: undefined,
      selectedTool: undefined,
      modelRequested: undefined,
      modelResponseSchemaValid: undefined,
      modelErrorCode: undefined
    });
  });
});
