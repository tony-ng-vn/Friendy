# Goal: Core Relationship Agent Verification

Verify that Friendy's existing core relationship-agent behaviors work correctly before adding more features.

## Objective

Confirm the current agent can:

- chat through the relationship-memory scope,
- detect new contacts and create pending confirmation prompts,
- add contacts to Friendy memory after user confirmation,
- retrieve and list saved contacts from memory,
- edit saved memory after confirmation,
- delete saved memory after confirmation.

## Current Result

2026-05-25 live Photon Residency context retrieval follow-up:

- Fixed the live case `What are the people I met during Photon Residency?`, which routed through the LLM as generic semantic `search_memory` and returned generic Photon-only matches.
- `isEventRecallQuestion` now recognizes `what/which people|contacts did I meet at/during/from/while...` event-scoped wording.
- LLM `search_memory` routes are repaired to `event_recall` when the raw user message is clearly event-scoped, even if the model returns `semantic_recall`.
- Event-wide multi-word retrieval now requires all normalized context terms, so `Photon Residency` can match residency memories while excluding `Photon`-only company/school notes.
- Added unit coverage, interpreted-agent coverage for the live wording, and the required eval `photon-residency-what-people-event-recall-regression`.
- Verification passed with focused tests 5 files/184 tests, `npm run eval:agent` 53/53 with 0 unsafe mutations and 0 hallucinations, `npm run build`, and `git diff --check`.
- Build blocker cleanup: added the missing `appleContactSnapshot.ts` helper and updated stale interpreted-agent test helper types for pending-workflow/list-detail routes.

2026-05-24 live Daniel list-all-memory follow-up:

- Fixed the live case `List me all memory you have for Daniel`, which was incorrectly normalized to the filter target `memory you have for Daniel` and returned `I don't have any matching people...`.
- `extractFilteredPersonListCommand` now recognizes `all memory/memories ... for <person>` phrasing and extracts the person name for deterministic `list_people` filtering.
- Saved people lists now use numbered rows instead of dash bullets, and a follow-up delete target such as `delete 2` resolves against the most recent numbered list before asking for confirmation.
- Added unit coverage for the extractor, interpreted-agent coverage for the live Daniel wording, and the required eval `daniel-list-all-memory-regression`.
- Verification passed with focused tests 3 files/143 tests, `npm run eval:agent` 52/52 with 0 unsafe mutations and 0 hallucinations, temp-copy SQLite smoke for Daniel list plus `delete 2`, and `git diff --check`.
- The earlier `npm run build` blocker from missing `appleContactSnapshot.ts` and stale interpreted-agent test helper types was fixed on 2026-05-25; `npm run build` now passes.

2026-05-24 live Sarah Fan append-memory follow-up:

- Fixed the live case `For Sarah Fan beside I met her during photon residency ii, she is also a community lead there`.
- `search.filters: null` from OpenAI strict structured output now validates and normalizes to no filters instead of throwing.
- Relationship-memory edits now support bounded append semantics through `update_memory` with `mode: "append"`, preserving existing notes and appending the new fact after explicit confirmation.
- The Sarah Fan wording routes through existing target lookup, asks to add the new fact, and updates only after `yes`.
- Added `sarah-fan-beside-role-update-regression`; verification passed with focused tests 4 files/136 tests, `npm run eval:agent` 49/49, `npm run build`, full `npm test` 74 files/581 tests, and `git diff --check`.
- Follow-up live log showed `List me everyone` / `List everyone` could be model-routed with `search.topK: 1`, causing broad inventory to show only Sarah even while `Do I know anyone from testing friendy?` could find Testing. Those everyone-list requests now bypass the model deterministically.
- Follow-up live log also showed `Sarah Fan is also a community leader too` created a duplicate manual memory instead of editing. Named `is also` person facts now ask for append confirmation and do not create duplicate memory.
- Added `sarah-fan-named-role-update-regression`; verification passed with focused router/interpreted/eval tests 3 files/106 tests, `npm run eval:agent` 50/50, `npm run build`, full `npm test` 74 files/588 tests, and `git diff --check`.

2026-05-24 relationship-memory routing/delete cleanup:

- Added a central deterministic route boundary for broad people inventory and bulk delete/clear confirmation detection.
- Added target-query cleanup and conservative short-name matching so natural delete targets like `Z2 please` resolve to `Z2` without matching `Z`.
- Delete/update target lookup now groups duplicate display names before fuzzy matching and deduplicates ambiguity options. A matched person delete stores all associated memory ids and deletes only after explicit confirmation.
- Single-person delete confirmation now asks `Do you want me to forget <name>?` and still accepts `no`/`cancel` to clear the pending action.
- `list_people` stores a short-lived recent people list for exact-name follow-up deletes.
- Invalid OpenAI schema recovery is limited to safe deterministic `list_people` routes; invalid model output never recovers into destructive actions.
- Trace metadata now records model-call state, raw/cleaned target query, lookup projection, match reason, confirmation requirement, and invalid-schema recovery when available.
- Verification passed: focused relationship tests passed 3 files/102 tests; focused router/cleanup/OpenAI/composer tests passed 4 files/46 tests; full `npm test` passed 74 files/577 tests; `npm run eval:agent` passed 48/48 with 0 unsafe mutations and 0 hallucinations; `npm run build` passed; `git diff --check` passed.

2026-05-24 duplicate exact-name delete follow-up:

- Fixed the live-critical delete case where duplicate exact display names could be collapsed into one person-level delete target.
- Exact duplicate-name deletes now ask a numbered disambiguation question with context snippets instead of asking to forget the name as a whole.
- The pending delete workflow stores concrete memory IDs. Replying `1` deletes only the first candidate ID; replying `both`/`all` deletes all candidate IDs from the disambiguation payload.
- The bounded delete tool still rejects raw display names at the tool boundary; deletion remains by stored memory ID only.
- Added `duplicate-exact-name-delete-disambiguation-regression`; verification passed with focused relationship tests 3 files/108 tests, focused composer/tools/session/eval tests 4 files/67 tests, full `npm test` 74 files/591 tests, `npm run eval:agent` 51/51 with 0 unsafe mutations and 0 hallucinations, `npm run build`, and `git diff --check`.

2026-05-24 live list formatting and bulk delete follow-up:

- `list_people` replies now use `<name> - <context>` bullets for saved people, matching the requested iMessage list format.
- Multi-person event recall replies such as `Who did I meet during the photon residency?` now use the same `<name> - <context>` bullet format instead of compact comma-separated prose.
- Broad contact inventory wording such as `What are all the people I know?`, `Who are all the people I know?`, `Show everyone I know`, `What do you remember?`, and `What people do you know yet in my contact?` now routes deterministically to `list_people`, so it no longer depends on OpenAI producing a valid structured route for broad list requests.
- Filtered list wording such as `List me in bullet of all people I met testing friendy` remains list-like for pending-contact safety, but still goes through model interpretation so filters are preserved.
- `Can you delete everyone for me?` now opens a confirmation flow and only deletes all saved Friendy memories through the bounded `clear_memories` tool after `yes`.
- Empty clear/delete-all requests now say `You haven't saved anyone in Friendy memory yet.`
- OpenAI invalid structured-output failures now log `[friendy:openai_interpreter:invalid_output]` with the requested model, raw model output, and validation error before Friendy throws the same strict schema error. This is a diagnostic-only change so the next live schema failure includes the evidence needed to fix the route/schema mismatch.
- Added `delete-everyone-confirmation-regression`; the `list-all-contact-recall` eval now freezes live inventory variants and asserts deterministic routing. `npm run eval:agent` passed 48/48 required cases with 0 unsafe mutations and 0 hallucinations.
- Verification passed: focused RED/GREEN cases, `npm run eval:agent`, full `npm test` 72 files/549 tests, `npm run build`, and `git diff --check`.

2026-05-24 OpenAI provider naming cleanup:

- Removed the remaining legacy provider naming from source imports, test filenames, env examples, README/REFERENCE docs, handoff docs, goal/spec/plan references, and stack-status checks.
- The structured model interpreter now lives at `src/relationship/openAIInterpreter.ts` and exposes `createOpenAIInterpreter` / `readOpenAIConfig`; live config is `OPENAI_API_KEY` and `OPENAI_MODEL`.
- `.env.example` and README now use `OPENAI_MODEL=gpt-4o-mini`.
- While running the full gate, an existing event-wide search regression surfaced from the current worktree: `Who did I meet at Photon Residency II?` returned an unrelated `Demo Night` memory because the query token `at` was not treated as generic grammar. Added `at` to generic memory-query terms so event recall does not match unrelated memories through preposition overlap.
- Verification passed: legacy-provider grep returned no source/doc hits, focused OpenAI/provider tests passed 8 files/124 tests, `npm test -- src/relationship/tools.test.ts` passed 31/31, full `npm test` passed 72 files/539 tests, `npm run eval:agent` passed 47/47 with 0 unsafe mutations and 0 hallucinations, `npm run build` passed, and `git diff --check` passed.

2026-05-24 OpenAI strict-mode live recall fix:

- `Who did I meet at AI dinner?` failed in strict mode because the runtime used a stale shell `OPENAI_API_KEY`, then OpenAI rejected the schema shape, then model output placed the search text in `search.semanticQuery` while leaving top-level `query` empty.
- `.env.local` now overrides shell env for `OPENAI_API_KEY` and `OPENAI_MODEL` only; Spectrum credentials still preserve shell override behavior.
- The OpenAI request schema is normalized to satisfy strict structured-output `required` rules without changing Friendy's runtime Zod contract.
- Search interpretation validation now accepts `search.semanticQuery` as the executable query when top-level `query` is empty.
- Follow-up route repair: if OpenAI misclassifies an event-recall question such as `Who did I meet at AI dinner?` as `answer_pending_contact_prompt` while no pending contact is active, the interpreted agent now repairs it to `search_memory` before policy/tools run.
- Live-shaped repro for `Who did I meet at AI dinner?` now returns `routeSource: "llm"`, `fallbackUsed: false`, and `query: "AI dinner"` with `gpt-4o-mini`.
- Focused verification passed: `npm test -- src/relationship/env.test.ts src/relationship/interpretation.test.ts src/relationship/openAIInterpreter.test.ts src/relationship/interpretedAgent.test.ts src/relationship/runtime/friendyDoctor.test.ts src/relationship/expressionComposer.test.ts src/relationship/expressionConfig.test.ts`, `npm run build`, and `git diff --check`.

2026-05-24 pre-start contact notice fix:

- Live log showed `Contact automation paused (ready_pending_user_start); ignoring pre-start contact event...` only in the terminal, which made the user-facing iMessage state unclear.
- Follow-up live testing showed the first fix was still wrong for product behavior: the contact should not be permanently skipped after the user starts Friendy.
- Pre-start contact events now create pending candidates and are recorded as `candidate_created`, so native history can ack without losing the contact.
- The one-time owner notice now says the contact was queued and asks the user to text `start`.
- The deterministic `start` reply now asks about a queued pending contact immediately.
- `agent:friendy` startup clears stale pending candidates from previous foreground runs so old prompts do not confuse new test turns.
- If the pre-start notice cannot be delivered, the queued candidate and processed-event record still persist.
- Verification passed: red-first tests failed for missing pre-start queueing and missing start prompt; then `npm test -- src/relationship/runtime/friendyRuntime.test.ts src/relationship/runtime/friendyRuntimeCli.test.ts src/relationship/interpretedAgent.test.ts` passed 104/104 and `npm run build` passed.

2026-05-24 live schema-error recovery and list shortcut fix:

- Live testing showed `List all people I met` could still call OpenAI, fail schema validation, log `[friendy:inbound_agent:error]`, and stop handling later texts because the live Spectrum loop let the thrown turn escape.
- Broad unfiltered inventory requests such as `List all people I met` now use a deterministic `list_people` shortcut. Filtered list requests still use the model route so terms such as `testing friendy` are not lost.
- The live Spectrum/iMessage loop now catches one failed turn, sends `I had trouble understanding that. Try saying it another way.`, and keeps listening for the next inbound text.
- Save confirmation wording now turns `I met them at AI dinner` into `I'll remember you met Z2 at AI dinner` instead of echoing `I'll remember I met them at AI dinner`.
- Follow-up live testing showed `Z3` was saved correctly but hidden from `AI dinner` recall because redacted Contacts events without raw phone/email methods all shared the empty method fingerprint and collapsed into the same `personId`. Candidate identity now falls back to contact identifiers when raw methods are unavailable, and SQLite startup repairs legacy empty-method collisions.
- OpenAI `list_people` misroutes for event-recall questions such as `Who did I met at AI dinner?` are repaired to `search_memory` before tool execution.
- Short event-only context replies such as `At AI dinner`, `AI dinner`, or `AI dinner in SF` are treated as meeting facts in save confirmation copy.
- Verification passed: RED tests failed for first-person save copy, obvious list-all model bypass, per-message Spectrum recovery, empty-method contact identity merging, event-recall misrouting, and event-only save copy; then focused tests passed 175/175, full `npm test` passed 72 files/539 tests, `npm run build` passed, `npm run eval:agent` passed 47/47, `npm run agent:friendy:check` passed, and `git diff --check` passed.

2026-05-24 live transcript follow-up: Fixed the list/edit/delete rough edges found during manual iMessage testing.

- Multi-person recall returns names only instead of repeating shared event/context details.
- `list_people` replies use bullet names and no longer dump every memory summary inline.
- Update/delete lookup can exact-match old context text such as `Hi`, so context edits target the saved memory containing that note.
- Ambiguous delete/update lookup in strict mode now asks the user to choose a target instead of crashing the runtime with `Executable delete-memory route has an ambiguous target.`
- Added `strict-ambiguous-delete-clarifies-regression`; `npm run eval:agent` now passes 47/47 required cases with 0 unsafe mutations and 0 hallucinations.
- Focused regression tests passed 6 targeted cases.
- Focused shared suite passed 6 files/137 tests.
- `npm run eval:agent` passed 46/46 required cases with 0 unsafe mutations and 0 hallucinations.
- `npm run build` passed.
- `npm test` passed 72 files/522 tests.
- `git diff --check` passed.
- Follow-up strict ambiguous-delete verification passed: `npm test -- src/relationship/interpretedAgent.test.ts src/relationship/evals/agentEvalRunner.test.ts`, `npm run eval:agent`, `npm run build`, full `npm test` 72 files/529 tests, and `git diff --check`.

2026-05-24: Core verification passed with no new feature expansion.

- Focused core tests passed 11 files/190 tests.
- `npm run eval:agent` passed 46/46 required cases with 0 unsafe mutations and 0 hallucinations.
- `npm test` passed 72 files/515 tests.
- `npm run build` passed.
- `npm run doctor:friendy` passed after sandbox escalation for the `tsx` temp-pipe permission issue.
- `npm run agent:friendy:check` passed after sandbox escalation for the same `tsx` temp-pipe issue.
- `npm run check:mac-mvp-demo` passed after sandbox escalation; the transcript covered start, contact prompt, memory save, recall, update confirmation, and confirmed update.
- `git diff --check` passed.
- `curl -I https://spectrum.photon.codes` returned HTTP/2 200.

## Notes

- The earlier live `agent:friendy` timeout was a Spectrum network connect timeout to `spectrum.photon.codes:443`, not a deterministic relationship-agent logic failure.
- Live iMessage/Spectrum delivery still depends on the external Spectrum endpoint being reachable.
- No commit has been made for this verification pass.
