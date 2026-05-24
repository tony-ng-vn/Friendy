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

2026-05-24 live list formatting and bulk delete follow-up:

- `list_people` replies now use `<name> - <context>` bullets for saved people, matching the requested iMessage list format.
- Multi-person event recall replies such as `Who did I meet during the photon residency?` now use the same `<name> - <context>` bullet format instead of compact comma-separated prose.
- Second-person contact inventory wording such as `What people do you know yet in my contact?` now routes deterministically to `list_people`, so it no longer depends on OpenAI producing a valid structured route for broad list requests.
- `Can you delete everyone for me?` now opens a confirmation flow and only deletes all saved Friendy memories through the bounded `clear_memories` tool after `yes`.
- Empty clear/delete-all requests now say `You haven't saved anyone in Friendy memory yet.`
- Added `delete-everyone-confirmation-regression`; the `list-all-contact-recall` eval now freezes the live second-person inventory wording and asserts deterministic routing. `npm run eval:agent` passed 48/48 required cases with 0 unsafe mutations and 0 hallucinations.
- Verification passed: focused RED/GREEN cases, focused routing/eval suite 5 files/101 tests, `npm run eval:agent`, full `npm test` 72 files/544 tests, and `npm run build`.

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
