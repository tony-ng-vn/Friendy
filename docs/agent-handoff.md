# Agent Handoff

Use this file when starting a **new agent session** or handing work to another engineer. It is the short-lived “what is true right now” layer. It is **not** a substitute for specs or implementation history.

## Read Order (new agent)

1. **`REFERENCE.md`** — repo map, commands, key modules.
2. **`.understand-anything/knowledge-graph.json`** — optional searchable graph index for architecture orientation, dependency routing, and targeted file discovery. Inspect `project`, `layers`, and `tour` first; source and docs remain authoritative.
3. **`docs/agent-handoff.md`** (this file) — current status, active goal, blockers, last verified E2E.
4. **Active goal** (if any) — e.g. `docs/goals/mac-mvp-e2e-contact-detection-goal.md` or the next task in `docs/goals/mac-mvp-final-goal-runbook.md`.
5. **`implementation-notes.html`** — decisions, tradeoffs, edge cases, verification history (read the **Known MVP Edge Cases** and latest **Implementation Decisions** sections; do not load the whole file unless debugging history).

Do **not** point a new agent at `implementation-notes.html` alone. It is long and chronological. Use this handoff file first, then drill into implementation notes for specifics.

## Copy/Paste Prompt (new agent)

```text
Read REFERENCE.md, then docs/agent-handoff.md, then the active goal linked there. Follow AGENTS.md. When you change behavior or finish a goal, update docs/agent-handoff.md, the active goal file, and implementation-notes.html as required by docs/agent-handoff.md.
```

## Agent Update Rule (required)

Whenever you **finish meaningful work**, **change runtime behavior**, **close a goal**, or **discover a new live E2E edge case**, update **all** of:

| Artifact | What to update |
|----------|----------------|
| **`docs/agent-handoff.md`** | Current status, active goal, last commit, last manual E2E result, open blockers, restart ritual if it changed |
| **Active goal file** (`docs/goals/*-goal.md`) | Check completion criteria; move open issues; add evidence timestamps |
| **`implementation-notes.html`** | Non-obvious decisions, tradeoffs, verification commands run, new edge cases |
| **`REFERENCE.md`** | Only if navigation, commands, or primary entry points changed |

Skip updates only for trivial typo/docs-only edits with no behavioral impact.

## Current Status (2026-05-24)

### PR 4 Branch Status

- Branch: `pr4-state-into-llm-router`, rebased cleanly onto `origin/main` at `3d7d727`.
- PR 4 pass-state-into-LLM-router is implemented on this branch.
- `routerInputEnvelope.ts` owns the compact router envelope: `userText`, active workflow, bounded recent context placeholders, pending-candidate summaries, same-name saved/pending summaries, available deterministic tools, and route capabilities.
- `interpretedAgent.ts` builds the envelope after pending state is reconstructed and before `interpreter.interpret({ message, routerContext })`.
- `openRouterInterpreter.ts` serializes the envelope into the OpenRouter user message when present; raw text remains the no-context compatibility path.
- No PR 5/6/7 prep modules are wired here. Pending reminder policy, identity resolution, duplicate resolution, and robust target lookup remain separate integration PRs.
- `npm run friendy:stack-status` reports PR 4 as `done`, PR 5-7 as `prep`, PR 8 as `done`, PR 9 as `partial`, and PR 10 as `plan ready`.
- The requested `.agents/skills/friendy-fix-stack/references/parallel-tracks.md` file was not present in this checkout; repo search found no `parallel-tracks.md`.

### PR 4 Handoff For PR 5

- PR 5 should hook pending-reminder decisions after the existing route policy decision in `interpretedAgent.ts`, where `pendingState.activeFrame`, `interpretation.intent`, `allowedPolicy.suppressPendingReminder`, and the final `outboundText` are all available.
- Do not put reminder decisions into the router envelope. The envelope is routing context for the LLM; reminder/footer presentation should remain deterministic.
- The current inline reminder append remains in place for PR 5 to replace:
  `if (pendingState.activeFrame && interpretation.intent === "search_memory" && !allowedPolicy.suppressPendingReminder) ...`.

| Item | State |
|------|--------|
| **Mac MVP contact E2E** | **Working** — verified live with contact “Testing 12” |
| **Latest fix** | Review fixes at `3d7d727` (real memory timestamps, redact local contact checks) |
| **Latest navigation update** | Understand Anything graph generated and linked from `AGENTS.md` / `REFERENCE.md` as a searchable repo index |
| **Active goal** | Concrete fix stack PR 4–10 (see merge order below) |
| **Branch** | `main` |

### Fix stack status (2026-05-23, parallel prep batch)

Run `npm run friendy:stack-status` for live PR 1–10 state.

| PR | Topic | Status on `main` |
|----|--------|------------------|
| 1–3 | Regression freeze, `list_people`, structured router | **Done** |
| 4 | Pass state into LLM router (envelope) | **In progress elsewhere** — plan ready |
| 5 | Pending reminder policy | **Prep** — `pendingReminderPolicy` module landed |
| 6 | Identity resolution | **Prep** — `identityResolution` + `lookupMemoryTarget` modules landed |
| 7 | Robust delete/update | **Prep** modules on main (full PR not merged as stack unit) |
| 8 | Sensor normalization ack | **Done** on `main` |
| 9 | Strict-mode dogfooding trace | **Partial** — wave 1 doctor/CLI warning at `32b3456`; Task 1 trace delta fields in flight |
| 10 | Durable conversation session | Plan ready |

**Recommended merge order:** PR 4 → 5 → 6 → 7 → PR 9 wave 2 → 10

**PR 9 wave 1 (merged):** strict-off runtime warning, doctor strict + OpenRouter key hints (`32b3456`).

**PR 9 Task 1 (in flight):** extend `FriendyTrace` with delta fields (`scope_boundary`, `ActiveWorkflowKind`, model/workflow/scope metadata). Tasks 2–3 blocked on PR 4 envelope.

### Active implementation status (2026-05-23, strict mode baseline)

- Added `FRIENDY_STRICT_MODE` parsing and typed `FriendyStrictModeError`.
- Added `FriendyTrace` to interpreted-agent results and persisted interaction JSON.
- Redacted runtime traces now include strict mode, route source, fallback usage, fallback reason, policy decision, active ids, and tool calls without raw private text.
- OpenRouter interpreter now reports `routeSource`, `fallbackUsed`, and `fallbackReason`.
- Strict mode throws on missing API key fallback, model execution failure, invalid schema, explicit fallback interpreter use, unknown model route, unsupported contact-management route, missing deterministic tool, and ambiguous executable memory mutation.
- Spectrum/iMessage runtime reads `FRIENDY_STRICT_MODE`.
- Evals now include fallback usage count and a strict-mode fallback-rejection case.
- Full verification passed on 2026-05-23: `npm test` 52 files/340 tests, `npm run build`, `npm run eval:agent` 36/36 with `Fallback usage count: 31`, and `git diff --check`.

### Active implementation status (2026-05-23)

- RED transcript coverage was added for the Sarah Fan / Photon Residency routing failures.
- Focused fixes are implemented and focused tests/build are green:
  - active pending-contact context now routes before previous-search follow-up;
  - `She is a community lead...` confirms the active pending contact;
  - `Sarah Fan is a community lead...` saves a clean note;
  - active pending inquiry identifies the active prompt and queued next contact;
  - list-all search while a contact prompt is open answers the list and reminds about the pending prompt;
  - `Who did I meet/met at Photon Residency?` routes as event recall;
  - `add/save/remember Person as/is/from/at context` creates Friendy memory only.
  - generic recoverable fallback copy was removed from the scope boundary.
- Full verification passed on 2026-05-23: `npm test` 51 files/322 tests, `npm run build`, `npm run eval:agent` 35/35, and `git diff --check`.
- Goal implementation commit was pushed to `main` as `1f2bdb1`.
- Follow-up fix: `Do you know anyone in my contact?` is covered as list-all recall and should call `search_memories` instead of the out-of-scope blocker.

### Verified live flow (2026-05-22)

1. `npm run agent:friendy` (app bundle sensor, terminal stays open)
2. User texts **`start`** → agent replies, snapshot reset for post-start detection
3. User adds **new** contact (name + phone) in Contacts
4. ~5–15s later: iMessage “I noticed you added {name}…”
5. User replies with meeting context → memory saved in SQLite
6. Recall question returns the person

### Root cause fixed (2026-05-22)

The Swift sensor called `schedulePendingContactEmit()` on **every poll** while contacts were pending. That invalidated the 5s debounce timer each poll, so `flushPendingContactAdds()` never ran and `contact_added` was never emitted. Fix: schedule debounce only when **new** identifiers are queued; skip if a valid timer is already running. Also added identifier **snapshot diff** fallback when CNChangeHistory misses adds, **post-start snapshot reset**, orphan sensor cleanup, and app-bundle launch hardening.

### Known follow-ups (not blocking MVP use)

- `npm run check:mac-mvp-e2e-state` may report **missing history batch ack file** even after a successful iMessage flow — investigate ack path if automating proof.
- Broad relationship recall routing Spec A is implemented: “Anyone in my contacts related to Friendy?” should now route to `search_memories` and avoid the generic redirect.
- Deterministic Spec B retrieval is implemented: generated memory search documents, document-lexical evidence, SQLite search-document backfill/sync, optional local FTS5 rows when available, and merged repository retrieval candidates. Optional embeddings and LLM reranking remain deferred.
- Pending-prompt inquiry wording is generalized: questions like “Who are you asking?”, “who are u asking?”, “What contact do you mean?”, or “Do you mean Testing 2?” should now return the pending-contact ambiguity reply instead of the generic redirect.
- List-all contact recall is read-only: phrases like “What person do I know so far?”, “Just give me all the people in my contact so far”, and “Show me everyone I know” route to `search_memories`, return saved people or an empty-list message, and do not confirm pending candidates.
- Broad related-contact recall covers `related`, `connected`, and `associated with` phrasing, including singular `contact`, “Who do I know connected to Friendy?”, “Do I know anyone associated with Friendy?”, “Find contacts related to Friendy”, and “Anyone I met while testing Friendy?” while keeping “Tell me about Friendy as a company” out of scope.
- Live `agent:friendy` logs now print `[friendy:agent_turn]` with raw `userText` and `agentReply`, plus the existing redacted `[friendy:agent_interaction]` trace.
- Each `agent:friendy` restart requires texting **`start`** again (by design).
- Only **net-new** contacts after `start` prompt; pre-start adds are ignored for idempotency.
- Saving in Contacts ≠ Friendy memory until the user replies to the iMessage prompt.

## Restart Ritual (Mac live E2E)

```bash
cd ~/Desktop/Friendy
pkill -f friendy-macos-sensor 2>/dev/null
pkill -f friendyRuntimeCli 2>/dev/null
npm run build:macos-sensor   # only after Swift changes
npm run agent:friendy
```

Then: text **`start`** → add a **brand-new** contact (name + phone) → wait ~15s.

Confirm launch log includes `"kind":"app_bundle"`. Do not run the raw `bin/friendy-macos-sensor` binary from Terminal (wrong TCC identity).

## Environment

| Item | Path / value |
|------|----------------|
| Repo | `/Users/minhthiennguyen/Desktop/Friendy` |
| Agent | `npm run agent:friendy` |
| Sensor app | `bin/Friendy macOS Sensor.app` |
| Sensor state | `.friendy/macos-sensor-state/` |
| SQLite | `.friendy/friendy.sqlite` |
| Env | `.env.local` (`FRIENDY_OWNER_PHONE`, Spectrum credentials) |

## Verification Commands

```bash
npm test
npm run build
npm run eval:agent
npm run agent:friendy:check
npm run check:mac-mvp-demo
npm run check:mac-mvp-e2e-state   # after manual Mac E2E
npm run build:macos-sensor        # after Swift changes
```

## Key Files (contact detection)

| Area | Path |
|------|------|
| Agent entry | `src/relationship/runtime/friendyRuntimeCli.ts` |
| Runtime / gating | `src/relationship/runtime/friendyRuntime.ts` |
| Sensor process | `src/relationship/runtime/sensorProcess.ts` |
| Snapshot reset | `src/relationship/runtime/macosSensorState.ts` |
| Swift sensor | `swift/FriendyMacOSSensor/Sources/FriendyMacOSSensor/NativeMacosSensor.swift` |
| Edge cases & history | `implementation-notes.html` |
