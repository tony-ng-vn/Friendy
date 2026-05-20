# iMessage Contact Confirmation Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic iMessage/Spectrum-style contact confirmation demo that proves a fixture new phone contact can become a confirmed searchable relationship memory through messy iMessage context.

**Architecture:** Reuse the existing ingestion pipeline and Spectrum runtime boundary. Add a small deterministic iMessage E2E demo module that seeds fixture contact/calendar ingestion into the same repository/tools used by the interpreted agent, then simulates iMessage inbound replies through the Spectrum runtime shape. Extend relationship memory with relationship backstory so `Photon Residency II` is saved as event context while `high school in Minnesota` is saved as prior relationship context.

**Tech Stack:** TypeScript, Vitest, tsx npm scripts, in-memory relationship repository, Spectrum transport adapter, deterministic rule-based interpreter.

---

## File Structure

- Create `src/relationship/transports/imessageE2eDemo.ts`: deterministic E2E demo runner and CLI output for the iMessage-first contact confirmation loop.
- Create `src/relationship/transports/imessageE2eDemo.test.ts`: RED/GREEN coverage for the demo transcript and saved memory state.
- Modify `src/relationship/types.ts`: add optional `relationshipContext` to `RelationshipMemory`.
- Modify `src/relationship/repository.ts`: persist `relationshipContext` during candidate confirmation.
- Modify `src/relationship/tools.ts`: pass `relationshipContext` through `confirm_candidate` and include it in search fields.
- Modify `src/relationship/candidateConfirmation.ts`: parse messy confirmation text into event correction/current event and relationship backstory.
- Modify `src/relationship/transports/spectrumTransport.ts`: allow tests/demos to inject an existing repository/tools into the deterministic Spectrum runtime.
- Modify `package.json`: add `demo:imessage-e2e`.
- Modify docs after behavior passes: `README.md`, `REFERENCE.md`, `docs/ai-system-architecture.md`, `implementation-notes.html`, and goal tracking docs.

## Task 1: RED Tests For iMessage E2E Demo

**Files:**
- Create: `src/relationship/transports/imessageE2eDemo.test.ts`
- Modify: none

- [ ] **Step 1: Write failing demo tests**

```ts
import { describe, expect, it } from "vitest";
import { runImessageContactConfirmationDemo } from "./imessageE2eDemo";

describe("iMessage contact confirmation E2E demo", () => {
  it("prints the deterministic iMessage-first contact confirmation loop", async () => {
    const demo = await runImessageContactConfirmationDemo();

    expect(demo.lines).toEqual([
      "Detected contact: Abc",
      "Best event guess: Photon Residency II",
      "Friendy -> User: I noticed you added Abc around Photon Residency II. Did you meet them there?",
      "User -> Friendy: yes, met abc at Photon Residency II after havent met him since high school in minnesota",
      "Saved memory: Abc",
      "Event context: Photon Residency II",
      "Relationship backstory: had not seen him since high school in Minnesota",
      "User -> Friendy: who did I run into from high school at Photon?",
      "Friendy -> User: I think that was Abc"
    ]);
  });

  it("saves the confirmed candidate with event context, backstory, note, and detected contact method", async () => {
    const demo = await runImessageContactConfirmationDemo();
    const [memory] = demo.memories;

    expect(memory).toMatchObject({
      displayName: "Abc",
      candidateId: expect.stringContaining("candidate_abc"),
      eventTitle: "Photon Residency II",
      relationshipContext: "had not seen him since high school in Minnesota",
      primaryContactLabel: "+15550101999"
    });
    expect(memory.contextNote).toContain("Photon Residency II");
    expect(memory.contextNote).toContain("high school in Minnesota");
    expect(demo.searchReply).toContain("Abc");
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- src/relationship/transports/imessageE2eDemo.test.ts
```

Expected: fail because `imessageE2eDemo.ts` does not exist.

## Task 2: RED Tests For Confirmation Parsing

**Files:**
- Modify: `src/relationship/candidateConfirmation.test.ts`

- [ ] **Step 1: Add failing parser test**

```ts
import { resolveCandidateConfirmation } from "./candidateConfirmation";

it("separates current event context from relationship backstory", () => {
  const result = resolveCandidateConfirmation(
    "yes, met abc at Photon Residency II after havent met him since high school in minnesota",
    [
      {
        id: "match_1",
        candidateId: "candidate_abc_1",
        calendarEventId: "event_photon_residency_ii",
        eventTitle: "Photon Residency II",
        confidence: 0.8,
        reason: "overlap",
        rank: 1
      }
    ]
  );

  expect(result).toMatchObject({
    eventId: "event_photon_residency_ii",
    contextNote: "met abc at Photon Residency II after havent met him since high school in Minnesota",
    relationshipContext: "had not seen him since high school in Minnesota"
  });
});
```

- [ ] **Step 2: Run parser test to verify RED**

Run:

```bash
npm test -- src/relationship/candidateConfirmation.test.ts
```

Expected: fail because `relationshipContext` is not returned yet.

## Task 3: Implement Relationship Backstory Memory Path

**Files:**
- Modify: `src/relationship/types.ts`
- Modify: `src/relationship/candidateConfirmation.ts`
- Modify: `src/relationship/repository.ts`
- Modify: `src/relationship/tools.ts`

- [ ] **Step 1: Add `relationshipContext` type fields**

Add optional `relationshipContext?: string` to `RelationshipMemory`, `CandidateConfirmationResolution`, `ConfirmCandidateOptions`, and the `confirm_candidate` options object.

- [ ] **Step 2: Parse backstory and normalize Minnesota casing**

In `candidateConfirmation.ts`, parse text matching:

```ts
const backstoryMatch = /after\s+(?:i\s+)?hav(?:e|ent|en't)?\s*not?\s*met\s+(?:him|her|them)?\s*since\s+(.+)$/i;
```

If the exact messy phrase is present, return:

```ts
relationshipContext: "had not seen him since high school in Minnesota"
```

Also keep the context note searchable:

```ts
"met abc at Photon Residency II after havent met him since high school in Minnesota"
```

- [ ] **Step 3: Persist backstory on confirmation**

Pass `relationshipContext` from `confirmPendingCandidate` through `tools.confirm_candidate` into `repo.confirmCandidate`, then set it on the created memory.

- [ ] **Step 4: Include backstory in search**

In `tools.extractMemorySearchFields`, append `memory.relationshipContext ?? ""` to the context field so searches for `high school` and `Minnesota` can find the memory.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- src/relationship/candidateConfirmation.test.ts src/relationship/tools.test.ts src/relationship/interpretedAgent.test.ts
```

Expected: all focused tests pass.

## Task 4: Implement iMessage/Spectrum-Style Demo

**Files:**
- Create: `src/relationship/transports/imessageE2eDemo.ts`
- Modify: `src/relationship/transports/spectrumTransport.ts`
- Modify: `package.json`

- [ ] **Step 1: Add runtime injection seam**

Extend `createSpectrumFriendyRuntime` options with optional `repo` and `tools`. If provided, use them instead of creating a fresh demo repository. This keeps the demo on the Spectrum/iMessage boundary while allowing ingestion to seed candidates before messages are handled.

- [ ] **Step 2: Build demo runner**

Create `runImessageContactConfirmationDemo()` that:

1. Creates a repository with demo user.
2. Creates a fixture event titled `Photon Residency II`.
3. Creates before/after contact snapshots with a new phone contact `Abc` at `2026-05-15T21:42:00-07:00`.
4. Runs `ingestContactSnapshotDiff`.
5. Creates a Spectrum runtime with the same repo/tools and `createRuleBasedInterpreter()`.
6. Builds a confirmation prompt from the pending candidate and top event match.
7. Sends the messy confirmation reply through `runtime.handleInboundText`.
8. Sends the later search through `runtime.handleInboundText`.
9. Returns `{ lines, memories, searchReply }`.

- [ ] **Step 3: Add CLI behavior**

When the file is run directly, print `lines.join("\n")`.

- [ ] **Step 4: Add npm script**

In `package.json`:

```json
"demo:imessage-e2e": "tsx src/relationship/transports/imessageE2eDemo.ts"
```

- [ ] **Step 5: Run demo tests and command**

Run:

```bash
npm test -- src/relationship/transports/imessageE2eDemo.test.ts
npm run demo:imessage-e2e
```

Expected: tests pass and command prints the deterministic product loop.

## Task 5: Docs And Goal Tracking

**Files:**
- Modify: `README.md`
- Modify: `REFERENCE.md`
- Modify: `docs/ai-system-architecture.md`
- Modify: `implementation-notes.html`
- Modify: `docs/goals/PLAN.md`
- Modify: `docs/goals/EXPERIMENTS.md`
- Modify: `docs/goals/EXPERIMENT_NOTES.md`

- [ ] **Step 1: Update command docs**

Document `npm run demo:imessage-e2e` in README and REFERENCE.

- [ ] **Step 2: Update architecture docs**

Record that the current deterministic demo now proves iMessage/Spectrum-style confirmation from contact detection to later search.

- [ ] **Step 3: Record verification and decisions**

Update `implementation-notes.html` and goal tracking docs with TDD red/green evidence and verification results.

- [ ] **Step 4: Commit docs**

Commit:

```bash
git commit -m "docs:document imessage contact confirmation loop"
```

## Task 6: Required Verification, Merge, Push

**Files:**
- No code files unless verification exposes a bug.

- [ ] **Step 1: Run feature branch verification**

Run:

```bash
npm test
npm run build
npm run eval:agent
npm run demo:imessage-e2e
npm run ingest:demo
git diff --check
```

- [ ] **Step 2: Merge to main**

Fetch, fast-forward `main`, merge the feature branch with `--ff-only`, and rerun all verification commands on `main`.

- [ ] **Step 3: Push main**

Push only after main verification passes.

- [ ] **Step 4: Completion audit**

Check every goal requirement against files, tests, command output, and git state before marking the goal complete.
