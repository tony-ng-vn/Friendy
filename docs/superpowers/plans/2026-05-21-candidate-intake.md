# Candidate Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deep Candidate Intake module that owns the detected-contact pending-candidate lifecycle without changing Friendy's product behavior.

**Architecture:** Candidate Intake is the seam between Contact Signals and Pending Candidates. It should orchestrate existing deterministic tools, reuse `candidateConfirmation.ts` for confirmation parsing, and return structured outcomes that `responseComposer` can turn into user-facing wording later.

**Tech Stack:** TypeScript, Vitest, existing `src/relationship` repository/tools/types modules.

---

## File Structure

- Create: `src/relationship/candidateIntake.ts`
  - Owns `createCandidateIntake`.
  - Exposes `createReviewableCandidates`, `resolveCandidateReply`, and `ignoreCandidate`.
  - Uses existing tools for mutations.
  - Reuses `resolveCandidateConfirmation` from `candidateConfirmation.ts`.
- Modify: `src/relationship/agentCore.ts`
  - Replace inline pending-candidate confirmation and ignore orchestration with Candidate Intake calls.
- Modify: `src/relationship/interpretedAgent.ts`
  - Replace duplicated pending-candidate confirmation and ignore orchestration with Candidate Intake calls.
- Modify: `src/relationship/responseComposer.ts`
  - Add composition helpers only if needed for structured Candidate Intake outcomes.
- Test: `src/relationship/candidateIntake.test.ts`
  - Red spec already describes the intended interface.
- Keep unchanged: Spectrum transport behavior, npm scripts, durable storage, UI, and manual memory capture behavior.

## Task 1: Implement Candidate Intake Red Spec

**Files:**
- Create: `src/relationship/candidateIntake.ts`
- Test: `src/relationship/candidateIntake.test.ts`

- [ ] **Step 1: Confirm the red spec fails for the intended reason**

Run:

```bash
npm test -- src/relationship/candidateIntake.test.ts
```

Expected: five tests fail with `Cannot find module './candidateIntake'`.

- [ ] **Step 2: Create the module with the public interface**

Create `src/relationship/candidateIntake.ts`:

```ts
import { resolveCandidateConfirmation } from "./candidateConfirmation";
import type { createRelationshipTools } from "./tools";
import type { CalendarEvent, ContactCandidate, ContactCandidateDetected, EventContextMatch, RelationshipMemory } from "./types";

type RelationshipTools = ReturnType<typeof createRelationshipTools>;

export type CandidateIntakeScope = {
  userId: string;
  spaceId?: string;
};

export type CandidateReviewPrompt = {
  kind: "candidate_review";
  candidateId: string;
  displayName: string;
  eventGuess?: {
    eventId: string;
    title: string;
    confidence: number;
    rank: number;
  };
};

export type CandidateIntakeCreateResult = {
  kind: "reviewable_candidates_created";
  candidates: Array<Pick<ContactCandidate, "id" | "displayName" | "status">>;
  reviewPrompts: CandidateReviewPrompt[];
};

export type CandidateReplyResult =
  | { kind: "confirmed"; candidateId: string; memory: RelationshipMemory }
  | { kind: "ambiguous"; candidates: Array<Pick<ContactCandidate, "id" | "displayName">> }
  | { kind: "no_pending" };

export type CandidateIgnoreResult =
  | { kind: "ignored"; candidateId: string; displayName: string }
  | { kind: "no_pending" };

export function createCandidateIntake({ tools }: { tools: RelationshipTools }) {
  return {
    createReviewableCandidates(input: {
      scope: CandidateIntakeScope;
      detectedContacts: ContactCandidateDetected[];
      calendarEvents: CalendarEvent[];
    }): CandidateIntakeCreateResult {
      tools.sync_calendar_events(input.scope.userId, input.calendarEvents);
      const candidates = input.detectedContacts.map((contact) => tools.create_contact_candidate(contact));
      const reviewPrompts = candidates.map((candidate) => {
        const [bestMatch] = tools.list_candidate_event_matches(input.scope.userId, candidate.id);
        return toReviewPrompt(candidate, bestMatch);
      });
      return {
        kind: "reviewable_candidates_created",
        candidates: candidates.map(({ id, displayName, status }) => ({ id, displayName, status })),
        reviewPrompts
      };
    },

    resolveCandidateReply(input: { scope: CandidateIntakeScope; replyText: string }): CandidateReplyResult {
      const candidates = tools.list_pending_candidates(input.scope.userId);
      if (candidates.length === 0) {
        return { kind: "no_pending" };
      }
      const selected = selectCandidate(candidates, input.replyText);
      if (!selected && candidates.length > 1) {
        return {
          kind: "ambiguous",
          candidates: candidates.map(({ id, displayName }) => ({ id, displayName }))
        };
      }
      const candidate = selected ?? candidates[0];
      const eventMatches = tools.list_candidate_event_matches(input.scope.userId, candidate.id);
      const confirmation = resolveCandidateConfirmation(input.replyText, eventMatches);
      const memory = tools.confirm_candidate(input.scope.userId, candidate.id, confirmation.contextNote, confirmation.eventId, {
        eventTitle: confirmation.eventTitle,
        relationshipContext: confirmation.relationshipContext
      });
      return { kind: "confirmed", candidateId: candidate.id, memory };
    },

    ignoreCandidate(input: { scope: CandidateIntakeScope; candidateId?: string; candidateName?: string }): CandidateIgnoreResult {
      const candidates = tools.list_pending_candidates(input.scope.userId);
      const candidate = input.candidateId
        ? candidates.find((item) => item.id === input.candidateId)
        : selectCandidate(candidates, input.candidateName ?? "") ?? candidates[0];
      if (!candidate) {
        return { kind: "no_pending" };
      }
      tools.ignore_candidate(input.scope.userId, candidate.id);
      return { kind: "ignored", candidateId: candidate.id, displayName: candidate.displayName };
    }
  };
}

function toReviewPrompt(candidate: ContactCandidate, match?: EventContextMatch): CandidateReviewPrompt {
  return {
    kind: "candidate_review",
    candidateId: candidate.id,
    displayName: candidate.displayName,
    eventGuess: match
      ? {
          eventId: match.calendarEventId,
          title: match.eventTitle,
          confidence: match.confidence,
          rank: match.rank
        }
      : undefined
  };
}

function selectCandidate(candidates: ContactCandidate[], text: string): ContactCandidate | undefined {
  const normalized = text.toLowerCase();
  return candidates.find((candidate) => normalized.includes(candidate.displayName.toLowerCase().split(/\s+/)[0]));
}
```

- [ ] **Step 3: Run the Candidate Intake test**

Run:

```bash
npm test -- src/relationship/candidateIntake.test.ts
```

Expected: Candidate Intake tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/relationship/candidateIntake.ts src/relationship/candidateIntake.test.ts
git commit -m "feat:add candidate intake module"
```

## Task 2: Replace Agent Confirmation Duplication

**Files:**
- Modify: `src/relationship/agentCore.ts`
- Modify: `src/relationship/interpretedAgent.ts`
- Test: `src/relationship/agentCore.test.ts`
- Test: `src/relationship/interpretedAgent.test.ts`

- [ ] **Step 1: Run current agent tests before editing**

Run:

```bash
npm test -- src/relationship/agentCore.test.ts src/relationship/interpretedAgent.test.ts
```

Expected: both files pass before refactor.

- [ ] **Step 2: Inject Candidate Intake into the agents**

Use `createCandidateIntake({ tools })` inside both agents. Confirmation branches should call `resolveCandidateReply`; ignore branches should call `ignoreCandidate`. Preserve existing reply text by mapping structured outcomes to existing response composer functions and current fallback strings.

- [ ] **Step 3: Run focused regression tests**

Run:

```bash
npm test -- src/relationship/agentCore.test.ts src/relationship/interpretedAgent.test.ts src/relationship/candidateIntake.test.ts
```

Expected: all three files pass.

- [ ] **Step 4: Commit**

```bash
git add src/relationship/agentCore.ts src/relationship/interpretedAgent.ts src/relationship/candidateIntake.ts src/relationship/candidateIntake.test.ts
git commit -m "refactor:route candidate confirmation through intake"
```

## Task 3: Verify Behavior Preservation

**Files:**
- No planned source edits.

- [ ] **Step 1: Run full required checks**

Run:

```bash
npm test
npm run build
npm run eval:agent
npm run check:imessage-e2e
npm run ingest:check
npm run ingest:local:check -- --mock
```

Expected: all pass with the same public command behavior.

- [ ] **Step 2: Record implementation notes**

Append verification and any tradeoffs to `docs/goals/EXPERIMENTS.md` or `docs/goals/EXPERIMENT_NOTES.md`.

- [ ] **Step 3: Commit verification notes**

```bash
git add docs/goals/EXPERIMENTS.md docs/goals/EXPERIMENT_NOTES.md
git commit -m "docs:record candidate intake verification"
```

## Self-Review

- Spec coverage: the plan covers Candidate Intake, Pending Candidate lifecycle, Review Prompt data, ambiguity handling, name-fragment confirmation, ignore/no-pending outcomes, and behavior preservation.
- Placeholder scan: none found.
- Type consistency: public names match the red spec in `src/relationship/candidateIntake.test.ts`.
