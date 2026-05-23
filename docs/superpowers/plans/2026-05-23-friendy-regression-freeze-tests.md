# Friendy Regression Freeze Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tests-only regression coverage for the live duplicate, stale pending prompt, list formatting, conversation repair, fuzzy delete, and same-name pending contact failures.

**Architecture:** This is a RED-only regression freeze. Add eval catalog entries and executable eval cases that encode the expected future contract, but do not implement new tools, routing, repository behavior, or response logic. The focused eval run is expected to fail until a later implementation goal fixes the behavior.

**Tech Stack:** TypeScript, Vitest, existing Friendy relationship-agent eval runner, in-memory relationship repository, interpreted relationship agent.

---

## File Structure

- Modify `src/relationship/evals/agentEvalRunner.ts`
  - Add five required eval case ids to `relationshipAgentEvalCases`.
  - Add five executable eval cases to `executableEvalCases`.
  - Add local assertion helpers for response formatting and stale-reminder checks.
- Modify `src/relationship/evals/agentEvalRunner.test.ts`
  - Add the five ids to the required catalog expectation.
  - Update expected case count from 36 to 41.
  - Keep the full-run test expecting zero failures so the focused test command fails clearly while the five regression gaps remain unfixed.
- Modify `implementation-notes.html`
  - Add a short entry saying this task intentionally added RED regression tests only.
- Modify `docs/goals/EXPERIMENTS.md` and `docs/goals/EXPERIMENT_NOTES.md`
  - Record the RED command and observed failure classes.

## Execution Policy

This plan is tests-only. Do not edit:

- `src/relationship/interpretedAgent.ts`
- `src/relationship/scopeBoundary.ts`
- `src/relationship/tools.ts`
- `src/relationship/repository.ts`
- `src/relationship/sqliteRepository.ts`
- runtime transports
- response composer

If a test cannot be written without changing production behavior, stop and document the missing test seam instead of implementing behavior.

## Task 1: Add Required Eval Catalog Entries

**Files:**
- Modify: `src/relationship/evals/agentEvalRunner.ts`
- Modify: `src/relationship/evals/agentEvalRunner.test.ts`

- [ ] **Step 1: Add five eval cases to the catalog**

In `src/relationship/evals/agentEvalRunner.ts`, append these entries after `strict-mode-fallback-rejection` in `relationshipAgentEvalCases`:

```ts
  evalCase("duplicate-pending-filtered-list-regression", "interpreted", [
    "filtered bullet list uses list_people route",
    "filtered bullet list does not use search fallback",
    "filtered bullet list respects bullet formatting",
    "filtered bullet list suppresses stale pending reminder"
  ]),
  evalCase("duplicate-audit-in-scope-regression", "interpreted", [
    "duplicate audit routes in scope",
    "duplicate audit expects duplicate tool",
    "duplicate audit avoids generic fallback"
  ]),
  evalCase("conversation-repair-pending-vs-saved-regression", "interpreted", [
    "conversation repair routes in scope",
    "conversation repair explains pending versus saved ambiguity",
    "conversation repair does not mutate memory"
  ]),
  evalCase("fuzzy-delete-memory-confirmation-regression", "interpreted", [
    "fuzzy delete routes to delete memory request",
    "fuzzy delete maps Unamed to Unnamed Contact",
    "fuzzy delete asks confirmation before delete",
    "fuzzy delete suppresses stale pending reminder"
  ]),
  evalCase("same-name-pending-contact-disambiguation-regression", "interpreted", [
    "same-name pending context respects active candidate",
    "same-name pending context asks same or different",
    "same-name pending context does not confirm before identity is resolved"
  ])
```

- [ ] **Step 2: Update catalog test ids**

In `src/relationship/evals/agentEvalRunner.test.ts`, append the same ids to `requiredIds` after `"strict-mode-fallback-rejection"`:

```ts
      "strict-mode-fallback-rejection",
      "duplicate-pending-filtered-list-regression",
      "duplicate-audit-in-scope-regression",
      "conversation-repair-pending-vs-saved-regression",
      "fuzzy-delete-memory-confirmation-regression",
      "same-name-pending-contact-disambiguation-regression"
```

Change:

```ts
expect(relationshipAgentEvalCases).toHaveLength(36);
```

to:

```ts
expect(relationshipAgentEvalCases).toHaveLength(41);
```

Change the full eval summary expectations:

```ts
expect(summary.total).toBe(36);
expect(summary.requiredTotal).toBe(36);
```

to:

```ts
expect(summary.total).toBe(41);
expect(summary.requiredTotal).toBe(41);
```

- [ ] **Step 3: Run catalog-only test and confirm it fails for missing executable cases**

Run:

```bash
npm test -- src/relationship/evals/agentEvalRunner.test.ts
```

Expected: FAIL because the catalog now lists cases that do not yet have executable case implementations, or because the full summary expectations see missing/failing cases.

- [ ] **Step 4: Commit catalog RED scaffold**

```bash
git add src/relationship/evals/agentEvalRunner.ts src/relationship/evals/agentEvalRunner.test.ts
git commit -m "test:add regression freeze eval catalog"
```

## Task 2: Add Shared Regression Fixture Helpers

**Files:**
- Modify: `src/relationship/evals/agentEvalRunner.ts`

- [ ] **Step 1: Add fixture helper near existing helper functions**

Add this helper near `createInterpretedHarness`:

```ts
function createTestingFriendyRegressionHarness({
  interpreter,
  now
}: Required<Pick<RunOptions, "interpreter" | "now">>) {
  const repo = createRelationshipRepository({
    users: [fixtureUser],
    memories: [
      memory("memory_testing_1_a", "Testing 1", "Testing Friendy", "testing Friendy"),
      memory("memory_testing_1_b", "Testing 1", "im just testing for friendy at the moment", ""),
      memory("memory_testing_12", "Testing 12", "Met them during testing Friendy", "testing Friendy"),
      memory("memory_testing_3", "Testing 3", "I met testing 3 during testing Friendy", "testing Friendy"),
      memory("memory_unnamed_contact", "Unnamed Contact", "Just give me all the people in my contact so far", "")
    ]
  });
  const tools = createRelationshipTools(repo);
  const pendingTesting3 = tools.create_contact_candidate({
    ...fixtureDetectedContact,
    displayName: "Testing 3",
    contactIdentifier: "contact_testing_3_pending",
    phoneNumbers: ["+15550101903"],
    emails: []
  });
  repo.markCandidatePrompted(pendingTesting3.id, "interaction_prompt_testing_3_regression", {
    spaceId: "imessage_testing_regression",
    promptedAt: "2026-05-20T11:59:00.000Z"
  });
  const agent = createInterpretedRelationshipAgent({ repo, tools, interpreter, now, timezone });

  return { agent, repo, tools, pendingTesting3 };
}
```

- [ ] **Step 2: Add formatting and stale-reminder helper functions**

Add these helpers near `includesAll`:

```ts
function hasBulletFormatting(value: string): boolean {
  return value.split(/\r?\n/).some((line) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(line));
}

function includesStalePendingReminder(value: string, displayName: string): boolean {
  return includesAll(value, ["still need context", displayName]);
}
```

- [ ] **Step 3: Run TypeScript check via focused test**

Run:

```bash
npm test -- src/relationship/evals/agentEvalRunner.test.ts
```

Expected: still FAIL because executable eval cases are not added yet, but no TypeScript parse/type errors from the helper functions.

- [ ] **Step 4: Commit helper scaffold**

```bash
git add src/relationship/evals/agentEvalRunner.ts
git commit -m "test:add Friendy regression fixture helpers"
```

## Task 3: Add Executable RED Eval Cases

**Files:**
- Modify: `src/relationship/evals/agentEvalRunner.ts`

- [ ] **Step 1: Add filtered bullet list regression case**

Append this executable case after the current strict-mode case in `executableEvalCases`:

```ts
  {
    ...relationshipAgentEvalCases[36],
    async run({ interpreter, now }) {
      const { agent } = createTestingFriendyRegressionHarness({ interpreter, now });
      const result = await agent.handleMessage({
        ...interpretedInbound("List me in bullet of all people I met testing friendy"),
        spaceId: "imessage_testing_regression"
      });

      return [
        assertion("filtered bullet list uses list_people route", "intent", result.trace.route?.intent === "list_people"),
        assertion("filtered bullet list does not use search fallback", "intent", !result.toolCalls.includes("search_memories")),
        assertion("filtered bullet list respects bullet formatting", "searchRecall", hasBulletFormatting(result.outbound.text)),
        assertion(
          "filtered bullet list suppresses stale pending reminder",
          "clarification",
          !includesStalePendingReminder(result.outbound.text, "Testing 3")
        )
      ];
    }
  }
```

- [ ] **Step 2: Add duplicate audit regression case**

Append:

```ts
  {
    ...relationshipAgentEvalCases[37],
    async run({ interpreter, now }) {
      const { agent } = createTestingFriendyRegressionHarness({ interpreter, now });
      const result = await agent.handleMessage({
        ...interpretedInbound("Do you see you are having duplicate people in your contacts?"),
        spaceId: "imessage_testing_regression"
      });

      return [
        assertion(
          "duplicate audit routes in scope",
          "scopeBoundary",
          result.trace.route?.domain === "relationship_memory" && result.trace.route?.intent === "duplicate_audit"
        ),
        assertion("duplicate audit expects duplicate tool", "intent", result.toolCalls.includes("find_duplicate_people")),
        assertion(
          "duplicate audit avoids generic fallback",
          "scopeBoundary",
          !result.outbound.text.includes("outside Friendy's relationship-memory scope")
        )
      ];
    }
  }
```

- [ ] **Step 3: Add conversation repair regression case**

Append:

```ts
  {
    ...relationshipAgentEvalCases[38],
    async run({ interpreter, now }) {
      const { agent, repo } = createTestingFriendyRegressionHarness({ interpreter, now });
      const result = await agent.handleMessage({
        ...interpretedInbound("Why u still asking for testing 3 context when u already have it?"),
        spaceId: "imessage_testing_regression"
      });

      return [
        assertion(
          "conversation repair routes in scope",
          "scopeBoundary",
          result.trace.route?.domain === "relationship_memory" &&
            ["explain_agent_state", "conversation_repair"].includes(String(result.trace.route?.intent))
        ),
        assertion(
          "conversation repair explains pending versus saved ambiguity",
          "clarification",
          includesAll(result.outbound.text, ["Testing 3", "pending"]) &&
            includesAny(result.outbound.text, ["saved", "already have", "memory"])
        ),
        assertion(
          "conversation repair does not mutate memory",
          "unsafeMutation",
          !result.toolCalls.includes("confirm_candidate") &&
            !result.toolCalls.includes("delete_memory") &&
            repo.listMemories(fixtureUser.id).length === 5
        )
      ];
    }
  }
```

- [ ] **Step 4: Add fuzzy delete confirmation regression case**

Append:

```ts
  {
    ...relationshipAgentEvalCases[39],
    async run({ interpreter, now }) {
      const { agent, repo } = createTestingFriendyRegressionHarness({ interpreter, now });
      const result = await agent.handleMessage({
        ...interpretedInbound("Can you help me delete Unamed Contact from your memory?"),
        spaceId: "imessage_testing_regression"
      });

      return [
        assertion(
          "fuzzy delete routes to delete memory request",
          "intent",
          ["delete_memory_request", "delete_memory"].includes(String(result.trace.route?.intent))
        ),
        assertion(
          "fuzzy delete maps Unamed to Unnamed Contact",
          "searchRecall",
          result.outbound.text.includes("Unnamed Contact")
        ),
        assertion(
          "fuzzy delete asks confirmation before delete",
          "unsafeMutation",
          !result.toolCalls.includes("delete_memory") &&
            includesAny(result.outbound.text, ["confirm", "delete", "forget"]) &&
            repo.listMemories(fixtureUser.id).some((item) => item.displayName === "Unnamed Contact")
        ),
        assertion(
          "fuzzy delete suppresses stale pending reminder",
          "clarification",
          !includesStalePendingReminder(result.outbound.text, "Testing 3")
        )
      ];
    }
  }
```

- [ ] **Step 5: Add same-name pending disambiguation regression case**

Append:

```ts
  {
    ...relationshipAgentEvalCases[40],
    async run({ interpreter, now }) {
      const { agent, repo, pendingTesting3 } = createTestingFriendyRegressionHarness({ interpreter, now });
      const result = await agent.handleMessage({
        ...interpretedInbound("I met during testing Friendy"),
        spaceId: "imessage_testing_regression"
      });

      return [
        assertion(
          "same-name pending context respects active candidate",
          "intent",
          result.trace.activeCandidateId === pendingTesting3.id ||
            result.trace.route?.target?.candidateId === pendingTesting3.id
        ),
        assertion(
          "same-name pending context asks same or different",
          "clarification",
          includesAll(result.outbound.text, ["Testing 3"]) && includesAny(result.outbound.text, ["same", "different", "duplicate"])
        ),
        assertion(
          "same-name pending context does not confirm before identity is resolved",
          "unsafeMutation",
          !result.toolCalls.includes("confirm_candidate") &&
            repo.listPendingCandidates(fixtureUser.id).some((candidate) => candidate.id === pendingTesting3.id)
        )
      ];
    }
  }
```

- [ ] **Step 6: Run focused eval test and confirm RED failures are meaningful**

Run:

```bash
npm test -- src/relationship/evals/agentEvalRunner.test.ts
```

Expected: FAIL with the five new regression cases failing on missing route/tool/response behavior. The failure must not be a syntax error, import error, or missing array index.

- [ ] **Step 7: Commit executable RED cases**

```bash
git add src/relationship/evals/agentEvalRunner.ts src/relationship/evals/agentEvalRunner.test.ts
git commit -m "test:add Friendy regression freeze cases"
```

## Task 4: Document RED Status

**Files:**
- Modify: `implementation-notes.html`
- Modify: `docs/goals/EXPERIMENTS.md`
- Modify: `docs/goals/EXPERIMENT_NOTES.md`

- [ ] **Step 1: Update implementation notes**

Add this section near the top of `implementation-notes.html`:

```html
    <h2>Friendy Regression Freeze Tests (2026-05-23)</h2>
    <ul>
      <li>Added tests-only eval coverage for five live failure classes: filtered bullet list routing, duplicate audit, conversation repair, fuzzy delete confirmation, and same-name pending contact disambiguation.</li>
      <li>This is intentionally RED coverage. The tests encode expected future behavior and should fail until the follow-up implementation goal adds the required route/tool behavior.</li>
      <li>No production routing, repository, tool, Apple Contacts, retrieval, or response-composition behavior should change in this task.</li>
    </ul>
```

- [ ] **Step 2: Update experiments**

Add this section near the top of `docs/goals/EXPERIMENTS.md`:

```md
# Friendy Regression Freeze Tests

## RED

- Date: 2026-05-23
- Goal source: `docs/superpowers/specs/2026-05-23-friendy-regression-freeze-design.md`.
- Added tests-only eval cases for filtered bullet list routing, duplicate audit, conversation repair, fuzzy delete confirmation, and same-name pending contact disambiguation.
- Focused command: `npm test -- src/relationship/evals/agentEvalRunner.test.ts`.
- Expected status: RED until follow-up implementation adds explicit list/filter routing, duplicate audit tooling, state repair routing, fuzzy delete confirmation, and same-name pending candidate disambiguation.
```

- [ ] **Step 3: Update experiment notes**

Add this section near the top of `docs/goals/EXPERIMENT_NOTES.md`:

```md
# Friendy Regression Freeze Tests Notes

- 2026-05-23: This task is tests-only. The new eval cases are allowed to fail because they freeze live failures before behavior changes.
- 2026-05-23: Do not make production changes in the regression-freeze task. The next implementation goal should make the RED cases pass.
```

- [ ] **Step 4: Run docs whitespace check**

Run:

```bash
git diff --check
```

Expected: PASS with no output.

- [ ] **Step 5: Commit docs**

```bash
git add implementation-notes.html docs/goals/EXPERIMENTS.md docs/goals/EXPERIMENT_NOTES.md
git commit -m "docs:record Friendy regression freeze red status"
```

## Task 5: Final Test-Only Verification

**Files:**
- Read: `src/relationship/evals/agentEvalRunner.ts`
- Read: `src/relationship/evals/agentEvalRunner.test.ts`
- Read: `git status`

- [ ] **Step 1: Verify no production behavior files changed**

Run:

```bash
git diff --name-only HEAD~3..HEAD
```

Expected changed files only include:

```text
docs/goals/EXPERIMENTS.md
docs/goals/EXPERIMENT_NOTES.md
implementation-notes.html
src/relationship/evals/agentEvalRunner.test.ts
src/relationship/evals/agentEvalRunner.ts
```

- [ ] **Step 2: Verify the regression suite is RED for behavior reasons**

Run:

```bash
npm test -- src/relationship/evals/agentEvalRunner.test.ts
```

Expected: FAIL. Confirm failures are assertion failures in the new regression cases, not TypeScript/import/runtime setup errors.

- [ ] **Step 3: Verify formatting check passes**

Run:

```bash
git diff --check
```

Expected: PASS with no output.

- [ ] **Step 4: Report intentionally RED status**

Final report must say:

```text
Regression freeze tests are added and intentionally RED. No production behavior was changed. The next implementation goal should make the five new cases pass.
```

Do not say `npm test` passes for this task unless the project chooses to mark these tests skipped or pending. The preferred state for this task is committed failing tests that freeze the failures.
