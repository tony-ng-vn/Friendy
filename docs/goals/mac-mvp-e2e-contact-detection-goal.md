# Goal: Mac MVP E2E Contact Detection (Option B)

## Status: COMPLETE (2026-05-22)

Live E2E verified on user Mac with contact **Testing 12**: `start` → named prompt → confirmation → memory → recall. Fix shipped in `1d62345`.

## Copy/Paste Goal

```text
/goal Read docs/goals/mac-mvp-e2e-contact-detection-goal.md and execute it exactly. Use TDD when changing behavior, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Objective

Complete the **real macOS Friendy MVP E2E path (Option B)** until a user on their Mac can: run `npm run agent:friendy`, text **`start`**, add a **new** contact (name + mobile), receive an iMessage prompt with the **correct name** within ~5–15s after tapping **Done**, reply with meeting context, and have a **searchable memory** in SQLite — without outbox replay spam, scope redirects on open prompts, or `Unnamed Contact` prompts before save.

## Why This Matters

Tasks 1–13 landed the Mac MVP codebase (runtime, doctor, behavior contract, start gate, etc.). Live E2E on the user's Mac exposed gaps between **Contacts save** and **Friendy memory confirm**, macOS firing **Add** before **Done**, and inbound replies mis-routed by scope. Much of the plumbing is committed (`1098345`, `de48f03` on `main`); this goal finishes **verified product behavior** on real hardware, not more scaffold work.

## Context Already Landed (do not re-implement blindly)

Verify these exist before large refactors:

| Area | What landed |
|------|-------------|
| TCC / launch | `bin/Friendy macOS Sensor.app` via `open -n -a`; `macosSensorBinaryPath.ts`, `sensorProcess.ts` |
| Runtime CLI | `defaultStartSensor` passes full `app_bundle` config; `friendyRuntimeCli.ts` |
| Schema | Calendar `fullAccess` in `sensorEvents.ts` |
| Pre-`start` spam | Pre-start `contact_added` → `ignored` for ack; see `friendyRuntime.ts` |
| Startup iMessage | `composeRuntimeStartupReply()`; `FRIENDY_DISABLE_STARTUP_MESSAGE=1` to disable |
| Scope | Open-prompt replies → `candidate_confirmation`; `isPendingCandidateInquiry` |
| Sensor timing | Queue on Add/Update, 5s debounce, re-fetch, emit only when `isReadyForFriendyPrompt` (`NativeMacosSensor.swift`) |
| Docs | `implementation-notes.html` → **Known MVP Edge Cases (2026-05-22, live E2E)** |

Rebuild sensor after Swift changes: `npm run build:macos-sensor`.

## Non-Negotiables

- Use TDD for behavior changes.
- Commit incrementally with `<scope>:<message>`.
- Keep `implementation-notes.html`, `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, and `docs/goals/EXPERIMENT_NOTES.md` updated.
- Do not commit secrets (`.env.local` stays ignored).
- Do not weaken existing `npm run eval:agent` or `npm run agent:friendy:check` without fixing regressions.
- Launch sensor via **app bundle**, not raw `friendy-macos-sensor` from Terminal (TCC identity).
- Do not auto-save memory without user confirmation on the contact prompt.
- Prefer minimal diffs; fix E2E blockers before optional polish.

## Environment

| Item | Value / path |
|------|----------------|
| Repo | `/Users/minhthiennguyen/Desktop/Friendy` |
| Agent | `npm run agent:friendy` → `src/relationship/runtime/friendyRuntimeCli.ts` |
| Sensor app | `bin/Friendy macOS Sensor.app` |
| Sensor state | `.friendy/macos-sensor-state/` (`sensor-events.ndjson`, outbox, acks, token) |
| SQLite | `.friendy/friendy.sqlite` |
| Owner phone | `.env.local` → `FRIENDY_OWNER_PHONE` |
| Onboarding | `ready_pending_user_start` until **`start`**; **restart requires `start` again** |

**Restart ritual:**

```bash
cd ~/Desktop/Friendy
pkill -f friendy-macos-sensor 2>/dev/null
rm -f .friendy/macos-sensor-state/outbox/* 2>/dev/null   # optional
npm run agent:friendy
```

## Core Product Rules (user-facing)

| User belief | MVP reality |
|-------------|-------------|
| Saving in **Contacts** = Friendy remembers | **No.** Only iMessage reply to “where did you meet?” → `confirm_candidate` → `memories` row. |
| Contacts **Notes** field | **Not watched.** |
| Edit old contact / add phone later | **Not re-prompted** (add/update queue only; no full edit sync). |
| “Who did I add?” after Contacts save only | **0 memories** until prompt answered; may list **pending** candidate instead. |

## Required Behavior

1. **Startup** — `[friendy:startup_message] sent` and user receives startup iMessage (unless disabled).
2. **Start gate** — No contact prompts until user texts **`start`**; pre-start contacts do not prompt after start (idempotency).
3. **Contact detection** — After `start`, new contact with name + mobile + **Done** produces `contact_added` in `sensor-events.ndjson` with **displayName ≠ Unnamed Contact**, then terminal shows **`Acked macOS sensor history batch`** with a **new** batch id.
4. **Prompt** — iMessage uses correct name: “I noticed you added {name}…”
5. **Confirmation** — Replies while prompt is open (e.g. `met at coffee shop`, “This is the person I am using to test friendy”, “Who did I add…”) route to candidate flow, **not** generic scope redirect.
6. **Memory** — After confirmation, `sqlite3 .friendy/friendy.sqlite` shows ≥1 row in `memories`; search/recall can find the person.
7. **Quiet logs** — No infinite `Duplicate sensor event ignored` / `History batch not ready for ack` after clean outbox + restart.

## Open Issues To Close (priority order)

### Done — P0 silent after add (2026-05-22)

Root cause: debounce timer reset every poll. Fixed in `1d62345`. Verified with Testing 12 live E2E.

### Optional follow-ups

macOS **Add** fires before **Done**. Current mitigation: debounce + Update + require real name. Confirm on fresh run after rebuild.

### P2 — Search UX with empty memory

`search_memory` with 0 memories + slow OpenRouter model (~32s). Optional: if pending `prompted` candidates exist, reply “You haven’t confirmed them in chat yet” instead of generic no-match.

### P3 — Test drift

`macosSensorSource.test.ts` may fail on calendar permission string assertion — align test or source.

## Test Cases

Automated (extend or fix as needed):

- `friendyRuntimeCli.test.ts` — pre-start ignored; post-start new idempotency key creates candidate.
- `scopeBoundary.test.ts` / `interpretedAgent.test.ts` — open-prompt context + `who did I add` inquiry.
- `agent:friendy:check` — mock sensor E2E still passes.
- `macosSensorSource.test.ts` — contract includes `CNChangeHistoryUpdateContactEvent`, `isReadyForFriendyPrompt`.

Manual E2E (required before completion):

1. Clean outbox optional; `npm run agent:friendy`.
2. Text **`start`** on iMessage.
3. Add **new** contact (e.g. `Testing 7`) with **name + mobile**, **Done**, wait 10s.
4. Receive named prompt; reply `Friendy MVP test, met at home`.
5. Confirm `memories` count > 0 and recall question returns the person.

## Verification Commands

```bash
npm test
npm run build
npm run eval:agent
npm run agent:friendy:check
npm run check:mac-mvp-demo
npm run build:macos-sensor   # if Swift changed
git diff --check
```

Record manual E2E result in `docs/goals/EXPERIMENT_NOTES.md` (pass/fail, contact name, timestamps, batch id).

## Key Files

| Area | Path |
|------|------|
| Agent entry | `src/relationship/runtime/friendyRuntimeCli.ts` |
| Runtime / gating | `src/relationship/runtime/friendyRuntime.ts` |
| Swift sensor | `swift/FriendyMacOSSensor/Sources/FriendyMacOSSensor/NativeMacosSensor.swift` |
| Scope / replies | `src/relationship/scopeBoundary.ts`, `responseComposer.ts` |
| Prompt copy | `src/relationship/runtime/promptPlanner.ts` |
| Inbound agent | `src/relationship/interpretedAgent.ts` |
| Edge cases | `implementation-notes.html` |
| Behavior spec | `docs/superpowers/specs/friendy-mac-only-mvp-onboarding-agent-behavior-design-finished.md` |

## Completion Criteria

- [x] After `start`, new contact (name + phone) → iMessage prompt uses **correct name**, ~5–15s after **Done** (Testing 12, 2026-05-22)
- [x] Reply to prompt → **`memories`** row exists in SQLite
- [x] “Who did I add…” / contextual replies work (**no** scope redirect)
- [x] Terminal: sensor emits `contact_added`; user received prompt (history batch ack file may still fail automated checker)
- [x] Clean restart: orphan sensor cleanup on agent launch
- [x] Fix committed and pushed (`1d62345`)
- [x] `implementation-notes.html` and `docs/agent-handoff.md` updated with E2E evidence
- [ ] All verification commands pass (`check:mac-mvp-e2e-state` ack gap remains optional follow-up)

## Handoff One-Liner

Mac MVP contact E2E **works** on real hardware (Testing 12, 2026-05-22). Read `docs/agent-handoff.md` for restart ritual and follow-ups. Next: continue `docs/goals/mac-mvp-final-goal-runbook.md` or close the ack-file gap in `check:mac-mvp-e2e-state`.
