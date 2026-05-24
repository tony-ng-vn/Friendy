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

### Local Onboarding API Backend Slice

- Added a local-first onboarding backend for the deployed Friendy UI at `https://friedy-ui.vercel.app`.
- New command: `npm run agent:friendy:local-api`, defaulting to `http://127.0.0.1:8788`.
- The server exposes `POST /api/onboarding/connect` and `GET /api/onboarding/status?phoneNumber=...` without starting the Mac sensor runtime.
- Phone input is normalized for `+1` and digit-only US input. Invalid phone input returns `invalid_phone`.
- Allowed phones are read from `FRIENDY_BETA_ALLOWED_PHONES` plus `FRIENDY_OWNER_PHONE` by default.
- Non-allowed phones are upserted into a local SQLite waitlist table and return the private-beta 202 response without creating a Friendy user or Photon user.
- Allowed phones create/reuse a local Friendy UUID user, create/reuse a Photon shared user mapping, and return the Spectrum redirect URL. Repeated Connect reuses the stored Photon mapping and does not call Photon again.
- The production Photon client uses `POST https://spectrum.photon.codes/projects/{SPECTRUM_PROJECT_ID}/users` with `{ type: "shared", phoneNumber }`, HTTP Basic auth from `SPECTRUM_PROJECT_ID:SPECTRUM_PROJECT_SECRET`, and nested `data` response parsing; tests inject a fake client.
- CORS preflight is allowed for `https://friedy-ui.vercel.app`, exact origins listed in `FRIENDY_LOCAL_API_ALLOWED_ORIGINS`, and localhost development origins.
- SQLite onboarding tables are colocated in the existing `FRIENDY_SQLITE_PATH` database. The SQLite setup now preserves higher `PRAGMA user_version` values so later repository opens do not downgrade the onboarding migration marker.
- Verification on 2026-05-24: RED test run failed for missing `./onboardingLocalApi`; Photon auth RED test failed against the old Bearer/top-level-response client; focused onboarding/SQLite tests passed 2 files/41 tests after review fixes; focused onboarding API tests passed 11/11 after the Photon Basic-auth fix; `npm run build` passed; full `npm test` passed 75 files/599 tests before the final review fixes; `npm run eval:agent` passed 51/51 with 0 unsafe mutations and 0 hallucinations before the final review fixes; `git diff --check` passed.

### Live Sarah Fan Memory Append Follow-up

- Fixed a live iMessage regression from 2026-05-24 where `For Sarah Fan beside I met her during photon residency ii, she is also a community lead there` could produce an OpenAI invalid-output diagnostic for `search.filters: null`, then fall through to an unhelpful `I don't have enough...` reply instead of editing the existing Sarah Fan memory.
- The interpretation schema now accepts `search.filters: null` from strict structured model output and normalizes it to no filters, matching the JSON schema that already allowed nullable filters.
- Added bounded append semantics to `update_memory`: `mode: "append"` preserves the existing note and adds the new fact with a revision reason of `user_note_added`. This is a relationship-memory edit only; it does not mutate Apple Contacts.
- Added a narrow deterministic update detector for `for <person> beside/besides/also ...` relationship-memory notes. It resolves the person through existing target lookup, asks confirmation before writing, and then appends the new fact after `yes`.
- Added `sarah-fan-beside-role-update-regression`; `npm run eval:agent` now passes 49/49 with 0 unsafe mutations and 0 hallucinations.
- Verification on 2026-05-24: focused tests passed 4 files/136 tests; `npm run eval:agent` passed 49/49; `npm run build` passed; full `npm test` passed 74 files/581 tests; `git diff --check` passed.
- Follow-up live log on 2026-05-24 showed two more issues:
  - `List me everyone` / `List everyone` went through OpenAI, which returned `search.topK: 1`; `list_people` honored that model limit and hid saved people such as `Testing` even though `search_memories` could still find them.
  - `Sarah Fan is also a community leader too` was classified as `capture_memory` and called `create_manual_memory`, creating a duplicate Sarah Fan memory instead of editing the existing one.
- `List me everyone` and `List everyone` now route through the deterministic broad-inventory path with the normal list limit and no model call.
- Named append phrasing like `<person> is also ... too` now routes through the same confirmed append-memory path and does not create a duplicate manual memory.
- Added `sarah-fan-named-role-update-regression`; `npm run eval:agent` now passes 50/50 with 0 unsafe mutations and 0 hallucinations.
- Verification on 2026-05-24: focused router/interpreted/eval tests passed 3 files/106 tests; `npm run eval:agent` passed 50/50; `npm run build` passed; full `npm test` passed 74 files/588 tests; `git diff --check` passed.

### Relationship-Memory Routing/Delete Cleanup

- Follow-up work on top of the merged PR 1-10 stack is in progress on branch `codex/relationship-routing-delete-cleanup`.
- Added a small `deterministicRouter.ts` route boundary for broad people inventory and bulk delete/clear confirmation detection. It replaces the local interpreted-agent list bypass without turning deterministic routing into a broad regex router.
- Added `targetQueryCleanup.ts` and conservative short-name matching so polite wrappers like `Z2 please`, `Sarah thank you`, `delete Z2 please`, and `forget AJ from memory` are cleaned before lookup while short names like `Z` and `Z2` do not cross-match.
- Memory delete/update lookup now groups duplicate display names before fuzzy matching and deduplicates ambiguity options by normalized display name. Matched person deletes store all associated memory ids and only delete after an explicit `yes`.
- Single-person delete confirmation copy is now `Do you want me to forget <name>? Reply yes to confirm or no to cancel.`
- `list_people` turns now retain a short-lived recent people list for exact-name follow-up deletes. Trace metadata now includes model-call, raw/cleaned target query, lookup projection, match reason, confirmation requirement, and safe invalid-schema recovery markers where available.
- OpenAI invalid structured-output recovery is intentionally narrow: strict-mode invalid schema output can recover only to safe deterministic `list_people`; destructive routes still do not recover from invalid model output.
- Verification on 2026-05-24: focused relationship tests passed 3 files/102 tests; focused router/cleanup/OpenAI/composer tests passed 4 files/46 tests; full `npm test` passed 74 files/577 tests; `npm run eval:agent` passed 48/48 with 0 unsafe mutations and 0 hallucinations; `npm run build` passed; `git diff --check` passed.
- Follow-up duplicate-name delete bug fixed: exact duplicate display names no longer collapse into one person-level delete target. `Delete Sarah Fan` with two Sarah Fan memories now asks a numbered disambiguation question with context snippets and stores the candidate memory IDs in the pending delete workflow.
- A numbered reply such as `1` deletes only that stored memory ID. A reply of `both`/`all` deletes all IDs from the disambiguation payload. The bounded `delete_memory` tool still rejects raw display names and only mutates by stored memory ID.
- Added `duplicate-exact-name-delete-disambiguation-regression`; verification on 2026-05-24 passed focused relationship tests 3 files/108 tests and focused composer/tools/session/eval tests 4 files/67 tests. Final full gate in this worktree passed: `npm test` 74 files/591 tests, `npm run eval:agent` 51/51 with 0 unsafe mutations and 0 hallucinations, `npm run build`, and `git diff --check`.

### Live List Formatting and Bulk Delete Follow-up

- Fixed live iMessage follow-up issues from 2026-05-24:
  - `list_people` replies now always use `<name> - <context>` bullets for saved people, including broad inventory and filtered list requests.
  - Multi-person event recall replies such as `Who did I meet during the photon residency?` now use the same bullet list format, for example `- Sarah Fan - Photon Residency`, instead of `I found 2 people: Sarah Fan, Cecelia.`
  - Broad inventory wording such as `What are all the people I know?`, `Who are all the people I know?`, `Show everyone I know`, `What do you remember?`, and `What people do you know yet in my contact?` now bypasses OpenAI and routes deterministically to `list_people` instead of risking a structured-output schema fallback.
  - Filtered list wording such as `List me in bullet of all people I met testing friendy` remains list-like for pending-contact safety, but still goes through model interpretation so filters are preserved.
  - `Can you delete everyone for me?` now opens a confirmation gate instead of falling into single-target lookup. Friendy deletes all saved memories through the bounded `clear_memories` tool only after the user replies `yes`.
  - If the user asks to clear/delete everyone when no Friendy memories are saved, Friendy replies `You haven't saved anyone in Friendy memory yet.`
- OpenAI invalid structured-output failures now print a local diagnostic log before the strict error is thrown:
  - log tag: `[friendy:openai_interpreter:invalid_output]`;
  - fields: `model`, raw model `rawOutput`, and `validationError`.
  - This keeps the same strict-mode behavior while preserving exactly what OpenAI returned for the next fix pass.
- Added `delete-everyone-confirmation-regression`; the `list-all-contact-recall` eval now freezes the live inventory variants and asserts deterministic routing without unsafe pending-candidate mutation.
- Verification on 2026-05-24: focused RED/GREEN cases passed, `npm run eval:agent` passed 48/48, full `npm test` passed 72 files/549 tests, `npm run build` passed, and `git diff --check` passed.

### OpenAI Model Provider Switch

- Follow-up cleanup on 2026-05-24 removed the remaining legacy provider naming from source, tests, env examples, docs, specs, plans, and stack-status checks. The interpreter module is now `src/relationship/openAIInterpreter.ts`, with `createOpenAIInterpreter` and `readOpenAIConfig`.
- `.env.example` and README now document `OPENAI_API_KEY` and `OPENAI_MODEL=gpt-4o-mini`.
- The cleanup also fixed an existing event-wide search regression: `at` is now treated as generic recall grammar, so `Who did I meet at Photon Residency II?` no longer returns unrelated memories that only match the word `at`.
- Verification on 2026-05-24: legacy-provider grep returned no source/doc hits, focused OpenAI/provider tests passed 8 files/124 tests, `npm test` passed 72 files/539 tests, `npm run eval:agent` passed 47/47 with 0 unsafe mutations and 0 hallucinations, `npm run build` passed, and `git diff --check` passed.
- Friendy now uses `OPENAI_API_KEY` and `OPENAI_MODEL` for the structured message interpreter. Legacy provider env vars are no longer used.
- The optional expression-polish layer uses OpenAI when `FRIENDY_EXPRESSION_LLM` is enabled, with `FRIENDY_EXPRESSION_MODEL` still allowed as a model override.
- `npm run doctor:friendy` now reports `Model provider: openai` and the effective OpenAI model when strict mode is enabled with `OPENAI_API_KEY`.
- Live strict-mode failure on `Who did I meet at AI dinner?` was model/routing, not sensor infra. Root causes fixed:
  - stale shell `OPENAI_API_KEY` could override the updated `.env.local` key; `.env.local` now wins for `OPENAI_API_KEY` and `OPENAI_MODEL`;
  - OpenAI strict structured outputs require every object property in `required`; the request schema is now normalized for OpenAI without changing Friendy's runtime Zod contract;
  - OpenAI can return `search.semanticQuery` while top-level `query` is empty, so validation now normalizes search queries before enforcing `search_memory` invariants.
- Follow-up live route issue fixed: OpenAI could classify `Who did I meet at AI dinner?` as `answer_pending_contact_prompt` even with no active pending frame. The interpreted agent now repairs no-active-pending, event-recall-shaped pending-prompt routes into `search_memory` before policy/tools run.
- Verification on 2026-05-24: focused OpenAI provider tests passed for the interpreter, doctor, expression config/composer, and model-backed eval gate.

### List Reply and Context Targeting Fix

- Fixed live MVP reply issues reported on 2026-05-24:
  - multi-person recall now returns names only instead of repeating the shared event/context for every person;
  - `list_people` replies now format saved people as bullet names and no longer dump every saved note summary inline;
  - memory update/delete lookup can exact-match old context text such as `Hi`, so `Can you change Hi context into ...` targets the memory containing that old note instead of guessing a person name;
  - `delete Hi` now resolves by exact context text when possible instead of fuzzy-matching an unrelated display name.
- Follow-up strict-mode crash fix from live log: ambiguous delete/update target lookup now returns the existing user-facing disambiguation prompt in strict mode instead of throwing `FriendyStrictModeError: Executable delete-memory route has an ambiguous target.`
- Added `strict-ambiguous-delete-clarifies-regression`; `npm run eval:agent` now passes 47/47 with 0 unsafe mutations and 0 hallucinations.
- Verification on 2026-05-24: focused RED/GREEN regression tests passed 6 targeted cases, focused shared suite passed 6 files/137 tests, `npm run eval:agent` passed 46/46 with 0 unsafe mutations and 0 hallucinations, `npm run build` passed, `npm test` passed 72 files/522 tests, and `git diff --check` passed.
- Follow-up verification on 2026-05-24: `npm test -- src/relationship/interpretedAgent.test.ts src/relationship/evals/agentEvalRunner.test.ts` passed 76/76, `npm run eval:agent` passed 47/47, `npm run build` passed, full `npm test` passed 72 files/529 tests, and `git diff --check` passed.

### Live Pending-Contact Safety Fix

- Fixed the live transcript regression where a stale prompted candidate could be confirmed by a low-signal reply such as `Hi` before the user had texted `start`.
- While onboarding is still `ready_pending_user_start`, non-control inbound messages now return `If you want to start please send me 'start'` without calling the interpreter, pending-candidate tools, or memory writes.
- While an active pending-contact prompt is open, low-signal replies such as `Hi`, `ok`, or `thanks` now ask which pending contact/context is needed instead of treating the reply as saveable relationship context.
- Verification on 2026-05-24: `npm test -- src/relationship/interpretedAgent.test.ts -t "before start|greeting replies"` passed, `npm test -- src/relationship/interpretedAgent.test.ts` passed 67/67, full `npm test` passed 72 files/517 tests, `npm run eval:agent` passed 46/46, and `npm run build` passed.

### Pre-Start Contact Notice Fix

- Fixed the live UX gap where a contact added before `start` was only logged and permanently ignored. The runtime now queues the pre-start contact as a pending candidate, records the sensor event as `candidate_created` so native history batches can ack, and sends one owner-facing notice explaining that the user should text `start`.
- When the user texts `start`, the deterministic start reply includes the queued contact prompt instead of requiring the contact to be added again.
- `agent:friendy` startup now clears stale reviewable candidates from previous foreground runs so old prompted contacts such as prior `Testing` runs cannot hijack a new context reply after restart.
- If the pre-start notice send fails, the runtime logs `Failed to send pre-start contact notice` while keeping the queued candidate and ackable processed-event record.
- Verification on 2026-05-24: red tests failed for missing pre-start queueing and missing start prompt, then `npm test -- src/relationship/runtime/friendyRuntime.test.ts src/relationship/runtime/friendyRuntimeCli.test.ts src/relationship/interpretedAgent.test.ts` passed 104/104 and `npm run build` passed.

### Live Schema Error Recovery and List Shortcut Fix

- Fixed the live failure where `List all people I met` could hit OpenAI, receive invalid structured output, log `[friendy:inbound_agent:error]`, and then stop processing later texts because the Spectrum message loop had no per-message error boundary.
- Broad unfiltered inventory requests such as `List all people I met` now route deterministically to `list_people` without calling the model. Filtered list requests such as `List me in bullet of all people I met testing friendy` still go through the model route so extracted filters are preserved.
- Spectrum/iMessage inbound handling now catches one failed turn, logs `[friendy:inbound_agent:error] ...`, sends `I had trouble understanding that. Try saying it another way.`, and keeps the live loop running for the next text.
- Save-confirmation copy now rewrites first-person meeting notes such as `I met them at AI dinner` into `I'll remember you met Z2 at AI dinner` instead of echoing the user's raw sentence back.
- Follow-up live root cause: `Z3` saved correctly but disappeared from `AI dinner` recall because Contacts events without visible phone/email methods all shared the empty method fingerprint and were merged into the same `personId`. Candidate identity now falls back to the Apple contact identifier when raw methods are unavailable, and SQLite startup repairs legacy empty-method collisions.
- If OpenAI misroutes `Who did I met at AI dinner?` as `list_people`, the interpreted agent now repairs that event-recall-shaped route to `search_memory`. Event-recall search uses the raw user question so event terms are preserved, while generic grammar such as `at` no longer matches unrelated memories.
- Short event-only context replies such as `At AI dinner`, `AI dinner`, or `AI dinner in SF` now save with meeting-fact wording, for example `I'll remember you met Z4 at AI dinner`.
- Verification on 2026-05-24: RED tests failed for first-person save copy, obvious list-all model bypass, per-message Spectrum recovery, empty-method contact identity merging, event-recall misrouting, and event-only save copy. After implementation, focused tests passed 175/175, full `npm test` passed 72 files/539 tests, `npm run build` passed, `npm run eval:agent` passed 47/47, `npm run agent:friendy:check` passed, and `git diff --check` passed.

### Core Relationship Agent Verification

- Active goal changed by user on 2026-05-24: stop feature expansion and verify the existing core relationship-agent behavior for chat, new-contact detection, contact-memory add, contact-memory recall/listing, memory update, and memory delete.
- No new feature work should be started for this goal unless a verified core behavior gap appears.
- A small `draft_message` WIP from the previous objective was backed out before final verification so the evidence reflects the existing core behavior surface.
- Verification on 2026-05-24:
  - Focused core suite passed 11 files/190 tests covering `agentCore`, `interpretedAgent`, tools/repository/SQLite, local contact check, iMessage/Spectrum/terminal transports, Mac MVP demo test, and agent eval runner test.
  - `npm run eval:agent` passed 46/46 required cases with 0 unsafe mutations and 0 hallucinations.
  - `npm run build` passed.
  - `npm run doctor:friendy` passed after rerunning outside the sandbox for the `tsx` temp-pipe permission issue; it reported env, SQLite, sensor state, model provider readiness, Spectrum prompt transport, recipient, sensor binary, and native permissions ready.
  - `npm test` passed 72 files/515 tests.
  - `npm run agent:friendy:check` passed after rerunning outside the sandbox for the same `tsx` temp-pipe issue; it verified start-gate behavior, normalized mock contact events, duplicate sensor-event suppression, and history ack.
  - `npm run check:mac-mvp-demo` passed after rerunning outside the sandbox; transcript covered `start`, pending contact prompt, save memory, recall, update confirmation, and confirmed update.
  - `git diff --check` passed.
- Spectrum endpoint check on 2026-05-24: `curl -I https://spectrum.photon.codes` returned HTTP/2 200. The earlier live runtime error was a transient connect timeout to Spectrum, not a deterministic Friendy-agent failure.

### PR 11 Expression Live Wiring

- Branch: `pr11-expression-llm-layer`, fast-forwarded to `origin/main` at `b97a921` after PR 9/10 landed.
- PR 1-10 stack is complete per `npm run friendy:stack-status` on 2026-05-24.
- The expression layer is now wired into interpreted-agent and Spectrum runtime flows as an optional post-composer polish step. Deterministic tools still select/write/search facts first; expression receives only a grounded fact bundle and returns either polished text or the original draft fallback.
- Direct pending-contact iMessage replies now use the same expression path: "who are you asking about?" builds a `pending_contact_explanation` bundle, and active pending-contact context confirmations build a `save_confirmation` bundle after deterministic candidate confirmation.
- Runtime expression remains env-controlled through `FRIENDY_EXPRESSION_LLM`; tests inject fake expression composers so no network/model call is required.
- Expression metadata is persisted on interaction JSON as `expressionUsed`, `expressionValidationPassed`, `expressionFallbackReason`, and `expressionModel`.
- Verification on 2026-05-24: focused expression verification passed 5 files/96 tests, `npm test` passed 72 files/515 tests, `npm run eval:agent` passed 46/46, `npm run build` passed, and `git diff --check` passed. A previous full `npm test` run before the pending-contact expression slice had one local-check SQLite timeout, but the isolated file passed and full reruns passed.

### Fix Stack Integration Status

- Branch: `main` / `origin/main` includes PR 1-10.
- PR 4 pass-state-into-LLM-router is implemented on `main`. `routerInputEnvelope.ts` owns the compact router envelope and `interpretedAgent.ts` builds it before `interpreter.interpret({ message, routerContext })`.
- PR 5 pending reminder policy is now wired into `interpretedAgent.ts`. The old search happy-path inline `composePendingContactReminder` append has been replaced with deterministic `decidePendingReminder(...)` plus `composePendingContactsFooter(...)`.
- Reminder decisions are traced as `pendingReminderDecision` / `pendingReminderReason`, while `suppressedPendingReminder` remains as a compatibility projection for current traces.
- `routePolicyValidator.ts` still exposes `suppressPendingReminder`, but only as compatibility metadata. Append/defer decisions live in `pendingReminderPolicy.ts`.
- Same-name pending candidates are suppressed until the same/different flow is resolved; repeated search reminders for the same candidate are deferred by TTL; `list_people` does not append pending reminder footers.
- PR 6 duplicate identity resolution is wired. Same-name pending contacts now open a deterministic duplicate-resolution workflow with `same`, `different`, `ignore`, and `not sure` replies before context capture; proactive runtime prompts also ask same/different when a new contact shares a saved person's name.
- PR 7 robust delete/update, PR 9 strict dogfooding trace, and PR 10 durable conversation session have landed on `origin/main`.
- The requested `.agents/skills/friendy-fix-stack/references/parallel-tracks.md` file was not present in this checkout; repo search found no `parallel-tracks.md`.

| Item | State |
|------|--------|
| **Mac MVP contact E2E** | **Working** — verified live with contact “Testing 12” |
| **Latest fix** | Local onboarding API backend slice for deployed UI connect/status beta gate |
| **Latest navigation update** | Understand Anything graph generated and linked from `AGENTS.md` / `REFERENCE.md` as a searchable repo index |
| **Active goal** | Core relationship-agent behavior verification |
| **Branch** | `pr11-expression-llm-layer` |

### Fix stack status (2026-05-23, parallel prep batch)

Run `npm run friendy:stack-status` for live PR 1–10 state.

| PR | Topic | Status on `main` |
|----|--------|------------------|
| 1–3 | Regression freeze, `list_people`, structured router | **Done** |
| 4 | Pass state into LLM router (envelope) | **Done** |
| 5 | Pending reminder policy | **Done** — deterministic footer policy wired into interpreted agent |
| 6 | Identity resolution | **Done** — same-name duplicate resolution tool, trace, agent workflow, and proactive runtime prompt wired |
| 7 | Robust delete/update | **Prep** modules on main (full PR not merged as stack unit) |
| 8 | Sensor normalization ack | **Done** on `main` |
| 9 | Strict-mode dogfooding trace | **Done** |
| 10 | Durable conversation session | **Done** |

### Active implementation status (2026-05-23, strict mode baseline)

- Added `FRIENDY_STRICT_MODE` parsing and typed `FriendyStrictModeError`.
- Added `FriendyTrace` to interpreted-agent results and persisted interaction JSON.
- Redacted runtime traces now include strict mode, route source, fallback usage, fallback reason, policy decision, active ids, and tool calls without raw private text.
- The model interpreter now reports `routeSource`, `fallbackUsed`, and `fallbackReason`.
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
- Pre-`start` contact adds are queued as pending candidates and prompted immediately after the user texts `start`; stale pending candidates from previous foreground runs are cleared on `agent:friendy` startup.
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
