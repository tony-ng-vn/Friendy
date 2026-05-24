import { isBroadPeopleInventoryRequest, isEventRecallQuestion, isListPeopleRecall } from "./listPeopleRecall";

export type DeterministicRelationshipRoute =
  | { kind: "list_people"; reason: "broad_people_inventory" }
  | { kind: "delete_all_memories"; reason: "bulk_delete_confirmation" }
  | { kind: "safe_workflow_reply"; reason: "active_workflow_reply" };

export type DeterministicRelationshipRouteInput = {
  text: string;
  hasActiveMemoryWorkflow?: boolean;
};

/** Routes only small deterministic safety cases that should not depend on model interpretation. */
export function routeDeterministicRelationshipRequest({
  text,
  hasActiveMemoryWorkflow = false
}: DeterministicRelationshipRouteInput): DeterministicRelationshipRoute | undefined {
  if (hasActiveMemoryWorkflow && isSafeWorkflowReply(text)) {
    return { kind: "safe_workflow_reply", reason: "active_workflow_reply" };
  }

  if (isBulkDeleteMemoryRequest(text)) {
    return { kind: "delete_all_memories", reason: "bulk_delete_confirmation" };
  }

  if (isListPeopleRecall(text) && isBroadPeopleInventoryRequest(text) && !isEventRecallQuestion(text)) {
    return { kind: "list_people", reason: "broad_people_inventory" };
  }

  return undefined;
}

export function isBulkDeleteMemoryRequest(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/\bu\b/g, "you")
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ");

  return (
    /\b(delete|remove|forget|clear)\b/.test(normalized) &&
    /\b(everyone|everybody|all people|all contacts|all memories)\b/.test(normalized)
  );
}

function isSafeWorkflowReply(text: string): boolean {
  return /^(?:yes|yep|yeah|confirm|no|nope|cancel|cancel it|never mind|nevermind|stop|don't|do not)$/iu.test(
    text.trim()
  );
}
