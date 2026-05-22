# Mac-Only MVP Runtime Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm run agent:friendy` the boring, inspectable Mac-only MVP runtime path and bring the approved Agent Behavior Contract into code, evals, docs, and operator checks.

**Architecture:** Keep Friendy local-first and deterministic-first. `agent:friendy` remains the foreground runtime that composes SQLite state, Spectrum/iMessage, prompt delivery, and the macOS sensor; this plan adds version guards, CI, a consolidated doctor, clearer lifecycle logs, behavior-contract enforcement, structured redacted traces, and user-facing reliability docs. Phone verification and landing-page UI are treated as a separate integration surface; this plan prepares the Friendy runtime and agent behavior the landing page will connect to.

**Tech Stack:** TypeScript, Vitest, Node 24 `node:sqlite`, Vite build, GitHub Actions, local SQLite, Spectrum/iMessage transport, Swift macOS sensor checks, Markdown docs.

---

## Current Code Map

- `package.json`: package scripts and dependencies. Needs Node engine pin and `doctor:friendy` script.
- `.nvmrc`: create with the supported Node major used by this repo.
- `.node-version`: create for toolchains that prefer asdf/mise-style version files.
- `.github/workflows/ci.yml`: create safe CI for build, tests, evals, and mock checks.
- `src/relationship/runtime/friendyRuntimeCli.ts`: foreground runtime config/startup. Needs structured lifecycle logging hooks and doctor re-use points.
- `src/relationship/runtime/friendyRuntimeCli.test.ts`: runtime CLI config tests. Needs lifecycle log assertions.
- `src/relationship/runtime/friendyDoctor.ts`: create consolidated runtime readiness doctor.
- `src/relationship/runtime/friendyDoctor.test.ts`: create doctor coverage.
- `src/relationship/agentBehaviorContract.ts`: create central behavior contract constants for code and eval reference.
- `src/relationship/agentBehaviorContract.test.ts`: create contract coverage.
- `src/relationship/responseComposer.ts`: update save/search/clarification wording to the approved natural style.
- `src/relationship/responseComposer.test.ts`: update wording and ambiguity assertions.
- `src/relationship/runtime/promptPlanner.ts`: align proactive prompt wording with behavior contract.
- `src/relationship/runtime/promptPlanner.test.ts`: verify event/no-event prompt text.
- `src/relationship/interpretedAgent.ts`: add follow-up search narrowing and memory update routing.
- `src/relationship/interpretedAgent.test.ts`: add follow-up and update tests.
- `src/relationship/repository.ts`: add memory update boundary.
- `src/relationship/sqliteRepository.ts`: add SQLite memory update implementation.
- `src/relationship/tools.ts`: add bounded `update_memory` tool.
- `src/relationship/types.ts`: add `update_memory` tool-call and redacted trace fields.
- `src/relationship/evals/agentEvalRunner.ts`: add behavior-contract trajectory cases.
- `src/relationship/runtime/runtimeTrace.ts`: create redacted trace helpers for local logs.
- `src/relationship/runtime/runtimeTrace.test.ts`: verify no raw PII leaks in trace shapes.
- `README.md`: make `agent:friendy` the canonical runtime path and update commands.
- `REFERENCE.md`: update command map and current caution.
- `implementation-notes.html`: record decisions, deviations, and verification.

## Scope Boundaries

This plan includes:

- Runtime/operator reliability.
- Agent behavior-contract enforcement.
- Safe structured traces.
- CI for safe checks.
- Documentation alignment.

This plan excludes:

- Building the landing page UI.
- Implementing real phone verification.
- Adding LangChain, LangSmith, or Langfuse.
- Adding SQLite FTS5 search.
- Packaging a LaunchAgent.
- Adding iPhone app support.

The landing page should be able to call into the final runtime later, but it is not implemented in this plan.

---

## Task 1: Pin Node Version And Add Safe CI

**Files:**
- Modify: `package.json`
- Create: `.nvmrc`
- Create: `.node-version`
- Create: `.github/workflows/ci.yml`
- Test: `package.json`

- [ ] **Step 1: Write the failing package metadata test**

Create `src/relationship/runtime/nodeVersion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import packageJson from "../../../package.json";

describe("runtime Node version contract", () => {
  it("pins Node 24 or newer because Friendy uses node:sqlite", () => {
    expect(packageJson.engines?.node).toBe(">=24");
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
npm test -- src/relationship/runtime/nodeVersion.test.ts
```

Expected: FAIL because `packageJson.engines` is not defined.

- [ ] **Step 3: Add Node version metadata**

Modify `package.json` near the top:

```json
{
  "name": "friendy",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
```

Create `.nvmrc`:

```text
24
```

Create `.node-version`:

```text
24
```

- [ ] **Step 4: Add CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm

      - name: Install
        run: npm ci

      - name: Test
        run: npm test

      - name: Build
        run: npm run build

      - name: Agent evals
        run: npm run eval:agent

      - name: iMessage-style E2E check
        run: npm run check:imessage-e2e

      - name: Mock local checker
        run: npm run ingest:local:check -- --mock

      - name: Foreground runtime check
        run: npm run agent:friendy:check

      - name: macOS sensor fixture check
        run: npm run check:macos-sensor-fixture

      - name: Whitespace check
        run: git diff --check
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- src/relationship/runtime/nodeVersion.test.ts
npm run build
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add package.json .nvmrc .node-version .github/workflows/ci.yml src/relationship/runtime/nodeVersion.test.ts
git commit -m "chore:pin node version and add ci checks"
```

---

## Task 2: Add `doctor:friendy`

**Files:**
- Create: `src/relationship/runtime/friendyDoctor.ts`
- Create: `src/relationship/runtime/friendyDoctor.test.ts`
- Modify: `package.json`
- Modify: `REFERENCE.md`

- [ ] **Step 1: Write failing doctor tests**

Create `src/relationship/runtime/friendyDoctor.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import { runFriendyDoctor } from "./friendyDoctor";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Friendy runtime doctor", () => {
  it("exposes the package script", () => {
    expect(packageJson.scripts["doctor:friendy"]).toBe("tsx src/relationship/runtime/friendyDoctor.ts");
  });

  it("reports ready mock runtime configuration", () => {
    const cwd = tempDir();
    const report = runFriendyDoctor({
      cwd,
      env: {
        FRIENDY_SENSOR_MOCK: "1",
        FRIENDY_PROMPT_TRANSPORT: "console",
        FRIENDY_RUNTIME_STORE: "sqlite"
      },
      platform: "linux",
      nodeVersion: "v24.15.0"
    });

    expect(report.ok).toBe(true);
    expect(report.lines.join("\n")).toContain("Node: v24.15.0");
    expect(report.lines.join("\n")).toContain("SQLite runtime store: ready");
    expect(report.lines.join("\n")).toContain("Prompt transport: console");
    expect(report.lines.join("\n")).toContain("macOS sensor: mock enabled");
  });

  it("reports actionable failures for missing real sensor and prompt recipient", () => {
    const cwd = tempDir();
    const report = runFriendyDoctor({
      cwd,
      env: {
        FRIENDY_RUNTIME_STORE: "sqlite"
      },
      platform: "darwin",
      nodeVersion: "v24.15.0"
    });

    expect(report.ok).toBe(false);
    expect(report.lines.join("\n")).toContain("Prompt recipient: missing");
    expect(report.lines.join("\n")).toContain("macOS sensor binary: missing");
  });

  it("accepts a configured real sensor binary", () => {
    const cwd = tempDir();
    const binaryPath = join(cwd, "bin/friendy-macos-sensor");
    writeFileSync(binaryPath, "");
    const report = runFriendyDoctor({
      cwd,
      env: {
        FRIENDY_RUNTIME_STORE: "sqlite",
        FRIENDY_PROMPT_TRANSPORT: "console",
        FRIENDY_SENSOR_BINARY_PATH: binaryPath
      },
      platform: "darwin",
      nodeVersion: "v24.15.0"
    });

    expect(report.lines.join("\n")).toContain("macOS sensor binary: present");
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-doctor-"));
  tempDirs.push(dir);
  return dir;
}
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/runtime/friendyDoctor.test.ts
```

Expected: FAIL because `friendyDoctor.ts` and the script do not exist.

- [ ] **Step 3: Implement doctor report**

Create `src/relationship/runtime/friendyDoctor.ts`:

```ts
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveFriendyRuntimeConfig } from "./friendyRuntimeCli";

export type FriendyDoctorInput = {
  cwd?: string;
  env?: Partial<NodeJS.ProcessEnv>;
  platform?: NodeJS.Platform;
  nodeVersion?: string;
};

export type FriendyDoctorReport = {
  ok: boolean;
  lines: string[];
};

export function runFriendyDoctor({
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  nodeVersion = process.version
}: FriendyDoctorInput = {}): FriendyDoctorReport {
  const lines = ["Friendy runtime doctor", `Platform: ${platform}`, `Node: ${nodeVersion}`];
  let ok = true;

  const nodeMajor = Number(nodeVersion.replace(/^v/, "").split(".")[0] ?? "0");
  if (nodeMajor >= 24) {
    lines.push("node:sqlite support: expected available");
  } else {
    lines.push("node:sqlite support: Node 24 or newer required");
    ok = false;
  }

  let config: ReturnType<typeof resolveFriendyRuntimeConfig> | undefined;
  try {
    config = resolveFriendyRuntimeConfig({ cwd, env });
    lines.push(`SQLite path: ${config.sqlitePath}`);
    lines.push(writablePathLine("SQLite runtime store", config.sqlitePath));
    lines.push(`Sensor state dir: ${config.sensorStateDir}`);
    lines.push(writablePathLine("Sensor state directory", config.sensorStateDir));
  } catch (error) {
    lines.push(`Runtime config: ${errorMessage(error)}`);
    ok = false;
  }

  const promptTransport = env.FRIENDY_PROMPT_TRANSPORT || (env.FRIENDY_SENSOR_MOCK === "1" ? "console" : "spectrum");
  lines.push(`Prompt transport: ${promptTransport}`);
  if (promptTransport === "spectrum" && !env.FRIENDY_PROMPT_TO_PHONE?.trim() && !env.FRIENDY_OWNER_PHONE?.trim()) {
    lines.push("Prompt recipient: missing");
    ok = false;
  } else {
    lines.push("Prompt recipient: ready");
  }

  if (env.FRIENDY_SENSOR_MOCK === "1") {
    lines.push("macOS sensor: mock enabled");
  } else {
    const binaryPath = resolve(cwd, env.FRIENDY_SENSOR_BINARY_PATH || "bin/friendy-macos-sensor");
    if (existsSync(binaryPath)) {
      lines.push("macOS sensor binary: present");
    } else {
      lines.push("macOS sensor binary: missing");
      ok = false;
    }
  }

  if (platform === "darwin") {
    lines.push("Contacts/Calendar permission check: run npm run doctor:macos-sensor for native TCC details");
  } else {
    lines.push("Contacts/Calendar permission check: requires macOS");
  }

  return { ok, lines };
}

function writablePathLine(label: string, path: string): string {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const probe = `${path}.doctor-probe`;
    writeFileSync(probe, "");
    unlinkSync(probe);
    return `${label}: ready`;
  } catch (error) {
    return `${label}: not writable (${errorMessage(error)})`;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function main(): void {
  const report = runFriendyDoctor();
  for (const line of report.lines) {
    console.info(line);
  }
  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 4: Add package script**

Modify `package.json` scripts:

```json
"doctor:friendy": "tsx src/relationship/runtime/friendyDoctor.ts",
```

Place it near `doctor:macos-sensor`.

- [ ] **Step 5: Update repo map**

In `REFERENCE.md`, add:

```text
npm run doctor:friendy
```

to the command list and describe it as the consolidated foreground runtime readiness check.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm test -- src/relationship/runtime/friendyDoctor.test.ts
npm run doctor:friendy
```

Expected: tests pass. The doctor may exit nonzero on the current Linux host if real sensor config is missing; when running without mock env, record actual output in `implementation-notes.html` later rather than weakening the check.

- [ ] **Step 7: Commit**

```bash
git add package.json REFERENCE.md src/relationship/runtime/friendyDoctor.ts src/relationship/runtime/friendyDoctor.test.ts
git commit -m "feat:add friendy runtime doctor"
```

---

## Task 3: Make `agent:friendy` Lifecycle Logs Inspectable

**Files:**
- Modify: `src/relationship/runtime/friendyRuntimeCli.ts`
- Modify: `src/relationship/runtime/friendyRuntimeCli.test.ts`
- Modify: `src/relationship/runtime/friendyRuntimeCheck.ts`
- Modify: `src/relationship/runtime/friendyRuntimeCheck.test.ts`

- [ ] **Step 1: Write failing lifecycle log test**

Add to `src/relationship/runtime/friendyRuntimeCli.test.ts`:

```ts
it("logs clear lifecycle states while starting", async () => {
  const cwd = tempDir();
  const logs: string[] = [];

  const started = await startFriendyForegroundRuntime({
    cwd,
    env: {
      FRIENDY_SENSOR_MOCK: "1",
      FRIENDY_PROMPT_TRANSPORT: "console",
      FRIENDY_LOCAL_USER_ID: "user_friendy"
    },
    startSensor() {
      return { child: fakeChildProcess() };
    },
    logger: testLogger(logs)
  });

  expect(logs).toContain("[friendy] loading env");
  expect(logs).toContain("[friendy] sqlite store ready");
  expect(logs).toContain("[friendy] prompt transport ready: console");
  expect(logs).toContain("[friendy] macos sensor launching: mock");
  expect(logs).toContain("[friendy] watching for contact signals");
  started.close();
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/runtime/friendyRuntimeCli.test.ts
```

Expected: FAIL because the lifecycle lines are missing.

- [ ] **Step 3: Add lifecycle logging**

In `startFriendyForegroundRuntime`, add logs in this order:

```ts
logger.info("[friendy] loading env");
const config = resolveFriendyRuntimeConfig({ cwd, env });
logger.info("[friendy] config resolved");
```

After SQLite repo/state creation:

```ts
logger.info("[friendy] sqlite store ready");
```

After prompt sender creation:

```ts
logger.info(`[friendy] prompt transport ready: ${promptSender.kind}`);
```

Before inbound agent start:

```ts
if (shouldStartInboundAgent(config, env)) {
  logger.info("[friendy] spectrum inbound starting");
}
```

Before sensor start:

```ts
logger.info(`[friendy] macos sensor launching: ${config.sensor.mode}`);
```

After sensor start:

```ts
logger.info("[friendy] watching for contact signals");
```

- [ ] **Step 4: Add check assertion**

In `src/relationship/runtime/friendyRuntimeCheck.test.ts`, assert the deterministic check report includes the replay line already present and at least one lifecycle or runtime status line once the check emits it. If `friendyRuntimeCheck.ts` does not use `startFriendyForegroundRuntime`, keep this test scoped to `friendyRuntimeCli.test.ts` only.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- src/relationship/runtime/friendyRuntimeCli.test.ts src/relationship/runtime/friendyRuntimeCheck.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit**

```bash
git add src/relationship/runtime/friendyRuntimeCli.ts src/relationship/runtime/friendyRuntimeCli.test.ts src/relationship/runtime/friendyRuntimeCheck.ts src/relationship/runtime/friendyRuntimeCheck.test.ts
git commit -m "feat:clarify friendy runtime lifecycle"
```

---

## Task 4: Add Agent Behavior Contract Artifact

**Files:**
- Create: `src/relationship/agentBehaviorContract.ts`
- Create: `src/relationship/agentBehaviorContract.test.ts`
- Modify: `src/relationship/openRouterInterpreter.ts`
- Modify: `src/relationship/openRouterInterpreter.test.ts`
- Modify: `src/relationship/responseComposer.ts`
- Modify: `src/relationship/responseComposer.test.ts`
- Modify: `src/relationship/runtime/promptPlanner.ts`
- Modify: `src/relationship/runtime/promptPlanner.test.ts`

- [ ] **Step 1: Write failing contract tests**

Create `src/relationship/agentBehaviorContract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AGENT_BEHAVIOR_CONTRACT, buildInterpreterSystemPrompt } from "./agentBehaviorContract";

describe("Agent Behavior Contract", () => {
  it("captures the core product behavior rules", () => {
    expect(AGENT_BEHAVIOR_CONTRACT.rules).toContain("save_only_after_confirmation");
    expect(AGENT_BEHAVIOR_CONTRACT.rules).toContain("trust_user_correction_over_calendar_guess");
    expect(AGENT_BEHAVIOR_CONTRACT.rules).toContain("ask_when_uncertain");
    expect(AGENT_BEHAVIOR_CONTRACT.rules).toContain("stay_relationship_memory_scoped");
  });

  it("builds the interpreter system prompt from the same contract", () => {
    const prompt = buildInterpreterSystemPrompt();
    expect(prompt).toContain("Friendy is a personal relationship memory agent");
    expect(prompt).toContain("Do not execute actions");
    expect(prompt).toContain("Use clarify when the message is too vague");
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/agentBehaviorContract.test.ts
```

Expected: FAIL because the contract file does not exist.

- [ ] **Step 3: Implement behavior contract**

Create `src/relationship/agentBehaviorContract.ts`:

```ts
export const AGENT_BEHAVIOR_CONTRACT = {
  tone: "concise_conversational_texting_agent",
  rules: [
    "ask_when_uncertain",
    "never_guess_invent_or_save_unclear_info",
    "never_save_from_contact_detection_alone",
    "save_only_after_confirmation",
    "trust_user_correction_over_calendar_guess",
    "lightly_echo_saved_memory",
    "make_source_clear",
    "narrow_follow_up_clues_against_previous_search",
    "stay_relationship_memory_scoped"
  ]
} as const;

export function buildInterpreterSystemPrompt(): string {
  return [
    "You interpret Friendy relationship-memory text into JSON only.",
    "Friendy is a personal relationship memory agent.",
    "Do not execute actions. Do not invent people or contacts.",
    "Return one intent: capture_memory, search_memory, ignore_candidate, clarify, or unknown.",
    "Use clarify when the message is too vague to search or save safely.",
    "Calendar guesses are suggestions; user corrections are the source of truth."
  ].join(" ");
}
```

- [ ] **Step 4: Wire interpreter prompt to contract**

In `src/relationship/openRouterInterpreter.ts`, import and use:

```ts
import { buildInterpreterSystemPrompt } from "./agentBehaviorContract";
```

Replace the hard-coded system prompt content with:

```ts
{ role: "system", content: buildInterpreterSystemPrompt() }
```

- [ ] **Step 5: Update user-facing wording tests**

In `src/relationship/responseComposer.test.ts`, add/adjust assertions for natural save/search wording:

```ts
expect(reply).toBe(
  "Got it, saved Maya from Photon Residency Dinner. I'll remember she was building recruiting agents and played piano after dinner."
);
```

In `src/relationship/runtime/promptPlanner.test.ts`, keep event/no-event prompts aligned:

```ts
expect(plan.text).toBe("I noticed you added Maya during Photon Residency Dinner. Did you meet them there?");
expect(noEventPlan.text).toBe("I noticed you added Maya. Where did you meet them?");
```

- [ ] **Step 6: Implement minimal wording changes**

Update `composeSaveConfirmation` so single-memory saves use:

```text
Got it, saved [name] from [event]. I'll remember [natural context].
```

If there is no event:

```text
Got it, saved [name]. I'll remember [natural context].
```

Keep ambiguity/no-match replies short and scoped.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
npm test -- src/relationship/agentBehaviorContract.test.ts src/relationship/openRouterInterpreter.test.ts src/relationship/responseComposer.test.ts src/relationship/runtime/promptPlanner.test.ts
npm run eval:agent
```

Expected: all pass. If existing eval expected substrings use older wording, update them to semantic substrings rather than exact full reply text.

- [ ] **Step 8: Commit**

```bash
git add src/relationship/agentBehaviorContract.ts src/relationship/agentBehaviorContract.test.ts src/relationship/openRouterInterpreter.ts src/relationship/openRouterInterpreter.test.ts src/relationship/responseComposer.ts src/relationship/responseComposer.test.ts src/relationship/runtime/promptPlanner.ts src/relationship/runtime/promptPlanner.test.ts src/relationship/evals/agentEvalRunner.ts
git commit -m "feat:add agent behavior contract"
```

---

## Task 5: Add Follow-Up Search Narrowing And Memory Update Behavior

**Files:**
- Modify: `src/relationship/types.ts`
- Modify: `src/relationship/repository.ts`
- Modify: `src/relationship/repository.test.ts`
- Modify: `src/relationship/sqliteRepository.ts`
- Modify: `src/relationship/sqliteRepository.test.ts`
- Modify: `src/relationship/tools.ts`
- Modify: `src/relationship/tools.test.ts`
- Modify: `src/relationship/interpretedAgent.ts`
- Modify: `src/relationship/interpretedAgent.test.ts`
- Modify: `src/relationship/evals/agentEvalRunner.ts`

- [ ] **Step 1: Write failing repository update tests**

Add to `src/relationship/repository.test.ts`:

```ts
it("updates an existing relationship memory context note", () => {
  const repo = createRelationshipRepository({ users: [fixtureUser], calendarEvents: [fixtureLongEvent] });
  const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
  const memory = repo.confirmCandidate(candidate.id, "building recruiting agents", fixtureLongEvent.id);

  const updated = repo.updateMemory(memory.id, {
    contextNote: "working on hiring workflows",
    updatedAt: "2026-05-22T12:00:00.000Z"
  });

  expect(updated.contextNote).toBe("working on hiring workflows");
  expect(updated.tags).toContain("hiring");
  expect(updated.updatedAt).toBe("2026-05-22T12:00:00.000Z");
});
```

Mirror the same behavior in `src/relationship/sqliteRepository.test.ts`.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts
```

Expected: FAIL because `updateMemory` does not exist.

- [ ] **Step 3: Add repository update boundary**

In `src/relationship/repository.ts`, extend `RelationshipRepository`:

```ts
updateMemory(
  memoryId: string,
  updates: { contextNote: string; relationshipContext?: string; updatedAt: string }
): RelationshipMemory;
```

Implement in the in-memory repository:

```ts
updateMemory(memoryId, updates) {
  const index = memories.findIndex((memory) => memory.id === memoryId);
  if (index < 0) {
    throw new Error(`Memory not found: ${memoryId}`);
  }

  const current = memories[index];
  const updated: RelationshipMemory = {
    ...current,
    contextNote: updates.contextNote,
    relationshipContext: updates.relationshipContext ?? current.relationshipContext,
    tags: extractTags([updates.contextNote, updates.relationshipContext ?? ""].join(" ")),
    updatedAt: updates.updatedAt
  };
  memories[index] = updated;
  return updated;
}
```

Implement the SQLite version by reading the memory row, updating raw JSON plus indexed columns, and returning the parsed memory.

- [ ] **Step 4: Add bounded tool**

In `src/relationship/types.ts`, add:

```ts
| "update_memory"
```

to `AgentToolCall`.

In `src/relationship/tools.ts`, add:

```ts
update_memory(userId: string, memoryId: string, contextNote: string, now = new Date().toISOString()) {
  const memory = repo.listMemories(userId).find((item) => item.id === memoryId);
  if (!memory) {
    throw new Error(`Memory not found for user: ${memoryId}`);
  }
  return repo.updateMemory(memoryId, { contextNote, updatedAt: now });
}
```

- [ ] **Step 5: Add follow-up narrowing tests**

In `src/relationship/interpretedAgent.test.ts`, add:

```ts
it("narrows a follow-up clue against the previous ambiguous search", async () => {
  const harness = createInterpretedHarnessWithMemories([
    memoryFixture({ displayName: "Maya", contextNote: "building recruiting agents | played piano after dinner" }),
    memoryFixture({ displayName: "Priya", contextNote: "worked on recruiting automation" })
  ]);

  const first = await harness.agent.handleMessage(message("Who was the recruiting person?"));
  expect(first.outbound.text).toContain("Which");

  const second = await harness.agent.handleMessage(message("The one who played piano."));
  expect(second.outbound.text).toContain("That was Maya");
  expect(second.outbound.text).toContain("played piano after dinner");
});
```

Use the local test harness style already present in `interpretedAgent.test.ts`; do not introduce a new testing framework.

- [ ] **Step 6: Add memory update tests**

In `src/relationship/interpretedAgent.test.ts`, add:

```ts
it("updates the active memory when the user clearly corrects it", async () => {
  const harness = createInterpretedHarnessWithMemories([
    memoryFixture({ displayName: "Maya", contextNote: "building recruiting agents" })
  ]);

  await harness.agent.handleMessage(message("Who was building recruiting agents?"));
  const result = await harness.agent.handleMessage(message("Actually, Maya was working on hiring workflows, not recruiting agents."));

  expect(result.toolCalls).toContain("update_memory");
  expect(result.outbound.text).toContain("Got it, updated Maya");
  expect(harness.repo.listMemories(fixtureUser.id)[0].contextNote).toContain("hiring workflows");
});
```

- [ ] **Step 7: Implement conversation search context**

In `interpretedAgent.ts`, expand `ConversationContext`:

```ts
type ConversationContext = {
  activeEventName?: string;
  activeDateContext?: TemporalContext;
  recentPeople: string[];
  lastSearch?: {
    query: string;
    matches: Array<{ memoryId: string; displayName: string }>;
    ambiguous: boolean;
  };
  activeMemoryId?: string;
};
```

When search returns matches, store `lastSearch` and `activeMemoryId` for a single confident match.

When a follow-up message is classified as search and `lastSearch.ambiguous` is true, combine the previous query and new clue before calling `tools.search_memories`.

- [ ] **Step 8: Implement correction routing**

Add deterministic correction detection before generic capture/search execution:

```ts
function looksLikeMemoryCorrection(text: string): boolean {
  return /\b(actually|correction|update|not\b|instead)\b/i.test(text);
}
```

If `looksLikeMemoryCorrection(message.text)` and the active memory is clear, call `tools.update_memory`. If multiple recent matches could be updated, compose a clarification asking who to update.

- [ ] **Step 9: Add eval cases**

In `src/relationship/evals/agentEvalRunner.ts`, add cases for:

- ambiguous search followed by narrowing clue;
- update active memory after search;
- correction with unclear target asks who to update;
- no unsafe update when there is no active memory.

- [ ] **Step 10: Verify GREEN**

Run:

```bash
npm test -- src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts src/relationship/tools.test.ts src/relationship/interpretedAgent.test.ts src/relationship/evals/agentEvalRunner.test.ts
npm run eval:agent
npm run build
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add src/relationship/types.ts src/relationship/repository.ts src/relationship/repository.test.ts src/relationship/sqliteRepository.ts src/relationship/sqliteRepository.test.ts src/relationship/tools.ts src/relationship/tools.test.ts src/relationship/interpretedAgent.ts src/relationship/interpretedAgent.test.ts src/relationship/evals/agentEvalRunner.ts
git commit -m "feat:add memory correction and search narrowing"
```

---

## Task 6: Add Friendy-Native Redacted Runtime Traces

**Files:**
- Create: `src/relationship/runtime/runtimeTrace.ts`
- Create: `src/relationship/runtime/runtimeTrace.test.ts`
- Modify: `src/relationship/interpretedAgent.ts`
- Modify: `src/relationship/transports/spectrumTransport.ts`
- Modify: `src/relationship/types.ts`

- [ ] **Step 1: Write failing trace tests**

Create `src/relationship/runtime/runtimeTrace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRedactedInteractionTrace } from "./runtimeTrace";

describe("redacted runtime trace", () => {
  it("keeps behavior shape without raw names, phone numbers, or notes", () => {
    const trace = buildRedactedInteractionTrace({
      inboundText: "Actually Maya works on recruiting agents and her number is +15551234567",
      interpretedIntentJson: { intent: "capture_memory", confidence: 0.9 },
      toolCalls: ["confirm_candidate"],
      outboundText: "Got it, saved Maya. You have her number ending in 4567.",
      candidateCount: 2,
      hasEventGuess: true,
      result: "memory_saved"
    });

    const serialized = JSON.stringify(trace);
    expect(trace.messageKind).toBe("capture_memory");
    expect(trace.toolCalls).toEqual(["confirm_candidate"]);
    expect(trace.candidateCount).toBe(2);
    expect(trace.hasEventGuess).toBe(true);
    expect(serialized).not.toContain("Maya");
    expect(serialized).not.toContain("+15551234567");
    expect(serialized).not.toContain("recruiting agents");
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/runtime/runtimeTrace.test.ts
```

Expected: FAIL because `runtimeTrace.ts` does not exist.

- [ ] **Step 3: Implement redacted trace helper**

Create `src/relationship/runtime/runtimeTrace.ts`:

```ts
import type { AgentToolCall } from "../types";

export type RedactedInteractionTraceInput = {
  inboundText: string;
  interpretedIntentJson: unknown;
  toolCalls: AgentToolCall[];
  outboundText: string;
  candidateCount?: number;
  hasEventGuess?: boolean;
  result: "memory_saved" | "search_answered" | "clarification_required" | "ignored" | "redirected" | "error";
  modelUsed?: string;
  error?: string;
};

export type RedactedInteractionTrace = {
  messageKind: string;
  textLength: number;
  outboundLength: number;
  toolCalls: AgentToolCall[];
  candidateCount?: number;
  hasEventGuess?: boolean;
  result: RedactedInteractionTraceInput["result"];
  modelUsed?: string;
  error?: string;
};

export function buildRedactedInteractionTrace(input: RedactedInteractionTraceInput): RedactedInteractionTrace {
  return {
    messageKind: intentFromInterpretation(input.interpretedIntentJson),
    textLength: input.inboundText.length,
    outboundLength: input.outboundText.length,
    toolCalls: input.toolCalls,
    candidateCount: input.candidateCount,
    hasEventGuess: input.hasEventGuess,
    result: input.result,
    modelUsed: input.modelUsed,
    error: input.error ? "present" : undefined
  };
}

function intentFromInterpretation(value: unknown): string {
  if (typeof value === "object" && value !== null && "intent" in value) {
    return String((value as { intent: unknown }).intent);
  }
  return "unknown";
}
```

- [ ] **Step 4: Wire traces to interaction logs**

Add an optional `redactedTraceJson?: unknown` field to `AgentInteraction` in `src/relationship/types.ts`.

In `interpretedAgent.ts`, when adding interactions, include `redactedTraceJson: buildRedactedInteractionTrace(...)`.

In `spectrumTransport.ts`, include trace result shape in compact logs without raw text.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- src/relationship/runtime/runtimeTrace.test.ts src/relationship/interpretedAgent.test.ts src/relationship/transports/spectrumTransport.test.ts
npm run eval:agent
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/relationship/runtime/runtimeTrace.ts src/relationship/runtime/runtimeTrace.test.ts src/relationship/interpretedAgent.ts src/relationship/transports/spectrumTransport.ts src/relationship/types.ts
git commit -m "feat:add redacted agent traces"
```

---

## Task 7: Align README, Reference, And Implementation Notes

**Files:**
- Modify: `README.md`
- Modify: `REFERENCE.md`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Update README current state**

Replace the stale “not built yet” line about the one-command runtime with:

```text
- A foreground `npm run agent:friendy` runtime exists and is the canonical local MVP runtime path. It composes SQLite state, prompt delivery, inbound Spectrum/iMessage, and the macOS sensor or fake sensor.
```

Add a section:

```markdown
## Canonical Local MVP Runtime

Run the consolidated readiness check:

```bash
npm run doctor:friendy
```

Run with the fake sensor for deterministic local development:

```bash
FRIENDY_SENSOR_MOCK=1 FRIENDY_PROMPT_TRANSPORT=console npm run agent:friendy
```

Run the real Mac runtime after building the sensor:

```bash
npm run build:macos-sensor
npm run doctor:friendy
npm run agent:friendy
```
```

Add the privacy onboarding copy from the spec.

- [ ] **Step 2: Update command table**

In `README.md` and `REFERENCE.md`, add:

```text
npm run doctor:friendy
```

and clarify:

```text
npm run agent:friendy
```

is the foreground MVP runtime, while `agent:spectrum` and `ingest:local:check` are lower-level or legacy development paths.

- [ ] **Step 3: Update implementation notes**

In `implementation-notes.html`, add:

```html
<li>Added the Mac-only MVP runtime reliability plan, covering Node version pinning, CI, <code>doctor:friendy</code>, runtime lifecycle logs, the Agent Behavior Contract, memory correction/search narrowing, redacted traces, and docs alignment. The plan intentionally defers LangChain/LangSmith, SQLite FTS, LaunchAgent packaging, and phone-verification implementation until the foreground runtime is reliable.</li>
```

- [ ] **Step 4: Verify docs**

Run:

```bash
git diff --check
npm run build
```

Expected: whitespace check and build pass.

- [ ] **Step 5: Commit**

```bash
git add README.md REFERENCE.md implementation-notes.html
git commit -m "docs:align friendy runtime guidance"
```

---

## Final Verification

After all tasks pass, run:

```bash
npm test
npm run build
npm run eval:agent
npm run check:imessage-e2e
npm run ingest:local:check -- --mock
npm run agent:friendy:check
FRIENDY_SENSOR_MOCK=1 FRIENDY_PROMPT_TRANSPORT=console npm run doctor:friendy
npm run check:macos-sensor-fixture
git diff --check
```

Expected:

- Unit/integration tests pass.
- Build passes.
- Agent evals pass with zero unsafe mutations.
- Mock local checker passes.
- Foreground runtime check passes.
- `doctor:friendy` passes in mock mode.
- macOS sensor fixture check either passes with a compiled binary or skips successfully on non-macOS without a binary.
- Whitespace check passes.

Record the final verification line in `implementation-notes.html`, then commit:

```bash
git add implementation-notes.html
git commit -m "docs:record mac mvp runtime verification"
```

---

## Deferred Work

These are valuable but should not be mixed into this reliability plan:

- Real phone verification provider integration.
- Landing page UI implementation.
- SQLite FTS5 memory search.
- LangSmith, Langfuse, or LangChain integration.
- Sentry/Pino production logging package decisions.
- LaunchAgent packaging.
- Embeddings.
- Social profile detectors.
- iPhone app support.

---

## Self-Review

- **Spec coverage:** This plan covers Mac-only runtime readiness, clear setup/runtime messaging, behavior-contract centralization, natural save/search wording, follow-up narrowing, correction/update behavior, privacy-safe traces, and end-to-end safe verification. Phone verification and landing-page UI are explicitly separated because another worker is building the landing page and this repo currently needs runtime readiness first.
- **Placeholder scan:** No placeholder markers are used. Each task includes exact files, failing tests, implementation shape, commands, and commit messages.
- **Type consistency:** The plan consistently uses `RelationshipRepository.updateMemory`, `AgentToolCall` value `update_memory`, `AGENT_BEHAVIOR_CONTRACT`, `buildInterpreterSystemPrompt`, and `buildRedactedInteractionTrace`.
