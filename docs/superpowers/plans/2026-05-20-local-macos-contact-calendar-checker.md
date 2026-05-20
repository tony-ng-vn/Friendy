# Local macOS Contact/Calendar Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit local-only checker command that detects new macOS Contacts methods, maps them to calendar context, creates pending candidates, and prints or sends the Friendy confirmation prompt.

**Architecture:** Keep real macOS access behind provider adapters in `src/relationship/ingestion/`. The orchestrator accepts injected providers and sender interfaces so tests use deterministic mocks while the CLI can choose real macOS providers or a safe `--mock` path. The command reuses `ingestContactSnapshotDiff`, `createRelationshipRepository`, `createRelationshipTools`, and `buildCandidateReviewPrompt` instead of creating another product path.

**Tech Stack:** TypeScript, Node `tsx`, Vitest, AppleScript via `osascript` for macOS providers, existing Friendy relationship-agent modules.

---

## File Structure

- Create `src/relationship/ingestion/localMacAdapters.ts`: real macOS Contacts/Calendar provider helpers and parsers. It owns platform checks and AppleScript execution.
- Create `src/relationship/ingestion/localMacAdapters.test.ts`: parser tests and non-macOS failure tests using mocked `execFileSync`.
- Create `src/relationship/ingestion/localCheck.ts`: provider-neutral local check orchestration, dry-run/live-send guard, summary output, and mock fixture scenario.
- Create `src/relationship/ingestion/localCheck.test.ts`: behavior tests for event match, no-event, dry-run, live-send guard, and package script.
- Create `src/relationship/ingestion/localCheckCli.ts`: loads env, parses CLI args, runs local check, prints lines, exits non-zero for real-provider failures.
- Modify `src/relationship/ingestion/ingestionPipeline.ts`: widen `CalendarEventProvider.source` from fixture-only to support `apple_calendar`.
- Modify `package.json`: add `ingest:local:check`.
- Modify `README.md`, `REFERENCE.md`, `docs/ai-system-architecture.md`, `CHANGELOG.md`, `implementation-notes.html`, and goal tracking docs.

## Task 1: Goal Tracking And Baseline

**Files:**
- Create: `docs/goals/local-macos-contact-calendar-checker-goal.md`
- Modify: `docs/goals/README.md`
- Modify: `docs/goals/PLAN.md`
- Modify: `docs/goals/EXPERIMENTS.md`
- Modify: `docs/goals/EXPERIMENT_NOTES.md`

- [ ] **Step 1: Reset active goal tracking**

Set `docs/goals/PLAN.md` to the active checklist for this goal.

- [ ] **Step 2: Initialize experiment logs**

Record branch name, baseline command, RED/GREEN sections, and design decisions in the goal tracking files.

- [ ] **Step 3: Run baseline tests**

```bash
npm test
```

Expected: existing tests pass before behavior changes.

- [ ] **Step 4: Commit goal setup**

```bash
git add docs/goals docs/superpowers/plans/2026-05-20-local-macos-contact-calendar-checker.md
git commit -m "docs:start local contact calendar checker goal"
```

## Task 2: Local Provider Adapter Tests

**Files:**
- Create: `src/relationship/ingestion/localMacAdapters.test.ts`
- Create: `src/relationship/ingestion/localMacAdapters.ts`

- [ ] **Step 1: Write RED tests**

Create tests for parsing Contacts output, parsing Calendar output, and failing clearly outside macOS before executing `osascript`.

- [ ] **Step 2: Run RED tests**

```bash
npm test -- src/relationship/ingestion/localMacAdapters.test.ts
```

Expected: fail because `localMacAdapters.ts` does not exist.

- [ ] **Step 3: Implement minimal adapter API**

Create `localMacAdapters.ts` with parser functions, platform guards, and AppleScript execution wrappers. Keep parsing independent from `osascript` so tests never need real macOS.

- [ ] **Step 4: Run GREEN tests**

```bash
npm test -- src/relationship/ingestion/localMacAdapters.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/relationship/ingestion/localMacAdapters.ts src/relationship/ingestion/localMacAdapters.test.ts
git commit -m "feat:add local macos provider adapters"
```

## Task 3: Local Check Orchestrator Tests

**Files:**
- Create: `src/relationship/ingestion/localCheck.test.ts`
- Create: `src/relationship/ingestion/localCheck.ts`
- Modify: `src/relationship/ingestion/ingestionPipeline.ts`

- [ ] **Step 1: Write RED tests**

Create tests for mock dry-run event mapping, no-event prompt, dry-run avoiding sends, live-send guard, and live-send mocked sender call.

- [ ] **Step 2: Run RED tests**

```bash
npm test -- src/relationship/ingestion/localCheck.test.ts
```

Expected: fail because `localCheck.ts` does not exist.

- [ ] **Step 3: Implement orchestration**

Implement `runLocalContactCalendarCheck`, `createMockLocalCheckScenario`, `LocalPromptSender`, dry-run state handling, and prompt line construction from `buildCandidateReviewPrompt`.

- [ ] **Step 4: Run GREEN tests**

```bash
npm test -- src/relationship/ingestion/localCheck.test.ts src/relationship/ingestion/ingestionPipeline.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/relationship/ingestion/localCheck.ts src/relationship/ingestion/localCheck.test.ts src/relationship/ingestion/ingestionPipeline.ts
git commit -m "feat:add local contact calendar checker"
```

## Task 4: CLI And Package Script

**Files:**
- Create: `src/relationship/ingestion/localCheckCli.ts`
- Modify: `package.json`
- Test: `src/relationship/ingestion/localCheck.test.ts`

- [ ] **Step 1: Add RED script test**

Assert `packageJson.scripts["ingest:local:check"]` equals `tsx src/relationship/ingestion/localCheckCli.ts`.

- [ ] **Step 2: Run RED**

```bash
npm test -- src/relationship/ingestion/localCheck.test.ts
```

Expected: fail because the script does not exist.

- [ ] **Step 3: Implement CLI**

The CLI loads env files, supports `--mock`, supports `--state-file <path>`, defaults to dry-run, uses real macOS providers only when not `--mock`, prints result lines, and exits non-zero with a clear message on real-provider failures.

- [ ] **Step 4: Run command in mock mode**

```bash
npm run ingest:local:check -- --mock
```

Expected output includes `Friendy -> User:` and the confirmation prompt for `Friendy-101`.

- [ ] **Step 5: Commit**

```bash
git add package.json src/relationship/ingestion/localCheckCli.ts src/relationship/ingestion/localCheck.test.ts
git commit -m "feat:add local ingest check command"
```

## Task 5: Docs, Verification, Merge

**Files:**
- Modify: `README.md`
- Modify: `REFERENCE.md`
- Modify: `docs/ai-system-architecture.md`
- Modify: `CHANGELOG.md`
- Modify: `implementation-notes.html`
- Modify: `docs/goals/PLAN.md`
- Modify: `docs/goals/EXPERIMENTS.md`
- Modify: `docs/goals/EXPERIMENT_NOTES.md`

- [ ] **Step 1: Update docs**

Document `npm run ingest:local:check -- --mock`, real macOS mode, dry-run default, `FRIENDY_LOCAL_CHECK_SEND=1`, non-macOS behavior, and scope constraints.

- [ ] **Step 2: Run full verification on feature branch**

```bash
npm test
npm run build
npm run eval:agent
npm run check:imessage-e2e
npm run ingest:check
npm run ingest:local:check -- --mock
git diff --check
repo-wide forbidden-term search for old show-oriented wording
```

Expected: all commands pass except the forbidden-term search, which must return no matches and exit 1.

- [ ] **Step 3: Commit docs**

```bash
git add README.md REFERENCE.md docs/ai-system-architecture.md CHANGELOG.md implementation-notes.html docs/goals
git commit -m "docs:document local contact calendar checker"
```

- [ ] **Step 4: Merge, re-verify, push**

Fast-forward into `main`, rerun the full verification set on `main`, push `main`, then update goal tracking docs if needed and push the final tracking commit.
