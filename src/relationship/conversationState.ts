/**
 * Durable pending-contact conversation state for route policy and router envelopes.
 *
 * Derived from repository candidates — not stored separately. `activeFrame` is the
 * single prompted or sole pending candidate the agent treats as awaiting context.
 */
import type { ContactCandidate } from "./types";

export type ConversationRelation =
  | "answers_open_workflow"
  | "asks_about_open_workflow"
  | "continues_recent_saved_contact"
  | "continues_previous_search"
  | "starts_new_relationship_task"
  | "starts_new_contact_management_task"
  | "starts_new_out_of_scope_task"
  | "unclear";

/** High-priority frame when the user should answer an open pending-contact prompt. */
export type PendingContactContextFrame = {
  type: "pending_contact_context";
  frameId: string;
  userId: string;
  spaceId?: string;
  candidateId: string;
  displayName: string;
  openedAt: string;
  lastFriendyPrompt: string;
  expectedInput: "any_useful_relationship_context";
  priority: "high";
  status: "active";
};

export type PendingContactQueueItem = {
  candidateId: string;
  displayName: string;
  status: ContactCandidate["status"];
};

/** Snapshot of open pending-contact work for a user (and optional messaging space). */
export type ConversationState = {
  activeFrame?: PendingContactContextFrame;
  pendingContactQueue: PendingContactQueueItem[];
};

/**
 * Projects repository pending candidates into route-policy and router-envelope state.
 *
 * Active candidate selection prefers a prompted candidate in the current `spaceId`,
 * then a single global prompted candidate, then a sole pending row.
 */
export function buildConversationState({
  userId,
  spaceId,
  pendingCandidates
}: {
  userId: string;
  spaceId?: string;
  pendingCandidates: ContactCandidate[];
}): ConversationState {
  const activeCandidate = selectActivePendingCandidate(pendingCandidates, spaceId);
  const activeFrame = activeCandidate ? toPendingContactContextFrame(userId, activeCandidate) : undefined;
  const pendingContactQueue = orderPendingQueue(pendingCandidates, activeCandidate).map((candidate) => ({
    candidateId: candidate.id,
    displayName: candidate.displayName,
    status: candidate.status
  }));

  return { activeFrame, pendingContactQueue };
}

function selectActivePendingCandidate(candidates: ContactCandidate[], spaceId?: string): ContactCandidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  const promptedInSpace = candidates
    .filter((candidate) => candidate.status === "prompted" && candidate.promptSpaceId === spaceId)
    .sort(comparePromptedAtDesc);
  if (promptedInSpace.length > 0) {
    return promptedInSpace[0];
  }

  const prompted = candidates.filter((candidate) => candidate.status === "prompted").sort(comparePromptedAtDesc);
  if (prompted.length > 0 && (spaceId === undefined || prompted.length === 1)) {
    return prompted[0];
  }

  return candidates.length === 1 ? candidates[0] : undefined;
}

function toPendingContactContextFrame(userId: string, candidate: ContactCandidate): PendingContactContextFrame {
  return {
    type: "pending_contact_context",
    frameId: `frame_pending_contact_${candidate.id}`,
    userId,
    spaceId: candidate.promptSpaceId,
    candidateId: candidate.id,
    displayName: candidate.displayName,
    openedAt: candidate.promptedAt ?? candidate.detectedAt,
    lastFriendyPrompt: `I noticed you added ${candidate.displayName}. Where did you meet them?`,
    expectedInput: "any_useful_relationship_context",
    priority: "high",
    status: "active"
  };
}

function orderPendingQueue(
  candidates: ContactCandidate[],
  activeCandidate: ContactCandidate | undefined
): ContactCandidate[] {
  const sorted = [...candidates].sort((left, right) => {
    if (left.id === activeCandidate?.id) {
      return -1;
    }

    if (right.id === activeCandidate?.id) {
      return 1;
    }

    return comparePromptedAtDesc(left, right) || left.detectedAt.localeCompare(right.detectedAt);
  });

  return sorted;
}

function comparePromptedAtDesc(left: ContactCandidate, right: ContactCandidate): number {
  return (right.promptedAt ?? "").localeCompare(left.promptedAt ?? "");
}
