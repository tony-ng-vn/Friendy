import { describe, expect, it } from "vitest";
import { decidePendingReminder, type PendingReminderContext } from "./pendingReminderPolicy";

const baseContext = (overrides: Partial<PendingReminderContext> = {}): PendingReminderContext => ({
  userText: "Who did I meet at Photon?",
  userIntent: "search_memory",
  searchMode: "event_recall",
  responseKind: "search_result",
  now: "2026-05-20T12:00:00.000Z",
  activeWorkflow: {
    kind: "pending_contact_confirmation",
    frameId: "frame_pending_contact_sarah",
    candidateId: "candidate_sarah",
    displayName: "Sarah Fan",
    lastFriendyPrompt: "I noticed you added Sarah Fan. Where did you meet them?"
  },
  pendingCandidates: [{ candidateId: "candidate_sarah", displayName: "Sarah Fan", status: "prompted" }],
  savedMemoriesForActiveName: [],
  duplicateRisk: false,
  sameNameDisambiguationPending: false,
  listedEntityIds: [],
  reminderState: {},
  ...overrides
});

describe("pending reminder policy", () => {
  it("suppresses when there is no active pending-contact workflow", () => {
    expect(decidePendingReminder(baseContext({ activeWorkflow: undefined }))).toMatchObject({
      action: "suppress",
      reason: "no_active_workflow"
    });
  });

  it("suppresses non-search intents that are not in the never-remind set", () => {
    expect(
      decidePendingReminder(
        baseContext({
          userIntent: "capture_memory",
          responseKind: "capture_context"
        })
      )
    ).toMatchObject({ action: "suppress", reason: "not_search_interrupt" });
  });

  it("suppresses list_people even when a pending contact exists", () => {
    expect(decidePendingReminder(baseContext({ userIntent: "list_people", responseKind: "list_people" }))).toMatchObject({
      action: "suppress",
      reason: "intent_suppressed"
    });
  });

  it("suppresses search_memory when search mode is list_people", () => {
    expect(decidePendingReminder(baseContext({ userIntent: "search_memory", searchMode: "list_people" }))).toMatchObject({
      action: "suppress",
      reason: "list_people_search_mode"
    });
  });

  it("suppresses same-name saved plus pending candidates until same-or-different is resolved", () => {
    expect(
      decidePendingReminder(
        baseContext({
          savedMemoriesForActiveName: [{ memoryId: "memory_testing_3", displayName: "Testing 3" }],
          activeWorkflow: {
            ...baseContext().activeWorkflow!,
            frameId: "frame_pending_contact_testing_3",
            candidateId: "candidate_testing_3",
            displayName: "Testing 3",
            lastFriendyPrompt: "I noticed you added Testing 3. Where did you meet them?"
          },
          pendingCandidates: [{ candidateId: "candidate_testing_3", displayName: "Testing 3", status: "prompted" }],
          duplicateRisk: true,
          sameNameDisambiguationPending: true
        })
      )
    ).toMatchObject({ action: "suppress", reason: "same_name_disambiguation_pending" });
  });

  it("suppresses during complaint cooldown", () => {
    expect(
      decidePendingReminder(
        baseContext({
          reminderState: {
            lastUserComplaintAt: "2026-05-20T11:55:00.000Z"
          }
        })
      )
    ).toMatchObject({ action: "suppress", reason: "complaint_cooldown" });
  });

  it("defers repeated reminders for the same candidate within ttl", () => {
    expect(
      decidePendingReminder(
        baseContext({
          reminderState: {
            lastReminderAt: "2026-05-20T11:55:00.000Z",
            lastRemindedCandidateId: "candidate_sarah"
          }
        })
      )
    ).toMatchObject({ action: "defer", reason: "reminder_ttl" });
  });

  it("appends a footer for eligible search_memory replies", () => {
    expect(decidePendingReminder(baseContext())).toEqual({
      action: "append",
      reason: "eligible_search_interrupt",
      candidates: [{ candidateId: "candidate_sarah", displayName: "Sarah Fan" }]
    });
  });
});
