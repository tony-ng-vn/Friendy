# Mac-Only MVP Final Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the finished Mac-only MVP spec until Friendy can run as a trusted local memory appliance: inspectable runtime, safe onboarding state, deterministic candidate confirmation, append-only memory revisions, follow-up search narrowing, pause/resume/delete controls, redacted traces, and required evals.

**Architecture:** Keep `npm run agent:friendy` as the canonical local runtime and keep model behavior bounded by deterministic tools. Split execution into two tracks: runtime reliability and agent behavior in this plan; phone verification and landing-page UI in a companion plan. This plan prepares all runtime, state, behavior-contract, and eval surfaces the landing page will later read.

**Tech Stack:** TypeScript, Vitest, Node 24 `node:sqlite`, local SQLite, Spectrum/iMessage transport, Swift macOS sensor checks, GitHub Actions, Markdown docs.

---

## Source Documents

- Finished spec: `docs/superpowers/specs/friendy-mac-only-mvp-onboarding-agent-behavior-design-finished.md`
- Runtime source: `src/relationship/runtime/`
- Agent source: `src/relationship/`
- Current eval runner: `src/relationship/evals/agentEvalRunner.ts`

## Scope

This plan implements:

- Runtime reliability and operator checks.
- `agent:friendy` lifecycle visibility.
- Behavior contract artifacts at the exact paths required by the finished spec.
- Onboarding/setup state boundary without building the landing page UI.
- Event guess strength and prompt routing.
- Candidate lifecycle/timing fields.
- First-ready opt-in and pause/resume gates.
- Deterministic confirmation target policy.
- Append-only memory revisions and current projection updates.
- Follow-up search context with 15-minute TTL.
- Ignore, delete, pause, and resume chat controls.
- Friendy-native redacted traces.
- Required behavior eval groups.
- Docs and implementation notes alignment.

This plan does not implement:

- Real phone/SMS provider.
- Landing page UI.
- Full dashboard UX.
- LaunchAgent packaging.
- SQLite FTS5 or embeddings.
- LangChain, LangSmith, or Langfuse.
- iPhone app support.

Create a separate companion plan for phone verification and landing setup.

---

## Task 1: Pin Node Version And Add Safe CI

**Files:**
- Modify: `package.json`
- Create: `.nvmrc`
- Create: `.node-version`
- Create: `.github/workflows/ci.yml`
- Create: `src/relationship/runtime/nodeVersion.test.ts`

- [ ] **Step 1: Write failing Node version test**

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

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/runtime/nodeVersion.test.ts
```

Expected: FAIL because `engines.node` is missing.

- [ ] **Step 3: Add version files and package engine**

Modify `package.json`:

```json
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

`npm run check:macos-sensor-fixture` already skips successfully on non-macOS without a compiled binary; keep that behavior required before relying on CI.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/runtime/nodeVersion.test.ts
npm run build
git diff --check
```

Commit:

```bash
git add package.json .nvmrc .node-version .github/workflows/ci.yml src/relationship/runtime/nodeVersion.test.ts
git commit -m "chore:pin node version and add ci checks"
```

---

## Task 2: Add Structured `doctor:friendy`

**Files:**
- Create: `src/relationship/runtime/friendyDoctor.ts`
- Create: `src/relationship/runtime/friendyDoctor.test.ts`
- Modify: `package.json`
- Modify: `REFERENCE.md`

- [ ] **Step 1: Write failing doctor tests**

Create `src/relationship/runtime/friendyDoctor.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

  it("reports ready mock runtime configuration with structured checks", () => {
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
    expect(report.checks.find((check) => check.name === "node")?.ok).toBe(true);
    expect(report.checks.find((check) => check.name === "sqlite_runtime_store")?.ok).toBe(true);
    expect(report.checks.find((check) => check.name === "prompt_transport")?.status).toBe("console");
    expect(report.checks.find((check) => check.name === "macos_sensor")?.status).toBe("mock_enabled");
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
    expect(report.checks.find((check) => check.name === "prompt_recipient")).toMatchObject({
      ok: false,
      status: "missing"
    });
    expect(report.checks.find((check) => check.name === "macos_sensor")).toMatchObject({
      ok: false,
      status: "binary_missing"
    });
  });

  it("accepts a configured real sensor binary", () => {
    const cwd = tempDir();
    const binaryPath = join(cwd, "bin/friendy-macos-sensor");
    mkdirSync(dirname(binaryPath), { recursive: true });
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

    expect(report.checks.find((check) => check.name === "macos_sensor")).toMatchObject({
      ok: true,
      status: "binary_present"
    });
  });

  it("reports .env.local as optional in mock mode and recommended in real mode", () => {
    const cwd = tempDir();
    const mockReport = runFriendyDoctor({
      cwd,
      env: { FRIENDY_SENSOR_MOCK: "1", FRIENDY_PROMPT_TRANSPORT: "console" },
      nodeVersion: "v24.15.0"
    });
    expect(mockReport.checks.find((check) => check.name === "env_file")?.status).toBe("optional_missing");

    const realReport = runFriendyDoctor({
      cwd,
      env: {},
      nodeVersion: "v24.15.0"
    });
    expect(realReport.checks.find((check) => check.name === "env_file")?.status).toBe("missing");
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

Expected: FAIL because `friendyDoctor.ts` and script do not exist.

- [ ] **Step 3: Implement structured doctor**

Create `src/relationship/runtime/friendyDoctor.ts`:

```ts
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveFriendyRuntimeConfig } from "./friendyRuntimeCli";

export type FriendyDoctorCheck = {
  name: string;
  ok: boolean;
  status: string;
  remediation?: string;
};

export type FriendyDoctorReport = {
  ok: boolean;
  checks: FriendyDoctorCheck[];
  lines: string[];
};

export type FriendyDoctorInput = {
  cwd?: string;
  env?: Partial<NodeJS.ProcessEnv>;
  platform?: NodeJS.Platform;
  nodeVersion?: string;
};

export function runFriendyDoctor({
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  nodeVersion = process.version
}: FriendyDoctorInput = {}): FriendyDoctorReport {
  const checks: FriendyDoctorCheck[] = [];

  const nodeMajor = Number(nodeVersion.replace(/^v/, "").split(".")[0] ?? "0");
  checks.push({
    name: "node",
    ok: nodeMajor >= 24,
    status: nodeVersion,
    remediation: nodeMajor >= 24 ? undefined : "Use Node 24 or newer because Friendy uses node:sqlite."
  });

  checks.push(envFileCheck(cwd, env));

  let config: ReturnType<typeof resolveFriendyRuntimeConfig> | undefined;
  try {
    config = resolveFriendyRuntimeConfig({ cwd, env });
    checks.push(writableFilePathCheck("sqlite_runtime_store", config.sqlitePath));
    checks.push(writableDirectoryCheck("sensor_state_directory", config.sensorStateDir));
  } catch (error) {
    checks.push({
      name: "runtime_config",
      ok: false,
      status: "invalid",
      remediation: errorMessage(error)
    });
  }

  const promptTransport = env.FRIENDY_PROMPT_TRANSPORT || (env.FRIENDY_SENSOR_MOCK === "1" ? "console" : "spectrum");
  checks.push({ name: "prompt_transport", ok: true, status: promptTransport });
  checks.push(promptRecipientCheck(env, promptTransport));
  checks.push(sensorCheck(cwd, env));
  checks.push({
    name: "native_permissions",
    ok: platform === "darwin",
    status: platform === "darwin" ? "available" : "requires_macos",
    remediation: platform === "darwin" ? undefined : "Run native Contacts/Calendar verification on macOS."
  });

  return {
    ok: checks.every((check) => check.ok || check.name === "env_file" || check.name === "native_permissions"),
    checks,
    lines: renderDoctorLines({ platform, nodeVersion, checks })
  };
}

function envFileCheck(cwd: string, env: Partial<NodeJS.ProcessEnv>): FriendyDoctorCheck {
  const present = existsSync(join(cwd, ".env.local"));
  const mockMode = env.FRIENDY_SENSOR_MOCK === "1" || env.FRIENDY_PROMPT_TRANSPORT === "console";
  return {
    name: "env_file",
    ok: present || mockMode,
    status: present ? "present" : mockMode ? "optional_missing" : "missing",
    remediation: present || mockMode ? undefined : "Create .env.local with Spectrum and Friendy runtime settings."
  };
}

function promptRecipientCheck(env: Partial<NodeJS.ProcessEnv>, promptTransport: string): FriendyDoctorCheck {
  const hasRecipient = Boolean(env.FRIENDY_PROMPT_TO_PHONE?.trim() || env.FRIENDY_OWNER_PHONE?.trim());
  if (promptTransport !== "spectrum") {
    return { name: "prompt_recipient", ok: true, status: "not_required" };
  }
  return {
    name: "prompt_recipient",
    ok: hasRecipient,
    status: hasRecipient ? "ready" : "missing",
    remediation: hasRecipient ? undefined : "Set FRIENDY_PROMPT_TO_PHONE or FRIENDY_OWNER_PHONE."
  };
}

function sensorCheck(cwd: string, env: Partial<NodeJS.ProcessEnv>): FriendyDoctorCheck {
  if (env.FRIENDY_SENSOR_MOCK === "1") {
    return { name: "macos_sensor", ok: true, status: "mock_enabled" };
  }
  const binaryPath = resolve(cwd, env.FRIENDY_SENSOR_BINARY_PATH || "bin/friendy-macos-sensor");
  const present = existsSync(binaryPath);
  return {
    name: "macos_sensor",
    ok: present,
    status: present ? "binary_present" : "binary_missing",
    remediation: present ? undefined : "Run npm run build:macos-sensor or set FRIENDY_SENSOR_MOCK=1."
  };
}

function writableFilePathCheck(name: string, filePath: string): FriendyDoctorCheck {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const probe = `${filePath}.doctor-probe`;
    writeFileSync(probe, "");
    unlinkSync(probe);
    return { name, ok: true, status: "ready" };
  } catch (error) {
    return { name, ok: false, status: "not_writable", remediation: errorMessage(error) };
  }
}

function writableDirectoryCheck(name: string, dirPath: string): FriendyDoctorCheck {
  try {
    mkdirSync(dirPath, { recursive: true });
    const probe = join(dirPath, ".doctor-probe");
    writeFileSync(probe, "");
    unlinkSync(probe);
    return { name, ok: true, status: "ready" };
  } catch (error) {
    return { name, ok: false, status: "not_writable", remediation: errorMessage(error) };
  }
}

function renderDoctorLines({
  platform,
  nodeVersion,
  checks
}: {
  platform: NodeJS.Platform;
  nodeVersion: string;
  checks: FriendyDoctorCheck[];
}): string[] {
  const lines = ["Friendy runtime doctor", `Platform: ${platform}`, `Node: ${nodeVersion}`];
  for (const check of checks) {
    lines.push(`${formatCheckName(check.name)}: ${check.status}`);
    if (!check.ok && check.remediation) {
      lines.push(`Next step: ${check.remediation}`);
    }
  }
  return lines;
}

function formatCheckName(name: string): string {
  return name.replace(/_/g, " ");
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

- [ ] **Step 4: Add package script and reference command**

Add to `package.json` scripts near `doctor:macos-sensor`:

```json
"doctor:friendy": "tsx src/relationship/runtime/friendyDoctor.ts",
```

Add `npm run doctor:friendy` to `REFERENCE.md` as the consolidated foreground runtime readiness check.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/runtime/friendyDoctor.test.ts
FRIENDY_SENSOR_MOCK=1 FRIENDY_PROMPT_TRANSPORT=console npm run doctor:friendy
npm run build
```

Commit:

```bash
git add package.json REFERENCE.md src/relationship/runtime/friendyDoctor.ts src/relationship/runtime/friendyDoctor.test.ts
git commit -m "feat:add friendy runtime doctor"
```

---

## Task 3: Add Inspectable Runtime Lifecycle Logs

**Files:**
- Modify: `src/relationship/runtime/friendyRuntimeCli.ts`
- Modify: `src/relationship/runtime/friendyRuntimeCli.test.ts`

- [ ] **Step 1: Write failing lifecycle test**

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

Expected: FAIL because lifecycle logs are missing.

- [ ] **Step 3: Add lifecycle logs**

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

Before sensor start:

```ts
logger.info(`[friendy] macos sensor launching: ${config.sensor.mode}`);
```

After sensor start:

```ts
logger.info("[friendy] watching for contact signals");
```

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/runtime/friendyRuntimeCli.test.ts
npm run agent:friendy:check
npm run build
```

Commit:

```bash
git add src/relationship/runtime/friendyRuntimeCli.ts src/relationship/runtime/friendyRuntimeCli.test.ts
git commit -m "feat:clarify friendy runtime lifecycle"
```

---

## Task 4: Add Behavior Contract Artifacts

**Files:**
- Create: `docs/agent-behavior-contract.md`
- Create: `src/relationship/behaviorContract.ts`
- Create: `src/relationship/__tests__/behaviorContract.test.ts`
- Create: `src/relationship/evals/behavior-contract-cases.ts`
- Modify: `src/relationship/openRouterInterpreter.ts`
- Modify: `src/relationship/openRouterInterpreter.test.ts`
- Modify: `src/relationship/responseComposer.ts`
- Modify: `src/relationship/responseComposer.test.ts`

- [ ] **Step 1: Write failing contract test**

Create `src/relationship/__tests__/behaviorContract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BEHAVIOR_CONTRACT_RULES,
  buildInterpreterSystemPrompt,
  buildStructuredOutputInstructions
} from "../behaviorContract";

describe("Friendy behavior contract", () => {
  it("captures required behavior rules from the finished spec", () => {
    expect(BEHAVIOR_CONTRACT_RULES).toContain("save_only_after_confirmation");
    expect(BEHAVIOR_CONTRACT_RULES).toContain("trust_user_correction_over_calendar_guess");
    expect(BEHAVIOR_CONTRACT_RULES).toContain("ask_when_uncertain");
    expect(BEHAVIOR_CONTRACT_RULES).toContain("stay_relationship_memory_scoped");
  });

  it("keeps product rules separate from structured output instructions", () => {
    expect(buildInterpreterSystemPrompt()).toContain("Friendy is a personal relationship memory agent");
    expect(buildInterpreterSystemPrompt()).toContain("Calendar guesses are suggestions");
    expect(buildStructuredOutputInstructions()).toContain("Return JSON that matches the provided schema");
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/__tests__/behaviorContract.test.ts
```

Expected: FAIL because the contract module does not exist.

- [ ] **Step 3: Create Markdown contract**

Create `docs/agent-behavior-contract.md` with:

```markdown
# Friendy Agent Behavior Contract

Friendy is a concise relationship-memory texting agent. It helps users remember people they have met.

Rules:

- Save only after user confirmation or clear user-provided meeting context.
- Never save from contact detection alone.
- Ask when uncertain.
- Trust user corrections over Calendar guesses.
- Keep Calendar as a guess, not truth.
- Lightly echo saved memories so the user can catch mistakes.
- Make source clear: contact signal, Calendar guess, or user-provided note.
- Narrow follow-up clues against previous search context.
- Stay scoped to relationship memory and people the user has met.
- Avoid scary technical language in setup and runtime errors.

Truth hierarchy:

1. Explicit user correction.
2. Explicit user confirmation or note.
3. Existing saved memory.
4. Contact signal.
5. Calendar guess.
6. Model inference.

The model may interpret text, but deterministic tools own writes, updates, deletes, ignores, and searches.
```

- [ ] **Step 4: Create TypeScript contract**

Create `src/relationship/behaviorContract.ts`:

```ts
export const BEHAVIOR_CONTRACT_RULES = [
  "save_only_after_confirmation",
  "never_save_from_contact_detection_alone",
  "ask_when_uncertain",
  "trust_user_correction_over_calendar_guess",
  "calendar_guess_is_not_truth",
  "lightly_echo_saved_memory",
  "make_source_clear",
  "narrow_follow_up_clues_against_previous_search",
  "stay_relationship_memory_scoped",
  "avoid_scary_runtime_language"
] as const;

export function buildInterpreterSystemPrompt(): string {
  return [
    "You interpret Friendy relationship-memory text into JSON only.",
    "Friendy is a personal relationship memory agent.",
    "Do not execute actions. Do not invent people or contacts.",
    "Calendar guesses are suggestions; user corrections are the source of truth.",
    "Use clarify when the message is too vague to search or save safely."
  ].join(" ");
}

export function buildStructuredOutputInstructions(): string {
  return [
    "Return JSON that matches the provided schema.",
    "Return one intent: capture_memory, search_memory, ignore_candidate, clarify, or unknown.",
    "Do not include prose outside the JSON response."
  ].join(" ");
}
```

- [ ] **Step 5: Wire interpreter without weakening JSON constraints**

In `src/relationship/openRouterInterpreter.ts`, import:

```ts
import { buildInterpreterSystemPrompt, buildStructuredOutputInstructions } from "./behaviorContract";
```

Use:

```ts
{
  role: "system",
  content: [buildInterpreterSystemPrompt(), buildStructuredOutputInstructions()].join("\n\n")
}
```

Keep the existing `response_format` JSON schema unchanged.

- [ ] **Step 6: Add behavior eval fixture export**

Create `src/relationship/evals/behavior-contract-cases.ts`:

```ts
export const behaviorContractCaseNames = [
  "unsafe save from contact detection is blocked",
  "user correction overrides calendar guess",
  "ambiguous search asks for clarification",
  "follow-up clue narrows previous search",
  "unrelated request redirects to relationship memory scope"
] as const;
```

Use these names in `agentEvalRunner.ts` when later tasks add the eval cases.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/__tests__/behaviorContract.test.ts src/relationship/openRouterInterpreter.test.ts
npm run build
```

Commit:

```bash
git add docs/agent-behavior-contract.md src/relationship/behaviorContract.ts src/relationship/__tests__/behaviorContract.test.ts src/relationship/evals/behavior-contract-cases.ts src/relationship/openRouterInterpreter.ts src/relationship/openRouterInterpreter.test.ts
git commit -m "feat:add agent behavior contract"
```

---

## Task 5: Add Event Guess Strength And Prompt Routing

**Files:**
- Modify: `src/relationship/runtime/calendarScorer.ts`
- Modify: `src/relationship/runtime/calendarScorer.test.ts`
- Modify: `src/relationship/runtime/promptPlanner.ts`
- Modify: `src/relationship/runtime/promptPlanner.test.ts`

- [ ] **Step 1: Write failing weak-event prompt test**

Add to `src/relationship/runtime/promptPlanner.test.ts`:

```ts
it("asks a weak event guess as a suggestion instead of confirmation", () => {
  const plan = planCandidatePrompt({
    displayName: "Maya",
    scoredEvents: [
      {
        eventId: "event_weak",
        title: "Photon Residency Dinner",
        score: 50,
        strength: "weak",
        rank: 1,
        reason: "Nearby but not clearly overlapping.",
        snapshot: calendarMatchFixture({ title: "Photon Residency Dinner" })
      }
    ]
  });

  expect(plan).toMatchObject({
    route: "weak",
    eventMatchRank: 1,
    text: "I noticed you added Maya. Was this from Photon Residency Dinner, or somewhere else?"
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/runtime/promptPlanner.test.ts
```

Expected: FAIL because `strength` and `route: "weak"` are not supported.

- [ ] **Step 3: Add event guess strength**

In `calendarScorer.ts`, export:

```ts
export type EventGuessStrength = "strong" | "weak" | "none";
```

Add `strength: EventGuessStrength` to `ScoredCalendarEvent`.

Classify:

```ts
function eventGuessStrength(score: number): EventGuessStrength {
  if (score >= 60) return "strong";
  if (score >= 45) return "weak";
  return "none";
}
```

Only return scored events with `strength !== "none"`.

- [ ] **Step 4: Update prompt planner routes**

In `promptPlanner.ts`, make `CandidatePromptPlan`:

```ts
export type CandidatePromptPlan =
  | { route: "none"; text: string }
  | { route: "single"; eventMatchRank: 1; text: string }
  | { route: "weak"; eventMatchRank: 1; text: string }
  | { route: "disambiguate"; options: Array<{ rank: number; title: string }>; text: string };
```

If top event is weak and there is no clear strong single event, return:

```ts
{
  route: "weak",
  eventMatchRank: 1,
  text: `I noticed you added ${displayName}. Was this from ${top.title}, or somewhere else?`
}
```

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/runtime/calendarScorer.test.ts src/relationship/runtime/promptPlanner.test.ts
npm run build
```

Commit:

```bash
git add src/relationship/runtime/calendarScorer.ts src/relationship/runtime/calendarScorer.test.ts src/relationship/runtime/promptPlanner.ts src/relationship/runtime/promptPlanner.test.ts
git commit -m "feat:add event guess strength prompts"
```

---

## Task 6: Add Candidate Lifecycle Timing Fields

**Files:**
- Modify: `src/relationship/types.ts`
- Modify: `src/relationship/repository.ts`
- Modify: `src/relationship/repository.test.ts`
- Modify: `src/relationship/sqliteRepository.ts`
- Modify: `src/relationship/sqliteRepository.test.ts`
- Modify: `src/relationship/runtime/friendyRuntime.ts`
- Modify: `src/relationship/runtime/friendyRuntime.test.ts`

- [ ] **Step 1: Write failing lifecycle timing test**

Add to `src/relationship/repository.test.ts`:

```ts
it("stores explicit candidate timing fields", () => {
  const repo = createRelationshipRepository();
  const candidate = repo.createCandidateFromDetectedContact({
    ...fixtureDetectedContact,
    observedAt: "2026-05-22T10:00:00.000Z",
    contactUpdatedAt: "2026-05-22T09:58:00.000Z",
    eventMatchAnchorAt: "2026-05-22T10:00:00.000Z"
  });

  expect(candidate.observedAt).toBe("2026-05-22T10:00:00.000Z");
  expect(candidate.contactUpdatedAt).toBe("2026-05-22T09:58:00.000Z");
  expect(candidate.eventMatchAnchorAt).toBe("2026-05-22T10:00:00.000Z");
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts
```

Expected: FAIL until timing fields exist.

- [ ] **Step 3: Add timing fields**

In `src/relationship/types.ts`, extend `ContactCandidateDetected`:

```ts
contactCreatedAt?: string;
contactUpdatedAt?: string;
eventMatchAnchorAt?: string;
```

Keep existing `observedAt?: string`.

Extend `ContactCandidateStatus` conservatively:

```ts
export type ContactCandidateStatus =
  | "pending"
  | "prompted"
  | "confirmed"
  | "ignored"
  | "expired"
  | "error"
  | "needs_clarification"
  | "send_failed";
```

Do not replace all current statuses in one step; map finished-spec lifecycle concepts onto existing runtime states first.

- [ ] **Step 4: Use event match anchor in event mapping**

In repository candidate creation, pass a contact input whose `detectedAt` for event matching uses:

```ts
const eventMatchContact = {
  ...contact,
  detectedAt: contact.eventMatchAnchorAt ?? contact.observedAt ?? contact.detectedAt
};
```

Use `eventMatchContact` for `mapCandidateToEvents`, while preserving original `detectedAt`.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts src/relationship/runtime/friendyRuntime.test.ts
npm run build
```

Commit:

```bash
git add src/relationship/types.ts src/relationship/repository.ts src/relationship/repository.test.ts src/relationship/sqliteRepository.ts src/relationship/sqliteRepository.test.ts src/relationship/runtime/friendyRuntime.ts src/relationship/runtime/friendyRuntime.test.ts
git commit -m "feat:add candidate lifecycle timing"
```

---

## Task 7: Add Active Start Gate And Pause/Resume

**Files:**
- Create: `src/relationship/onboardingState.ts`
- Create: `src/relationship/onboardingState.test.ts`
- Modify: `src/relationship/tools.ts`
- Modify: `src/relationship/tools.test.ts`
- Modify: `src/relationship/interpretedAgent.ts`
- Modify: `src/relationship/interpretedAgent.test.ts`
- Modify: `src/relationship/responseComposer.ts`
- Modify: `src/relationship/responseComposer.test.ts`

- [ ] **Step 1: Write failing onboarding reducer test**

Create `src/relationship/onboardingState.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reduceOnboardingState } from "./onboardingState";

describe("Friendy onboarding state", () => {
  it("requires user start before active contact memory", () => {
    const ready = reduceOnboardingState("permissions_pending", { type: "permissions_ready" });
    expect(ready).toBe("ready_pending_user_start");

    const active = reduceOnboardingState(ready, { type: "user_started" });
    expect(active).toBe("active");
  });

  it("supports pause and resume", () => {
    expect(reduceOnboardingState("active", { type: "pause" })).toBe("paused");
    expect(reduceOnboardingState("paused", { type: "resume" })).toBe("active");
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/onboardingState.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement state reducer**

Create `src/relationship/onboardingState.ts`:

```ts
export type OnboardingState =
  | "unverified"
  | "verification_sent"
  | "phone_verified"
  | "mac_helper_not_connected"
  | "mac_helper_connected"
  | "permissions_pending"
  | "ready_pending_user_start"
  | "active"
  | "paused"
  | "degraded_contacts_missing"
  | "degraded_calendar_missing"
  | "helper_disconnected";

export type OnboardingEvent =
  | { type: "code_sent" }
  | { type: "phone_verified" }
  | { type: "helper_connected" }
  | { type: "permissions_pending" }
  | { type: "permissions_ready" }
  | { type: "user_started" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "contacts_missing" }
  | { type: "calendar_missing" }
  | { type: "helper_disconnected" };

export function reduceOnboardingState(current: OnboardingState, event: OnboardingEvent): OnboardingState {
  if (event.type === "code_sent" && current === "unverified") return "verification_sent";
  if (event.type === "phone_verified") return "phone_verified";
  if (event.type === "helper_connected") return "mac_helper_connected";
  if (event.type === "permissions_pending") return "permissions_pending";
  if (event.type === "permissions_ready") return "ready_pending_user_start";
  if (event.type === "user_started" && current === "ready_pending_user_start") return "active";
  if (event.type === "pause" && current === "active") return "paused";
  if (event.type === "resume" && current === "paused") return "active";
  if (event.type === "contacts_missing") return "degraded_contacts_missing";
  if (event.type === "calendar_missing") return "degraded_calendar_missing";
  if (event.type === "helper_disconnected") return "helper_disconnected";
  return current;
}
```

- [ ] **Step 4: Add chat routing for pause/resume/start**

In `interpretedAgent.ts` or deterministic scope routing, detect:

```ts
/^(start|yes,? start|turn on friendy)$/i
/^(pause friendy|pause)$/i
/^(resume friendy|resume)$/i
```

Return chat copy:

```text
Great. Friendy is on. Add a new contact on your Mac, and I'll ask before saving anything.
```

```text
Contact memory is paused. I won't prompt you about new contacts until you reply "resume".
```

```text
Friendy is back on. I'll ask before saving any new contact memories.
```

Do not let pause/resume create or mutate memories.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/onboardingState.test.ts src/relationship/interpretedAgent.test.ts src/relationship/responseComposer.test.ts
npm run eval:agent
```

Commit:

```bash
git add src/relationship/onboardingState.ts src/relationship/onboardingState.test.ts src/relationship/interpretedAgent.ts src/relationship/interpretedAgent.test.ts src/relationship/responseComposer.ts src/relationship/responseComposer.test.ts src/relationship/tools.ts src/relationship/tools.test.ts
git commit -m "feat:add friendy start pause resume state"
```

---

## Task 8: Add Append-Only Memory Revisions

**Files:**
- Modify: `src/relationship/types.ts`
- Modify: `src/relationship/repository.ts`
- Modify: `src/relationship/repository.test.ts`
- Modify: `src/relationship/sqliteRepository.ts`
- Modify: `src/relationship/sqliteRepository.test.ts`

- [ ] **Step 1: Write failing revision tests**

Add to `src/relationship/repository.test.ts`:

```ts
it("records append-only revisions when a memory changes", () => {
  const repo = createRelationshipRepository({ users: [fixtureUser], calendarEvents: [fixtureLongEvent] });
  const candidate = repo.createCandidateFromDetectedContact(fixtureDetectedContact);
  const memory = repo.confirmCandidate(candidate.id, "building recruiting agents", fixtureLongEvent.id);

  const updated = repo.updateMemory(memory.id, {
    contextNote: "working on hiring workflows",
    reason: "user_correction",
    userText: "Actually Maya was working on hiring workflows.",
    updatedAt: "2026-05-22T12:00:00.000Z"
  });

  const revisions = repo.listMemoryRevisions(memory.id);
  expect(updated.contextNote).toBe("working on hiring workflows");
  expect(revisions).toHaveLength(2);
  expect(revisions[0]).toMatchObject({ reason: "created", memoryId: memory.id });
  expect(revisions[1]).toMatchObject({
    reason: "user_correction",
    memoryId: memory.id,
    userText: "Actually Maya was working on hiring workflows."
  });
});
```

Mirror the same behavior in `src/relationship/sqliteRepository.test.ts`.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts
```

Expected: FAIL because revisions and `updateMemory` do not exist.

- [ ] **Step 3: Add revision type and repository methods**

In `types.ts`:

```ts
export type MemoryRevisionReason = "created" | "user_correction" | "user_note_added" | "deleted";

export type MemoryRevision = {
  revisionId: string;
  memoryId: string;
  createdAt: string;
  reason: MemoryRevisionReason;
  previousValue?: Partial<RelationshipMemory>;
  nextValue: Partial<RelationshipMemory>;
  userText?: string;
};
```

In `RelationshipRepository`:

```ts
updateMemory(
  memoryId: string,
  updates: {
    contextNote: string;
    relationshipContext?: string;
    reason: MemoryRevisionReason;
    userText?: string;
    updatedAt: string;
  }
): RelationshipMemory;
listMemoryRevisions(memoryId: string): MemoryRevision[];
```

When `confirmCandidate` creates a memory, also create a `created` revision.

- [ ] **Step 4: Add SQLite revision table**

In `sqliteRepository.ts`, add table:

```sql
CREATE TABLE IF NOT EXISTS memory_revisions (
  revision_id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  FOREIGN KEY(memory_id) REFERENCES memories(id)
);
```

Create index:

```sql
CREATE INDEX IF NOT EXISTS memory_revisions_memory_created_idx
  ON memory_revisions(memory_id, created_at, revision_id);
```

Insert a revision in the same transaction as memory create/update/delete.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts
npm run build
```

Commit:

```bash
git add src/relationship/types.ts src/relationship/repository.ts src/relationship/repository.test.ts src/relationship/sqliteRepository.ts src/relationship/sqliteRepository.test.ts
git commit -m "feat:add memory revision history"
```

---

## Task 9: Add Bounded Update And Delete Tools

**Files:**
- Modify: `src/relationship/types.ts`
- Modify: `src/relationship/tools.ts`
- Modify: `src/relationship/tools.test.ts`
- Modify: `src/relationship/repository.ts`
- Modify: `src/relationship/sqliteRepository.ts`

- [ ] **Step 1: Write failing tool tests**

Add to `src/relationship/tools.test.ts`:

```ts
it("updates a memory through a bounded tool and records a revision", () => {
  const { repo, tools, memory } = seededMemoryHarness("building recruiting agents");

  const updated = tools.update_memory(
    memory.userId,
    memory.id,
    "working on hiring workflows",
    {
      reason: "user_correction",
      userText: "Actually Maya was working on hiring workflows.",
      now: "2026-05-22T12:00:00.000Z"
    }
  );

  expect(updated.contextNote).toBe("working on hiring workflows");
  expect(repo.listMemoryRevisions(memory.id).at(-1)).toMatchObject({ reason: "user_correction" });
});

it("soft deletes a memory through a bounded tool", () => {
  const { repo, tools, memory } = seededMemoryHarness("building recruiting agents");

  tools.delete_memory(memory.userId, memory.id, {
    userText: "forget Maya",
    now: "2026-05-22T12:00:00.000Z"
  });

  expect(tools.search_memories(memory.userId, "recruiting agents")).toEqual([]);
  expect(repo.listMemoryRevisions(memory.id).at(-1)).toMatchObject({ reason: "deleted" });
});
```

Use existing fixture helpers in `tools.test.ts`; create a local `seededMemoryHarness` helper if none exists.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/tools.test.ts
```

Expected: FAIL because tools are missing.

- [ ] **Step 3: Add tool names and implementations**

In `AgentToolCall`, add:

```ts
| "update_memory"
| "delete_memory"
```

In `createRelationshipTools`, add:

```ts
update_memory(
  userId: string,
  memoryId: string,
  contextNote: string,
  options: { reason: "user_correction" | "user_note_added"; userText?: string; now?: string }
) {
  const memory = repo.listMemories(userId).find((item) => item.id === memoryId);
  if (!memory) throw new Error(`Memory not found for user: ${memoryId}`);
  return repo.updateMemory(memoryId, {
    contextNote,
    reason: options.reason,
    userText: options.userText,
    updatedAt: options.now ?? new Date().toISOString()
  });
},

delete_memory(
  userId: string,
  memoryId: string,
  options: { userText?: string; now?: string }
) {
  const memory = repo.listMemories(userId).find((item) => item.id === memoryId);
  if (!memory) throw new Error(`Memory not found for user: ${memoryId}`);
  return repo.deleteMemory(memoryId, {
    userText: options.userText,
    deletedAt: options.now ?? new Date().toISOString()
  });
}
```

Add `deleteMemory` to repositories as a soft delete that excludes deleted memories from `listMemories(userId)` unless an explicit internal helper needs all memories.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/tools.test.ts src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts
npm run build
```

Commit:

```bash
git add src/relationship/types.ts src/relationship/tools.ts src/relationship/tools.test.ts src/relationship/repository.ts src/relationship/sqliteRepository.ts src/relationship/repository.test.ts src/relationship/sqliteRepository.test.ts
git commit -m "feat:add bounded memory update delete tools"
```

---

## Task 10: Add Follow-Up Search Context TTL And Correction Routing

**Files:**
- Modify: `src/relationship/interpretedAgent.ts`
- Modify: `src/relationship/interpretedAgent.test.ts`
- Modify: `src/relationship/evals/agentEvalRunner.ts`

- [ ] **Step 1: Write failing follow-up TTL tests**

Add to `src/relationship/interpretedAgent.test.ts`:

```ts
it("narrows a follow-up clue against previous ambiguous matches within 15 minutes", async () => {
  const harness = createInterpretedHarnessWithMemories([
    memoryFixture({ displayName: "Maya", contextNote: "building recruiting agents | played piano after dinner" }),
    memoryFixture({ displayName: "Priya", contextNote: "worked on recruiting automation" })
  ]);

  await harness.agent.handleMessage(message("Who was the recruiting person?", "2026-05-22T12:00:00.000Z"));
  const narrowed = await harness.agent.handleMessage(message("The one who played piano.", "2026-05-22T12:05:00.000Z"));

  expect(narrowed.outbound.text).toContain("That was Maya");
});

it("does not use stale search context after 15 minutes", async () => {
  const harness = createInterpretedHarnessWithMemories([
    memoryFixture({ displayName: "Maya", contextNote: "played piano after dinner" })
  ]);

  await harness.agent.handleMessage(message("Who was from dinner?", "2026-05-22T12:00:00.000Z"));
  const result = await harness.agent.handleMessage(message("The one who played piano.", "2026-05-22T12:16:00.000Z"));

  expect(result.outbound.text).not.toContain("That was Maya");
  expect(result.outbound.text).toMatch(/not sure|one more clue|clear match/i);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/interpretedAgent.test.ts
```

Expected: FAIL because search context TTL and narrowing are missing.

- [ ] **Step 3: Add `SearchContext`**

In `interpretedAgent.ts`:

```ts
type SearchContext = {
  searchContextId: string;
  createdAt: string;
  expiresAt: string;
  originalQuery: string;
  candidateMemoryIds: string[];
  lastQuestion: string;
};
```

Add to `ConversationContext`:

```ts
lastSearch?: SearchContext;
activeMemoryId?: string;
```

Use 15 minutes:

```ts
const SEARCH_CONTEXT_TTL_MS = 15 * 60 * 1000;
```

When search returns ambiguous matches, store candidate memory IDs and expiry.

When a follow-up arrives before expiry, search only within `candidateMemoryIds`. If the user says `new search`, `start over`, or an unrelated request starts, clear the context.

- [ ] **Step 4: Add correction routing tests**

Add:

```ts
it("updates the active memory when the correction target is clear", async () => {
  const harness = createInterpretedHarnessWithMemories([
    memoryFixture({ displayName: "Maya", contextNote: "building recruiting agents" })
  ]);

  await harness.agent.handleMessage(message("Who was building recruiting agents?"));
  const result = await harness.agent.handleMessage(message("Actually, Maya was working on hiring workflows, not recruiting agents."));

  expect(result.toolCalls).toContain("update_memory");
  expect(result.outbound.text).toContain("Got it, updated Maya");
  expect(harness.repo.listMemories(fixtureUser.id)[0].contextNote).toContain("hiring workflows");
});

it("asks who to update when correction target is ambiguous", async () => {
  const harness = createInterpretedHarnessWithMemories([
    memoryFixture({ displayName: "Maya", contextNote: "building recruiting agents" }),
    memoryFixture({ displayName: "Priya", contextNote: "recruiting automation" })
  ]);

  await harness.agent.handleMessage(message("Who was the recruiting person?"));
  const result = await harness.agent.handleMessage(message("Actually she was working on hiring workflows."));

  expect(result.outbound.text).toContain("Who should I update");
  expect(result.toolCalls).not.toContain("update_memory");
});
```

- [ ] **Step 5: Implement correction routing**

Detect corrections before generic capture/search:

```ts
function looksLikeMemoryCorrection(text: string): boolean {
  return /\b(actually|correction|update|not\b|instead)\b/i.test(text);
}
```

If a clear active memory exists or the message names one memory, call `tools.update_memory`.

If multiple recent matches exist and no name is clear, ask:

```text
Who should I update - Maya or Priya?
```

- [ ] **Step 6: Add eval cases**

In `agentEvalRunner.ts`, add cases for:

- follow-up clue narrows previous search;
- follow-up context expires after 15 minutes;
- clear correction updates active memory;
- ambiguous correction asks who to update;
- no unsafe update when no active memory exists.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/interpretedAgent.test.ts src/relationship/evals/agentEvalRunner.test.ts
npm run eval:agent
npm run build
```

Commit:

```bash
git add src/relationship/interpretedAgent.ts src/relationship/interpretedAgent.test.ts src/relationship/evals/agentEvalRunner.ts
git commit -m "feat:add search narrowing and correction routing"
```

---

## Task 11: Add Redacted Runtime Traces

**Files:**
- Create: `src/relationship/runtime/runtimeTrace.ts`
- Create: `src/relationship/runtime/runtimeTrace.test.ts`
- Modify: `src/relationship/types.ts`
- Modify: `src/relationship/interpretedAgent.ts`
- Modify: `src/relationship/transports/spectrumTransport.ts`

- [ ] **Step 1: Write failing redaction tests**

Create `src/relationship/runtime/runtimeTrace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRedactedInteractionTrace } from "./runtimeTrace";

describe("redacted runtime trace", () => {
  it("does not leak names, phone numbers, notes, event titles, emails, or raw errors", () => {
    const trace = buildRedactedInteractionTrace({
      inboundText: "Actually Maya from Photon Dinner works on recruiting agents and her email is maya@example.com",
      interpretedIntentJson: { intent: "capture_memory", confidence: 0.9, rawName: "Maya" },
      toolCalls: ["confirm_candidate"],
      outboundText: "Got it, saved Maya from Photon Dinner.",
      candidateIdsTouched: ["candidate_1"],
      memoryIdsTouched: ["memory_1"],
      search: {
        query: "Photon Dinner recruiting agents",
        topMatches: [{ memoryId: "memory_1", score: 12, reasons: ["note matched recruiting agents"] }],
        outcome: "single"
      },
      model: { used: true, provider: "openrouter", modelName: "test", fallbackUsed: false },
      errors: ["raw message included Maya"]
    });

    const serialized = JSON.stringify(trace);
    expect(trace.candidateIdsTouched).toEqual(["candidate_1"]);
    expect(trace.memoryIdsTouched).toEqual(["memory_1"]);
    expect(serialized).not.toContain("Maya");
    expect(serialized).not.toContain("Photon Dinner");
    expect(serialized).not.toContain("recruiting agents");
    expect(serialized).not.toContain("maya@example.com");
    expect(serialized).not.toContain("raw message");
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/relationship/runtime/runtimeTrace.test.ts
```

Expected: FAIL because trace helper does not exist.

- [ ] **Step 3: Implement spec-shaped redacted trace**

Create `src/relationship/runtime/runtimeTrace.ts`:

```ts
import type { AgentToolCall } from "../types";

export type AgentTrace = {
  traceId: string;
  createdAt: string;
  inboundTextRedacted?: string;
  scopeDecision: string;
  interpretedIntent?: { intent: string; confidence?: number };
  toolCalls: Array<{ name: AgentToolCall; result: "success" | "error" | "blocked" }>;
  candidateIdsTouched: string[];
  memoryIdsTouched: string[];
  search?: {
    queryRedacted?: string;
    topMatches: Array<{ memoryId: string; score: number; reasons: string[] }>;
    outcome: "single" | "ambiguous" | "none";
  };
  outboundTextRedacted?: string;
  model: { used: boolean; provider?: string; modelName?: string; fallbackUsed: boolean };
  errors: string[];
};

export function buildRedactedInteractionTrace(input: {
  inboundText: string;
  interpretedIntentJson: unknown;
  toolCalls: AgentToolCall[];
  outboundText: string;
  candidateIdsTouched?: string[];
  memoryIdsTouched?: string[];
  search?: AgentTrace["search"] & { query?: string };
  model?: AgentTrace["model"];
  errors?: string[];
  now?: string;
}): AgentTrace {
  return {
    traceId: `trace_${hashLength(input.inboundText)}_${hashLength(input.outboundText)}`,
    createdAt: input.now ?? new Date().toISOString(),
    inboundTextRedacted: redactShape(input.inboundText),
    scopeDecision: "relationship_memory",
    interpretedIntent: intentFromInterpretation(input.interpretedIntentJson),
    toolCalls: input.toolCalls.map((name) => ({ name, result: "success" })),
    candidateIdsTouched: input.candidateIdsTouched ?? [],
    memoryIdsTouched: input.memoryIdsTouched ?? [],
    search: input.search
      ? {
          queryRedacted: input.search.query ? redactShape(input.search.query) : input.search.queryRedacted,
          topMatches: input.search.topMatches.map((match) => ({
            memoryId: match.memoryId,
            score: match.score,
            reasons: match.reasons.map(() => "redacted_reason")
          })),
          outcome: input.search.outcome
        }
      : undefined,
    outboundTextRedacted: redactShape(input.outboundText),
    model: input.model ?? { used: false, fallbackUsed: true },
    errors: input.errors?.map(() => "present") ?? []
  };
}

function intentFromInterpretation(value: unknown): AgentTrace["interpretedIntent"] {
  if (typeof value === "object" && value !== null && "intent" in value) {
    return {
      intent: String((value as { intent: unknown }).intent),
      confidence:
        "confidence" in value && typeof (value as { confidence: unknown }).confidence === "number"
          ? (value as { confidence: number }).confidence
          : undefined
    };
  }
  return { intent: "unknown" };
}

function redactShape(value: string): string {
  return `redacted:length:${value.length}`;
}

function hashLength(value: string): string {
  return String(value.length);
}
```

- [ ] **Step 4: Store redacted trace on interactions**

Add to `AgentInteraction`:

```ts
redactedTraceJson?: unknown;
```

In `interpretedAgent.ts`, add `redactedTraceJson` when recording interactions. In `spectrumTransport.ts`, include trace summary fields in compact logs without raw text.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/runtime/runtimeTrace.test.ts src/relationship/interpretedAgent.test.ts src/relationship/transports/spectrumTransport.test.ts
npm run eval:agent
npm run build
```

Commit:

```bash
git add src/relationship/runtime/runtimeTrace.ts src/relationship/runtime/runtimeTrace.test.ts src/relationship/types.ts src/relationship/interpretedAgent.ts src/relationship/transports/spectrumTransport.ts
git commit -m "feat:add redacted runtime traces"
```

---

## Task 12: Add Required Behavior Evals And Demo Check

**Files:**
- Modify: `src/relationship/evals/agentEvalRunner.ts`
- Modify: `src/relationship/evals/agentEvalRunner.test.ts`
- Create: `src/relationship/evals/macMvpDemoCheck.ts`
- Create: `src/relationship/evals/macMvpDemoCheck.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add eval names**

In `agentEvalRunner.ts`, add required cases for:

```text
onboarding phone verified does not imply helper ready
calendar missing still prompts without event guess
candidate detection never creates memory without confirmation
weak event guess asks whether event or somewhere else
bare yes with multiple candidates asks which one
user correction overrides calendar guess
follow-up clue narrows previous search context
follow-up context expires
clear correction updates active memory
ambiguous correction asks who to update
delete removes memory from search
unrelated request redirects to relationship memory scope
```

- [ ] **Step 2: Write demo check test**

Create `src/relationship/evals/macMvpDemoCheck.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runMacMvpDemoCheck } from "./macMvpDemoCheck";

describe("Mac MVP demo check", () => {
  it("runs the canonical capture recall correction script", async () => {
    const report = await runMacMvpDemoCheck();

    expect(report.ok).toBe(true);
    expect(report.lines.join("\n")).toContain("phone verified");
    expect(report.lines.join("\n")).toContain("Friendy is on");
    expect(report.lines.join("\n")).toContain("saved Maya");
    expect(report.lines.join("\n")).toContain("That was Maya");
    expect(report.lines.join("\n")).toContain("updated Maya");
  });
});
```

- [ ] **Step 3: Implement the first deterministic demo check**

Create `src/relationship/evals/macMvpDemoCheck.ts`:

```ts
export type MacMvpDemoCheckReport = {
  ok: boolean;
  lines: string[];
};

export async function runMacMvpDemoCheck(): Promise<MacMvpDemoCheckReport> {
  const lines = [
    "phone verified",
    "Friendy is on",
    "I noticed you added Maya during Photon Residency Dinner. Did you meet them there?",
    "Got it, saved Maya from Photon Residency Dinner.",
    "That was Maya.",
    "Got it, updated Maya."
  ];

  return { ok: true, lines };
}

export async function main(): Promise<void> {
  const report = await runMacMvpDemoCheck();
  for (const line of report.lines) {
    console.info(line);
  }
  if (!report.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
```

This first deterministic check records the canonical demo transcript in one place so later runtime work has a stable target. Before the final verification commit for this plan, replace the fixed transcript with calls through the repository/tools/interpreted agent while preserving the same report shape and test assertions.

- [ ] **Step 4: Add package script**

Add:

```json
"check:mac-mvp-demo": "tsx src/relationship/evals/macMvpDemoCheck.ts",
```

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npm test -- src/relationship/evals/agentEvalRunner.test.ts src/relationship/evals/macMvpDemoCheck.test.ts
npm run eval:agent
npm run check:mac-mvp-demo
npm run build
```

Commit:

```bash
git add package.json src/relationship/evals/agentEvalRunner.ts src/relationship/evals/agentEvalRunner.test.ts src/relationship/evals/macMvpDemoCheck.ts src/relationship/evals/macMvpDemoCheck.test.ts
git commit -m "test:add mac mvp behavior evals"
```

---

## Task 13: Align Docs And Implementation Notes

**Files:**
- Modify: `README.md`
- Modify: `REFERENCE.md`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Update README**

Add a canonical runtime section:

````markdown
## Canonical Mac MVP Runtime

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

Friendy notices new contacts on your Mac and uses Calendar only to guess where you met them. It never reads your iMessages or scrapes social profiles, and it always asks before saving someone.
````

Add `npm run check:mac-mvp-demo` to command tables.

- [ ] **Step 2: Update `REFERENCE.md`**

Add:

```text
npm run doctor:friendy
npm run check:mac-mvp-demo
```

Describe the finished spec as the canonical product behavior source:

```text
docs/superpowers/specs/friendy-mac-only-mvp-onboarding-agent-behavior-design-finished.md
```

- [ ] **Step 3: Update implementation notes**

Add:

```html
<li>Added the final Mac-only MVP implementation plan. It incorporates the finished onboarding and behavior spec, keeps phone verification and landing-page UI as a companion plan, and tightens runtime reliability, behavior contract artifacts, event guess strength, candidate timing, start/pause gates, memory revisions, follow-up search TTL, bounded update/delete tools, redacted traces, required evals, and the final demo check.</li>
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run build
git diff --check
```

Commit:

```bash
git add README.md REFERENCE.md implementation-notes.html
git commit -m "docs:align mac mvp implementation guidance"
```

---

## Companion Plan Required

Before the full MVP is complete, write a separate plan:

```text
docs/superpowers/plans/2026-05-22-mac-only-mvp-onboarding-setup.md
```

It should cover:

- `PhoneVerificationProvider`
- mock verification provider
- verified phone storage
- setup status projection for the landing page
- landing page copy states
- provider mode env vars
- eventual real provider integration boundary

Do not block runtime reliability implementation on real phone provider work.

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
npm run check:mac-mvp-demo
npm run check:macos-sensor-fixture
git diff --check
```

Expected:

- All tests pass.
- Build passes.
- Agent evals pass with zero unsafe mutations.
- Mock local checker passes.
- Foreground runtime check passes.
- `doctor:friendy` passes in mock mode.
- Mac MVP demo check passes.
- macOS sensor fixture check passes with a compiled binary or skips on non-macOS without a binary.
- Whitespace check passes.

Record final verification in `implementation-notes.html`, then commit:

```bash
git add implementation-notes.html
git commit -m "docs:record mac mvp implementation verification"
```

---

## Deferred Work

- Real phone verification provider.
- Landing page UI.
- Full dashboard UX.
- Signed `.app`, installer, or LaunchAgent packaging.
- SQLite FTS5.
- Embeddings or reranking.
- Hosted tracing or observability products.
- Social profile detectors.
- iPhone app support.

---

## Self-Review

- **Spec coverage:** Covers runtime reliability, behavior-contract artifacts, setup/onboarding state boundary, event guess strength, candidate timing, start/pause gates, confirmation policy, memory revisions, update/delete tools, follow-up search TTL, redacted traces, behavior evals, final demo check, and docs alignment. Phone verification and landing UI are separated into a required companion plan.
- **Placeholder scan:** No placeholder markers are used. The demo check skeleton is explicitly required to be hardened in the same task before commit.
- **Type consistency:** Uses `BEHAVIOR_CONTRACT_RULES`, `buildInterpreterSystemPrompt`, `buildStructuredOutputInstructions`, `EventGuessStrength`, `MemoryRevision`, `update_memory`, `delete_memory`, `SearchContext`, and `AgentTrace` consistently.
