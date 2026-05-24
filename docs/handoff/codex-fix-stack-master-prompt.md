# Codex Master Prompt — Friendy Fix Stack PR 5–10 (Post–PR 4)

Copy everything inside the fenced block below into Codex as your opening message.

---

```text
You are taking over the Friendy Relationship Memory Agent fix stack on `main`. Cursor-side work landed PRs 1–4 and parallel **prep modules** for PRs 5–10. Your job is to **finish integration** (wire prep into `interpretedAgent.ts` and runtime), add missing tests/evals, update handoff docs, and land the remaining stack in merge order.

**IMPORTANT — this handoff may be wrong.** Cursor wrote it from conversation context, not live proof of every claim. You MUST independently verify before trusting it. Launch a review team (see Phase 0 below), use Superpowers skills, and correct anything that does not match the repo. Do not implement on stale assumptions.

## Phase 0 — Verify handoff before coding (REQUIRED)

Do NOT start PR 5 integration until Phase 0 passes. Announce: "Running Phase 0 handoff audit."

### Skills to invoke first

Read and follow these skills (paths are typical Codex/Superpowers install locations — search repo + home if missing):

| When | Skill | Purpose |
|------|--------|---------|
| Session start | `superpowers:using-superpowers` | Discover and invoke skills; do not skip |
| Phase 0 audit | `superpowers:doubt-driven-development` | Adversarial review — try to disprove handoff claims |
| Before any "done/passing" claim | `superpowers:verification-before-completion` | Evidence before assertions; run commands fresh |
| Per PR execution | `superpowers:subagent-driven-development` | Fresh implementer + spec reviewer + quality reviewer per task |
| If no subagent support | `superpowers:executing-plans` | Same plans with manual checkpoints |
| After each PR / before merge | `superpowers:requesting-code-review` | Dispatch reviewer with BASE/HEAD SHAs + plan excerpt |
| When review feedback arrives | `superpowers:receiving-code-review` | Verify feedback against code before implementing |
| Test failures / regressions | `superpowers:systematic-debugging` | Root cause before fixes |
| New integration behavior | `superpowers:test-driven-development` | Red-green on agent wiring when plan specifies |
| Stack complete | `superpowers:finishing-a-development-branch` | Final verification + merge/PR options |

Also use project skill if present: `.agents/skills/friendy-fix-stack/` (see `references/parallel-tracks.md`).

### Launch review team (parallel audit, then orchestrator proceeds)

If your platform supports subagents/tasks, dispatch **in parallel** for Phase 0:

**Agent A — Handoff fact-checker (read-only)**
- Run: `git log -15 --oneline`, `git status -sb`, `npm run friendy:stack-status`
- Run: `npm test`, `npm run build`, `npm run eval:agent` (record exact counts — do not trust "448 tests" in this doc)
- For each claim in "What Cursor already landed" and "What is NOT wired": verify with `grep`, `rg`, or file reads
- Key grep checks (expected at handoff — **confirm yourself**):
  - `decidePendingReminder` in `interpretedAgent.ts` → likely **absent** (PR 5 not wired)
  - `buildRouterInputEnvelope` in `interpretedAgent.ts` → likely **present** (PR 4)
  - `pendingReminderDecision` in `trace.ts` → likely **absent** (PR 5 Task 4)
  - `resolve_duplicate_person` in `tools.ts` → likely **absent** (PR 6 Task 5)
  - `conversationSession` in `interpretedAgent.ts` → likely **absent** (PR 10)
- Compare `docs/agent-handoff.md` vs git reality; flag stale sections
- Output: bullet list **CONFIRMED** / **WRONG** / **UNKNOWN** per handoff section

**Agent B — Plan-vs-repo gap analyst (read-only)**
- For each PR 5–10: read `docs/superpowers/plans/2026-05-23-*.md` and matching spec
- Walk plan checkboxes against actual files; mark each task **done / partial / not started**
- Flag if stack-status script marks PR 6/7/10 "done" but agent wiring is missing (script uses file existence, not integration)
- Output: corrected task matrix per PR

**Agent C — Adversarial reviewer (read-only)**
- Use doubt-driven-development posture: assume Cursor overstated "done" and understated open bugs
- Re-read `docs/reviews/current-system-audit.md` and open blocker table in this prompt
- Identify top 5 risks if Codex blindly follows this handoff
- Output: ranked risk list + what to verify during integration

**Orchestrator (you)** merges A/B/C outputs into `docs/handoff/codex-handoff-audit.md` (create this file) with:
1. Verified baseline (test count, eval count, HEAD SHA)
2. Corrected PR status table (override this prompt where wrong)
3. Corrected "start here" task list
4. Open questions / blockers before coding

Only proceed to Phase 1 when:
- Fresh `npm test` + `npm run build` + `npm run eval:agent` all exit 0
- You have grep/file evidence for PR 4 wired and PR 5–10 integration gaps
- Audit doc written and disagreements with this prompt explicitly noted

If audit contradicts this prompt, **trust the repo + plans**, not this document.

---

## Phase 1 — Execute fix stack (after Phase 0)

Use **superpowers:subagent-driven-development** for each PR:

1. **Implementer subagent** — one PR at a time for hot files; full plan task text in prompt; no inherited chat history
2. **Spec reviewer subagent** — diff vs `docs/superpowers/specs/` + plan; BLOCK if spec mismatch
3. **Code quality reviewer subagent** — bugs, edge cases, test gaps; use `code-review` / `code-reviewer` skill if available
4. **Orchestrator** — only one subagent touches `interpretedAgent.ts` at a time; run verification after each task

Per-task gate (verification-before-completion):
```bash
npm test -- <targeted test files from plan>
npm run build
# after agent-facing changes:
npm run eval:agent
git diff --check
```

After each PR lands: `superpowers:requesting-code-review` with BASE_SHA=pre-PR commit, HEAD_SHA=current, attach plan Tasks completed.

### Self-evaluation checklist (run after EVERY PR, not only at end)

| Check | Command / action |
|-------|------------------|
| Stack status | `npm run friendy:stack-status` — PR should move prep → done only if **wired in agent**, not just module exists |
| No inline legacy path | `rg composePendingContactReminder interpretedAgent.ts` — should be gone after PR 5 |
| Eval regression | `npm run eval:agent` — full pass; note Fallback usage count |
| Spec tasks | Re-read plan checkboxes; mark done only with evidence |
| Handoff docs | Update `docs/agent-handoff.md`, `implementation-notes.html` |
| Audit trail | Append PR summary to `docs/handoff/codex-handoff-audit.md` |

---

## Repo & rules

- Repo: `/Users/minhthiennguyen/Desktop/Friendy`
- Branch: `main` (synced with `origin/main` at merge `4e5d8c4`)
- Follow `AGENTS.md` at repo root
- Read order before coding:
  1. `REFERENCE.md`
  2. `docs/agent-handoff.md` (stale in places — trust this prompt + git state)
  3. `docs/handoff/README.md` (this folder index)
  4. `.agents/skills/friendy-fix-stack/references/parallel-tracks.md`
  5. Per-PR plan under `docs/superpowers/plans/2026-05-23-*.md`
  6. Per-PR spec under `docs/superpowers/specs/2026-05-23-*.md`
- Optional architecture index: `.understand-anything/knowledge-graph.json` (search only; source is authoritative)
- Commit format: `<scope>:<message>` e.g. `feat:wire pending reminder policy`
- After meaningful behavior changes, update: `docs/agent-handoff.md`, active goal if any, `implementation-notes.html`
- Do NOT run destructive git commands without explicit approval
- One agent per hot file: `interpretedAgent.ts`, `openAIInterpreter.ts` — serialize integration PRs

## Verification baseline (green at handoff)

```bash
npm test          # 65 files, 448 tests
npm run build
npm run eval:agent  # 36/36 pass, Fallback usage count ~35
npm run friendy:stack-status
```

## Stack status snapshot

Run `npm run friendy:stack-status` for live state. At handoff:

| PR | Topic | Status | Notes |
|----|--------|--------|-------|
| 1 | Regression freeze | **done** | eval harness frozen cases |
| 2 | list_people tool | **done** | in `tools.ts` |
| 3 | Structured intent router | **done** | `routePolicyValidator.ts` |
| 4 | Pass state into LLM router | **done** | merged PR #11 `4e5d8c4` |
| 5 | Pending reminder policy | **prep** | module exists; NOT wired in agent |
| 6 | Identity resolution | **prep+repo** | schema/repo done; agent workflow NOT wired |
| 7 | Robust delete/update | **prep+tool** | lookup tool + composers; agent routing NOT wired |
| 8 | Sensor normalization ack | **done** | `normalizeSensorEvent.ts`, runtime |
| 9 | Strict-mode dogfooding trace | **partial** | wave 1 + trace types; wave 2 blocked on agent wiring |
| 10 | Durable conversation session | **prep** | types + in-memory store; SQLite + agent NOT wired |

**Recommended merge / execution order:**

```
PR 5 (full integration) → PR 6 (agent workflow) → PR 7 (agent routing)
  → PR 9 wave 2 (trace + May 23 joint eval)
  → PR 10 (SQLite session + runtime wiring)
```

PR 8 is already done. PR 6 and PR 7 can share prep work but **full integration** depends on PR 5 reminder suppression.

---

## What Cursor already landed (do not redo)

### Merged PR 4 — Pass state into LLM router (`4e5d8c4`)

- **New:** `src/relationship/routerInputEnvelope.ts` + tests
- **Wired:** `interpretedAgent.ts` builds `buildRouterInputEnvelope(...)` after pending state reconstruction, passes `routerContext` to `interpreter.interpret({ message, routerContext })`
- **Wired:** `openAIInterpreter.ts` serializes envelope into OpenAI user message
- **Eval:** state envelope routing eval cases (`fb15762`, etc.)

Key rule from PR 4: **Do not put reminder/footer decisions in the router envelope.** Envelope is LLM routing context only; reminder presentation stays deterministic in the agent.

### Review blocker fixes (`3d7d727`) — already on main

1. **Real memory timestamps** — `confirmCandidate` uses `options.confirmedAt ?? new Date().toISOString()` in repository + sqlite
2. **Local-check PII redaction** — `contactMethodRedaction.ts`, hash-based diffing in `contactSnapshot.ts`, redaction in `localMacAdapters.ts`
3. **Local-check SQLite parity** — `createLocalCheckRepository()` in `localCheck.ts`

### PR 8 — Sensor normalization (`normalizeSensorEvent.ts`, runtime ack lifecycle) — done

### PR 9 wave 1 — done

- Strict-off runtime warning in `friendyRuntimeCli.ts`
- Doctor strict + OpenAI key hints in `friendyDoctor.ts`

### PR 9 Task 1 partial — trace delta types (`7137bda`)

- `src/relationship/trace.ts`: `ActiveWorkflowKind`, `scope_boundary` route source, `modelRequested`, `modelResponseSchemaValid`, `modelErrorCode`, `activeWorkflowKind`, `selectedTool`
- `src/relationship/trace.test.ts` added
- **Still missing:** agent populates these fields on real turns; OpenAI interpreter sets schema-valid flags on all paths; scope-boundary short-circuit trace; PR 5 `pendingReminderDecision` fields

### Parallel prep commits on main (modules only — integrate, don't rewrite)

| Commit | What landed |
|--------|-------------|
| `eaa9e16` | `lookup_memory_target` tool in `tools.ts` + tests |
| `500a612` | `composePendingContactsFooter`, delete/update disambiguation composers in `responseComposer.ts` |
| `5173117` | Route policy delegates suppression to `shouldSuppressPendingReminder*` from `pendingReminderPolicy.ts` (compatibility layer; append/defer still inline in agent) |
| `e77f15a` | Person identity repo API + SQLite migration v3 (`person_identities`, `apple_contact_links`, `memories.person_id`) |
| `d5eda2d` | `conversationSession.ts`, `conversationSessionStore.ts` (in-memory only) + tests |
| `7137bda` | Trace delta fields + handoff refresh |

### Prep modules that exist and have tests (use them)

- `src/relationship/pendingReminderPolicy.ts` — `decidePendingReminder`, TTL/cooldown/same-name suppression
- `src/relationship/personIdentity.ts` — fingerprints, types
- `src/relationship/duplicateResolution.ts` — `parseDuplicateResolutionReply` (tests exist)
- `src/relationship/memoryTargetLookup.ts` — fuzzy target lookup
- `src/relationship/conversationSession.ts` + `conversationSessionStore.ts`

### Tooling

- `npm run friendy:stack-status` — read-only PR 1–10 detector
- Plans: `docs/superpowers/plans/2026-05-23-*.md`
- Specs: `docs/superpowers/specs/2026-05-23-*.md`

---

## What is NOT wired yet (your work)

### PR 5 — Pending reminder policy (**START HERE**)

**Plan:** `docs/superpowers/plans/2026-05-23-pending-reminder-policy.md`
**Spec:** `docs/superpowers/specs/2026-05-23-pending-reminder-policy-design.md`

**Done (Tasks 1–3, partial 7):**
- Pure policy module + tests
- `composePendingContactsFooter` in `responseComposer.ts`
- Route policy uses `shouldSuppressPendingReminder*` (compatibility)

**You must complete (Tasks 4–8):**

1. **Task 4 — Trace:** Add `pendingReminderDecision` and `pendingReminderReason` to `FriendyTrace` + `runtimeTrace.ts` redaction
2. **Task 5 — Agent wiring:** In `interpretedAgent.ts`:
   - Add `reminderState` to process-local `ConversationContext`
   - **Replace** inline append at ~line 750:
     ```ts
     if (pendingState.activeFrame && interpretation.intent === "search_memory" && !allowedPolicy.suppressPendingReminder) {
       outboundText = `${outboundText} ${composePendingContactReminder(...)}`;
     }
     ```
   - Call `decidePendingReminder(buildPendingReminderContext(...))` after primary response
   - On `append`: use `composePendingContactsFooter` with `\n\n` separator (not inline `. I still need context for...`)
   - Update `reminderState` (TTL, complaint cooldown, clear on confirm)
   - Attach trace: `pendingReminderDecision`, `pendingReminderReason`, keep `suppressedPendingReminder` as compatibility projection
3. **Task 6 — Evals:** Add cases in `agentEvalRunner.ts`: `pending-reminder-search-footer`, `pending-reminder-same-name-suppression`, `pending-reminder-ttl-defer`, `pending-reminder-list-never-footer`
4. **Task 8 — Docs:** Update `implementation-notes.html` + `docs/agent-handoff.md`

**Integration hook (from PR 4 handoff):** Hook after route policy decision where `pendingState.activeFrame`, `interpretation.intent`, `allowedPolicy.suppressPendingReminder`, and final `outboundText` are all available.

---

### PR 6 — Identity resolution (after PR 5)

**Plan:** `docs/superpowers/plans/2026-05-23-identity-resolution.md`

**Done (Tasks 1–4):** types, repo API, SQLite schema v3, `duplicateResolution.ts` parser

**You must complete (Tasks 5–7):**

1. **Task 5:** `resolve_duplicate_person` tool + `composeDuplicateResolutionPrompt` (composers may be partial — check spec)
2. **Task 6 — Agent workflow:** In `interpretedAgent.ts`:
   - Detect display-name collision at candidate prompt time → duplicate resolution prompt
   - Handle active duplicate workflow **before** generic pending confirm
   - No `confirm_candidate` before same/different/ignore/not_sure resolution
   - Trace: `activeWorkflowKind: "duplicate_resolution"`
3. **Task 7:** Verify eval `same-name-pending-contact-disambiguation-regression` passes

**Depends on PR 5** for same-name reminder suppression coordination.

---

### PR 7 — Robust delete/update (after PR 5, ideally after PR 6)

**Plan:** `docs/superpowers/plans/2026-05-23-robust-delete-update.md`

**Done (Tasks 1–2):** `memoryTargetLookup.ts`, `lookup_memory_target` tool, delete/update composers

**You must complete (Tasks 3–5):**

1. **Task 3 — Agent routing:** delete/update request → lookup → confirm prompt → no mutation same turn; multi-match numbered pick; extend `ConversationContext` with pending update/delete frames; remove/gate inline delete lookup
2. **Task 4 — Policy/trace:** strict mode requires lookup before mutation; `activeWorkflowKind` for confirm frames
3. **Task 5:** Verify `fuzzy-delete-memory-confirmation-regression` eval

Note: `interpretedAgent.ts` still has some inline delete confirm paths — migrate to lookup-driven flow per spec.

---

### PR 9 wave 2 — Strict-mode dogfooding trace (after PR 4–7 agent wiring)

**Plan:** `docs/superpowers/plans/2026-05-23-strict-mode-dogfooding-trace.md`

**Done:** wave 1 doctor/CLI warning; Task 1 trace type extensions

**You must complete (Tasks 2–3, 6):**

1. **Task 2:** OpenAI interpreter sets `modelResponseSchemaValid`, `modelRequested`, `modelErrorCode` on all paths
2. **Task 3:** `interpretedAgent.ts` scope-boundary short-circuit → `routeSource: "scope_boundary"`; populate `activeWorkflowKind`, `selectedTool` on real turns
3. **Task 6:** Joint May 23 acceptance test — mocked OpenAI transcript; strict on → no fallback on list/duplicate/repair/delete turns

**Known open blocker (external review, still valid):** Scope vs executor gap for drafting/follow-up/social intents — may need additional `interpretedAgent` routing work beyond trace-only changes. Investigate if May 23 eval fails.

---

### PR 10 — Durable conversation session (last)

**Plan:** `docs/superpowers/plans/2026-05-23-durable-conversation-session.md`

**Done (Tasks 1–2):** session types, in-memory store + tests

**You must complete (Tasks 3–6):**

1. **Task 3:** SQLite `conversation_sessions` table + store on same DB as memories
2. **Task 4:** Agent load/upsert at turn start/end; Map becomes write-through cache when `FRIENDY_RUNTIME_STORE=sqlite`
3. **Task 5:** Envelope builder + reminder policy read `session.reminderState` / workflow fields
4. **Task 6:** Wire session store in `friendyRuntimeCli.ts` for sqlite runtime

**Restart test required:** agent A sets pending delete → new agent B loads session → confirm delete works.

---

## Hot integration file — `interpretedAgent.ts`

Central orchestrator. Current PR 4 wiring (~line 630):

```ts
const routerContext = buildRouterInputEnvelope({ message, conversationState: pendingState, ... });
interpretation = await interpreter.interpret({ message, routerContext });
```

Still using **legacy inline reminder** (~line 750) — PR 5 replaces this.

Still using **Map-only `ConversationContext`** — PR 10 replaces with durable session when sqlite runtime.

Grep confirms NOT yet present in agent: `decidePendingReminder`, `composePendingContactsFooter`, `conversationSession`, `reminderState`, `resolve_duplicate_person`.

---

## Open review / audit items (prioritize during integration)

| Issue | Status |
|-------|--------|
| Hard-coded confirm timestamps | **Fixed** `3d7d727` |
| Legacy local checker PII in snapshots | **Fixed** `3d7d727` |
| Scope vs executor gap (drafting/follow-up/social) | **Open** — may surface in PR 9 Task 6 |
| Durable path / shared state between local check and live runtime | **Partial** — PR 10 + existing sqlite runtime; live verify still needed |
| `npm run check:mac-mvp-e2e-state` ack file false negative | Known follow-up, not blocking |

---

## Local uncommitted changes (check before you start)

At handoff there were **unstaged local edits** (may be WIP — stash or commit separately from fix stack):

- `docs/friendy-dev-preferences.md`
- `src/agent.ts`, `src/App.tsx`, `src/types.ts` (legacy demo shell)
- `src/relationship/hardSafetyBlock.ts`, `src/relationship/messageSafetyPatterns.ts` (untracked)
- `src/relationship/ingestion/contactMethodRedaction.ts`, `contactSnapshot.ts`
- `src/relationship/runtime/runtimeTrace.ts`
- `src/relationship/transports/*`

Run `git status` first. Prefer integrating fix stack on a clean tree or dedicated branch.

---

## Execution strategy for Codex

0. **Phase 0 audit** — launch review team; write `docs/handoff/codex-handoff-audit.md`; fix wrong assumptions in this prompt
1. `git pull` && verify green baseline (test/build/eval) — record actual numbers in audit doc
2. **PR 5 end-to-end** — subagent-driven; plan Tasks 4–8; spec + quality review after each task
3. **PR 6** — same pattern; run same-name evals
4. **PR 7** — same pattern; run fuzzy-delete eval
5. **PR 9 wave 2** — interpreter + agent trace + May 23 joint test; adversarial review if eval fails
6. **PR 10** — SQLite session + runtime wiring + restart test
7. **Final review team** — one read-only agent re-runs full verification + stack-status; one adversarial agent tries to break reminder/duplicate/delete flows via tests
8. `superpowers:finishing-a-development-branch` — present merge/PR options with evidence

## Success criteria

- [ ] Inline `composePendingContactReminder` append removed from search happy path; footer policy drives reminders
- [ ] Same-name duplicate resolution blocks premature `confirm_candidate`
- [ ] Delete/update always go through `lookup_memory_target` + confirm frames
- [ ] Traces include workflow kind, reminder decision, scope-boundary route source where applicable
- [ ] Conversation session survives process restart on sqlite runtime
- [ ] All tests + 36+ eval cases pass
- [ ] `docs/agent-handoff.md` reflects merged PR 4 and completed PR 5–10 work

## Mac live E2E (manual, after stack complete)

```bash
pkill -f friendy-macos-sensor 2>/dev/null; pkill -f friendyRuntimeCli 2>/dev/null
npm run agent:friendy
# Text "start" → add brand-new contact → wait ~15s → confirm flow
```

Env: `.env.local` with `FRIENDY_OWNER_PHONE`, Spectrum credentials. SQLite: `.friendy/friendy.sqlite`.

Begin with **Phase 0 audit** (review team + `docs/handoff/codex-handoff-audit.md`). Only then PR 5 Task 4 (trace fields) → Task 5 (agent wiring). Read the full PR 5 plan before editing `interpretedAgent.ts`.

When reporting progress to the human: cite command output (test counts, SHAs), not confidence. If unsure, say UNKNOWN and grep/read the file.
```

---

## Short copy-paste variant

If Codex context is limited, use this shorter opener and point it at this file:

```text
Continue the Friendy fix stack on main at /Users/minhthiennguyen/Desktop/Friendy.

Read docs/handoff/codex-fix-stack-master-prompt.md in full — but DO NOT trust it blindly. Cursor may have errors.

Phase 0 (required before coding):
1. Invoke superpowers:using-superpowers + superpowers:doubt-driven-development
2. Launch 3 read-only review agents in parallel: handoff fact-checker, plan-vs-repo gap analyst, adversarial reviewer (prompts in master doc)
3. Run fresh: npm test, npm run build, npm run eval:agent, npm run friendy:stack-status — record actual counts
4. Grep-verify wiring claims (decidePendingReminder, buildRouterInputEnvelope, etc.)
5. Write docs/handoff/codex-handoff-audit.md with CONFIRMED/WRONG/UNKNOWN; override master doc where wrong

Phase 1: Use superpowers:subagent-driven-development per PR (5→6→7→9→10). After each task: verification-before-completion + requesting-code-review. One agent at a time on interpretedAgent.ts.

Also read: AGENTS.md, REFERENCE.md, docs/handoff/README.md, .agents/skills/friendy-fix-stack/references/parallel-tracks.md

Start integration only after Phase 0 passes. First code work: PR 5 plan Tasks 4–8 (pending reminder policy).
```
