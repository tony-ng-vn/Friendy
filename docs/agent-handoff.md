# Agent Handoff

Use this file when starting a **new agent session** or handing work to another engineer. It is the short-lived “what is true right now” layer. It is **not** a substitute for specs or implementation history.

## Read Order (new agent)

1. **`REFERENCE.md`** — repo map, commands, key modules.
2. **`docs/agent-handoff.md`** (this file) — current status, active goal, blockers, last verified E2E.
3. **Active goal** (if any) — e.g. `docs/goals/mac-mvp-e2e-contact-detection-goal.md` or the next task in `docs/goals/mac-mvp-final-goal-runbook.md`.
4. **`implementation-notes.html`** — decisions, tradeoffs, edge cases, verification history (read the **Known MVP Edge Cases** and latest **Implementation Decisions** sections; do not load the whole file unless debugging history).

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

## Current Status (2026-05-22)

| Item | State |
|------|--------|
| **Mac MVP contact E2E** | **Working** — verified live with contact “Testing 12” |
| **Latest fix commit** | `1d62345` — `fix:repair macOS contact detection through debounce and snapshot fallback` |
| **Active goal** | `docs/goals/mac-mvp-e2e-contact-detection-goal.md` — **complete** (see goal file); next work: `docs/goals/mac-mvp-final-goal-runbook.md` |
| **Branch** | `main` (pushed) |

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
- Broad relationship recall phrasing such as “Anyone in my contacts related to Friendy?” can still hit the generic scope redirect even when matching memories exist. Spec A is written at `docs/superpowers/specs/2026-05-22-relationship-routing-and-query-normalization-design.md`; later retrieval upgrades are scoped in Spec B at `docs/superpowers/specs/2026-05-22-relationship-hybrid-retrieval-design.md`.
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
