# Friendy Current System Audit

Date: 2026-05-21

## 1. System Summary

Friendy is currently a local, iMessage-first relationship memory system: it can turn fixture or explicit local contact/calendar signals into pending people, ask for user confirmation, save structured relationship memories through deterministic tools, and later retrieve people from vague context queries.

The important caveat is that this is still mostly a local proof of the core loop, not a production system. The repository, Spectrum runtime, local checker, evals, and docs describe the intended product correctly at a high level, but the state story is not unified yet: contact detection, pending candidates, live iMessage conversation, and saved memories can still live in separate in-memory runs.

## 2. Architecture Map

### Transport

- `src/relationship/transports/spectrumTransport.ts` adapts Spectrum/iMessage messages into `InboundAgentMessage`, runs the interpreted agent, sends replies, and logs compact interaction data.
- `src/relationship/transports/imessageE2eFlow.ts` is a deterministic iMessage-style product check that starts from fixture contact/calendar ingestion and routes confirmation plus search through the Spectrum runtime boundary.
- `src/relationship/transports/terminalTransport.ts` is a no-credentials harness for the deterministic agent core.

Assessment: the transport seam is mostly healthy. Product decisions live above it. The main weakness is that live Spectrum runtime still creates its own in-memory repository unless one is injected.

### Ingestion

- `src/relationship/ingestion/contactSnapshot.ts` detects new normalized phone/email methods and ignores name-only edits.
- `src/relationship/ingestion/ingestionPipeline.ts` syncs events, creates candidates, stores event matches, and prints deterministic summaries.
- `src/relationship/ingestion/localMacAdapters.ts` contains explicit macOS Contacts/Calendar AppleScript adapters plus parsers and non-macOS guards.
- `src/relationship/ingestion/localCheck.ts` runs the provider-neutral local checker and builds Friendy confirmation prompt output.
- `src/relationship/ingestion/localCheckCli.ts` owns the explicit `npm run ingest:local:check` command, snapshot file, dry-run default, and guarded live send.

Assessment: the ingestion seam has good testability because fixture and macOS adapters share the same snapshot/event interfaces. The risk is not the interface; it is that local checker state is not durable or connected to the live agent runtime yet.

### Interpretation

- `src/relationship/interpretation.ts` defines the strict structured intent schema.
- `src/relationship/openRouterInterpreter.ts` calls OpenRouter when configured and falls back to a deterministic rule-based interpreter.
- `src/relationship/interpretedAgent.ts` enriches interpretation with conversation context, dispatches deterministic tools, and logs interactions.

Assessment: the LLM is properly bounded. It interprets; it does not mutate memory directly. The rule-based fallback is useful for tests but is also a growing parallel interpreter with product behavior of its own.

### Tools

- `src/relationship/tools.ts` exposes explicit actions: create candidate, sync events, search, list pending candidates, inspect event matches, confirm, ignore, and create manual memory.

Assessment: the tool interface is clear and observable. Search logic is doing too much inside this module, especially labeled-note parsing, token normalization, ranking, event-wide handling, and ambiguity handling.

### Repository And Memory

- `src/relationship/repository.ts` is the in-memory repository for events, candidates, event matches, memories, and interactions.
- `RelationshipMemory` in `src/relationship/types.ts` stores display name, contact label, event context, date context, note, relationship context, tags, and confidence.

Assessment: the repository is the most important missing production seam. It looks like a future durable store boundary, but its current `ReturnType<typeof createRelationshipRepository>` interface hides invariants and makes it easy to accidentally create isolated memory worlds.

### Response Composition

- `src/relationship/responseComposer.ts` owns user-facing save/search/no-match/clarification/ignore copy and prevents raw search internals from leaking.

Assessment: this is a good deep module. It gives callers leverage: selected facts go in, concise iMessage-style replies come out.

### Evals

- `src/relationship/evals/agentEvalRunner.ts` defines 12 required deterministic trajectory cases across confirmation, event correction, no-event save, ignore, search, context carryover, hallucination guard, unsafe-save guard, Spectrum first-inbound identity, and messy wording.
- Optional model-backed evals are gated by `OPENROUTER_API_KEY` and `FRIENDY_EVAL_RUN_MODEL=1`.

Assessment: the eval harness is the right shape for this product, but the current required suite only proves deterministic behavior. It does not yet measure stochastic model variance or real macOS/Spectrum integration.

### Docs

- `README.md`, `REFERENCE.md`, `docs/ai-system-architecture.md`, `CHANGELOG.md`, `implementation-notes.html`, and `docs/goals/` now describe most of the current system.
- Scoped `AGENTS.md` files make navigation better than average for future agents.

Assessment: docs are strong but starting to sprawl. Several files repeat the same architecture story, and a few scoped instructions are stale after the local checker work.

## 3. Top 10 System Issues Or Risks

1. **No durable shared state between local detection and live iMessage runtime.**
   - Files: `src/relationship/ingestion/localCheck.ts`, `src/relationship/ingestion/localCheckCli.ts`, `src/relationship/transports/spectrumTransport.ts`, `src/relationship/repository.ts`.
   - Why it matters: the MVP loop says new contact -> pending candidate -> user confirms over iMessage. Today the local checker can create a candidate and print/send a prompt, but that candidate is created inside a fresh in-memory repo. A later Spectrum message handled by another runtime will not necessarily see the pending candidate.
   - Severity: high. This is the biggest gap between "working local check" and "working product loop."

2. **The macOS adapters are parser-tested, not real integration-tested.**
   - Files: `src/relationship/ingestion/localMacAdapters.ts`, `src/relationship/ingestion/localMacAdapters.test.ts`.
   - Why it matters: AppleScript syntax, Contacts permissions, Calendar permissions, date coercion, all-day events, recurrence, and timezone behavior can fail outside parser tests.
   - Severity: high.

3. **Contact detection uses contact `updatedAt` as detection time, which can confuse event mapping.**
   - Files: `src/relationship/ingestion/contactSnapshot.ts`, `src/relationship/ingestion/localMacAdapters.ts`, `src/relationship/eventMapper.ts`.
   - Why it matters: event matching depends on `detectedAt`. A contact modified later, imported in bulk, edited for cleanup, or synced from iCloud may point to the wrong event window.
   - Severity: high.

4. **Candidate confirmation picks the first pending candidate.**
   - Files: `src/relationship/agentCore.ts`, `src/relationship/interpretedAgent.ts`, `src/relationship/repository.ts`.
   - Why it matters: a real event can produce multiple new contacts. A simple "yes" could confirm the wrong person if multiple candidates are pending.
   - Severity: high.

5. **The rule-based fallback interpreter is becoming a second product implementation.**
   - Files: `src/relationship/openRouterInterpreter.ts`, `src/relationship/interpretedAgent.ts`, `src/relationship/evals/agentEvalRunner.ts`.
   - Why it matters: fallback heuristics now encode names, events, schools, roles, projects, and search rules. Tests can pass on fallback behavior while the real model behaves differently.
   - Severity: medium-high.

6. **Search is deterministic and transparent, but still too lexical for the target memory problem.**
   - Files: `src/relationship/tools.ts`, `src/relationship/responseComposer.ts`.
   - Why it matters: the product promise is "vague human memory." Lexical matching handles current examples but will miss synonyms, descriptions, and partial memories unless more structured context or retrieval is added.
   - Severity: medium-high.

7. **Manual memories often have weak contact routes.**
   - Files: `src/relationship/tools.ts`, `src/relationship/interpretedAgent.ts`, `src/relationship/responseComposer.ts`.
   - Why it matters: the agent can remember "I met Amaya..." but if that was not tied to a detected contact candidate, the response may not have a real contact route. That weakens the product's "find where to contact them" job.
   - Severity: medium.

8. **Docs describe the product loop more cleanly than the runtime can execute it.**
   - Files: `README.md`, `docs/ai-system-architecture.md`, `CHANGELOG.md`.
   - Why it matters: "Friendy texts user in iMessage" is architecturally right, but current safe path mostly prints prompts; live sending is guarded and not wired to durable pending state.
   - Severity: medium.

9. **The old UI prototype still exists beside the relationship system.**
   - Files: `src/App.tsx`, `src/agent.ts`, `src/memoryStore.ts`, `src/mockData.ts`, `README.md`.
   - Why it matters: future agents can confuse the earlier chat UI/product shell with the current iMessage-first relationship system. The UI is not the current product center.
   - Severity: medium.

10. **Documentation is high-volume and only partly normalized.**
    - Files: `implementation-notes.html`, `CHANGELOG.md`, `docs/goals/*`, `docs/superpowers/*`, `REFERENCE.md`.
    - Why it matters: the repo is agent-navigable today because `REFERENCE.md` exists, but repeated architecture summaries will drift unless one doc becomes the source of truth and others point to it.
    - Severity: medium.

## 4. Docs Drift

- `src/relationship/AGENTS.md`: says `ingestion/` owns "fixture-only contact snapshot diffing" and says to keep real provider adapters as future interfaces. That is stale because `localMacAdapters.ts` and `localCheckCli.ts` now exist.
- `implementation-notes.html`: early notes say native Contacts and Calendar integrations are intentionally deferred and later say ingestion was fixture-only for that goal. The later local checker notes correct this, but the file now contains contradictory historical statements without a current-state summary.
- `docs/ai-system-architecture.md`: Current Limitations says "Contact detection is fixture-based except for the explicit macOS Contacts smoke command." That omits `npm run ingest:local:check`, which also reads Contacts explicitly.
- `CHANGELOG.md`: Current State lists core checks but omits `npm run ingest:local:check -- --mock`; Verification Snapshot includes it later. This is not fatal, but it makes the top state summary stale.
- `REFERENCE.md`: "Current iMessage contact confirmation goal" and "Current local macOS checker goal" are completed goals, not current active goals. This wording will mislead future agents.
- `README.md`: Product Flow Script still emphasizes the older web chat UI with Maya/Alex/Priya. That may be useful historical behavior, but it sits before the relationship-agent sections and can distract from the iMessage-first MVP.
- `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, `docs/goals/EXPERIMENT_NOTES.md`: these are still the completed local-checker goal. That is fine as an execution record, but the docs do not clearly say "completed last goal" versus "active goal."
- `docs/superpowers/plans/*` and `docs/superpowers/specs/*`: useful history, but many are implementation-era artifacts. They should not be treated as current architecture.
- `README.md` and `docs/ai-system-architecture.md`: both contain similar Mermaid flows. Duplication is manageable now, but one should become canonical as the system changes.
- `implementation-notes.html`: very long HTML format is harder to diff and skim than Markdown. It is still valid per global instructions, but the repo now has enough docs that Markdown would be easier for future agents.

## 5. Code Cleanup Candidates

1. **Introduce an explicit repository interface and durable adapter plan.**
   - Files: `src/relationship/repository.ts`, `src/relationship/tools.ts`, `src/relationship/transports/spectrumTransport.ts`, `src/relationship/ingestion/localCheck.ts`.
   - Problem: the repository interface is inferred from an in-memory implementation. Callers can create isolated repos too easily.
   - Cleanup: define a named `RelationshipRepository` interface, keep the in-memory adapter, and make runtime creation explicit.
   - Benefit: higher locality for persistence changes and less accidental state isolation.

2. **Make pending contact candidates a first-class module.**
   - Files: `src/relationship/repository.ts`, `src/relationship/candidateConfirmation.ts`, `src/relationship/agentCore.ts`, `src/relationship/interpretedAgent.ts`.
   - Problem: pending queue selection, event guesses, confirmation parsing, and memory creation are spread across modules.
   - Cleanup: keep the public tool calls, but concentrate candidate selection and confirmation policy in one module.
   - Benefit: multiple-candidate behavior becomes testable through one interface.

3. **Split search ranking from the tools module.**
   - Files: `src/relationship/tools.ts`.
   - Problem: `tools.ts` exposes the tool interface and also owns lexical ranking internals.
   - Cleanup: move search field extraction, tokenization, ranking, and ambiguity thresholds into `memorySearch.ts`.
   - Benefit: better depth and easier search eval expansion without bloating tool code.

4. **Extract local checker runtime construction from CLI parsing.**
   - Files: `src/relationship/ingestion/localCheckCli.ts`.
   - Problem: env loading, arg parsing, state file IO, macOS adapters, Spectrum sender creation, and process exit behavior are in one file.
   - Cleanup: separate `parseLocalCheckArgs`, `runRealLocalCheck`, and `createSpectrumPromptSender` into testable exports or a small runtime module.
   - Benefit: clearer interface for future onboarding or app-triggered local checks.

5. **Replace local checker ephemeral repo with an injected persistence seam.**
   - Files: `src/relationship/ingestion/localCheck.ts`.
   - Problem: `runLocalContactCalendarCheck` always creates a new repo, so it cannot share pending candidates with the live runtime.
   - Cleanup: accept `repo` or `tools` as optional inputs, or return a serializable candidate event that a durable store can persist.
   - Benefit: closes the biggest MVP loop gap.

6. **Make time handling explicit in local contact detection.**
   - Files: `src/relationship/ingestion/contactSnapshot.ts`, `src/relationship/ingestion/localCheckCli.ts`, `src/relationship/eventMapper.ts`.
   - Problem: `updatedAt` does too much work as the detection timestamp.
   - Cleanup: distinguish `contactUpdatedAt`, `observedAt`, and event-mapping timestamp.
   - Benefit: fewer false event mappings.

7. **Add a current-state docs index or status block.**
   - Files: `README.md`, `REFERENCE.md`, `CHANGELOG.md`, `docs/ai-system-architecture.md`.
   - Problem: several docs repeat current state differently.
   - Cleanup: make `docs/ai-system-architecture.md` canonical for architecture, `REFERENCE.md` canonical for navigation, and `CHANGELOG.md` historical only.
   - Benefit: less docs drift.

8. **Update scoped AGENTS files after local checker addition.**
   - Files: `src/relationship/AGENTS.md`, possibly `src/relationship/ingestion/AGENTS.md`.
   - Problem: scoped guidance is stale and too broad for ingestion now.
   - Cleanup: add an ingestion-specific AGENTS file that explains fixture vs explicit real adapters.
   - Benefit: future agents will not accidentally run real Contacts/Calendar from tests.

9. **Turn `implementation-notes.html` into either a current summary plus history or a Markdown equivalent.**
   - Files: `implementation-notes.html`.
   - Problem: current decisions and historical decisions are mixed.
   - Cleanup: add a short "Current Architecture Decisions" section at top, or migrate to Markdown if acceptable.
   - Benefit: easier auditability.

10. **Move old web prototype language below current relationship-agent docs.**
    - Files: `README.md`, `src/App.tsx`, `src/agent.ts`, `src/memoryStore.ts`, `src/mockData.ts`.
    - Problem: the old UI is still valid code, but not the center of the MVP.
    - Cleanup: label it as "legacy local web shell" or move it after the iMessage/local checker sections.
    - Benefit: less navigation confusion.

## 6. Test Gaps

- **Real macOS Contacts/Calendar behavior:** parser tests and non-macOS guards pass, but there is no verified run on macOS with real permissions, recurring events, all-day events, timezone shifts, or Contacts permission prompts.
- **Pending candidate persistence:** tests prove a local checker can create candidates in memory and print a prompt, but do not prove a later live iMessage reply can see that same pending candidate.
- **Multiple new contacts:** tests cover single-candidate local check and fixture ingestion with two candidates, but confirmation behavior still defaults to first pending candidate.
- **Ambiguous confirmation replies:** "yes" with multiple candidates is not tested as an ambiguity that should ask which person.
- **Detection timestamp quality:** no tests simulate contact import, later edit, iCloud sync delay, or a new method on an old contact where `updatedAt` points to a misleading event.
- **Live Spectrum sending from local checker:** live sending is mocked. There is no full run from local checker -> Spectrum prompt -> inbound confirmation -> saved memory with shared state.
- **Model-backed interpreter variance:** optional model evals exist but are not part of required checks. The deterministic fallback can hide model failure modes.
- **Fuzzy search recall/precision:** current evals cover useful examples, but not a broader corpus with near-misses, synonyms, typo-heavy queries, and multiple plausible people.
- **Privacy/logging:** interaction logs are tested, but there is no explicit test that logs avoid secrets or unnecessary contact data.
- **Durable reload behavior:** no test proves memories, candidates, event matches, or interactions survive process restart.

## 7. Comments And JSDoc Assessment

The comments are mostly useful. The best comments explain why a decision exists:

- `eventMapper.ts` explains why short events outrank long/all-day events.
- `repository.ts` explains the in-memory repository as a future persistence seam.
- `responseComposer.ts` explains why user-facing copy must not expose search internals.
- `contactSnapshot.ts` explains method-centric detection.
- `localCheck.ts` explains the explicit local check path.

The weak spots are not noisy comments; they are stale comments or stale scoped instructions:

- `src/relationship/AGENTS.md` is now stale for ingestion.
- `implementation-notes.html` contains historical statements that contradict later implementation state.
- Some exported types in `localCheckCli.ts` are not exported and therefore do not need JSDoc, but if they become reusable they should get concise comments.

Overall: comments are above average and mostly explain intent, but scoped docs need refresh more than inline comments need cleanup.

## 8. Agent Navigability

The repo is reasonably easy for future agents to navigate because:

- `REFERENCE.md` is a real source map.
- Scoped `AGENTS.md` files exist.
- Tests are named by behavior.
- Product checks are explicit npm scripts.
- The relationship system is concentrated under `src/relationship/`.

The friction points:

- There is no `CONTEXT.md` or ADR directory, so architectural language and decisions live across README, architecture docs, changelog, implementation notes, and goal files.
- `docs/goals/PLAN.md` represents the last completed goal, not necessarily the current goal.
- The older web UI shell still looks first-class to someone browsing from `README.md`.
- `implementation-notes.html` is long and chronological, which is useful for history but weak for current-state onboarding.
- The local checker added real adapters, but scoped instructions still imply real providers are future work.

Assessment: agent navigability is good for a fast-moving prototype, but it is entering the stage where docs need normalization before more features are added.

## 9. Recommended Cleanup Plan

Commit 1: `docs:refresh relationship navigation`

- Update `src/relationship/AGENTS.md` for the explicit local checker.
- Add `src/relationship/ingestion/AGENTS.md` to explain fixture checks versus real macOS adapters.
- Change completed-goal wording in `REFERENCE.md`.

Commit 2: `docs:normalize current system docs`

- Make `docs/ai-system-architecture.md` the canonical architecture doc.
- Trim or relabel duplicated current-state text in `README.md` and `CHANGELOG.md`.
- Clarify that the old web shell is secondary to the iMessage-first relationship system.

Commit 3: `docs:summarize implementation notes`

- Add a short current-state summary at the top of `implementation-notes.html`, or migrate to Markdown if the team accepts that.
- Keep chronological history below the summary.

Commit 4: `refactor:separate memory search module`

- Move search scoring/ranking helpers out of `tools.ts`.
- Preserve existing tool interface and tests.
- Add focused search tests around synonyms, false positives, and ambiguity.

Commit 5: `refactor:make repository interface explicit`

- Define a named repository interface.
- Keep current in-memory adapter.
- Update tool/runtime constructors to depend on the interface instead of `ReturnType`.

Commit 6: `feat:share pending candidates across local check and imessage`

- Do not add new detection sources.
- Add a minimal durable store or serialized pending-candidate file for local checker state.
- Prove local checker -> prompt -> inbound confirmation -> saved memory with one shared state path.

Commit 7: `test:add local checker edge coverage`

- Add tests for multiple candidates, stale contact `updatedAt`, no-event confirmation, and explicit ambiguity handling.
- Keep real macOS access out of normal test runs.

## 10. Stop/Go Recommendation

Stop feature expansion and clean first.

The next feature should not be LinkedIn, X, Instagram, richer UI, or a broader agent. The system has enough pieces to prove the MVP, but the state seam is not production-shaped yet. Clean the docs/navigation first, then fix the shared pending-candidate state path. After that, continuing feature work will be much safer.

The most important next product milestone is not more intelligence. It is proving this exact path with shared state:

```text
local checker detects Friendy-101
-> event match is persisted
-> Friendy prompt is sent or printed
-> user replies over iMessage/Spectrum
-> same pending candidate is confirmed
-> memory is saved
-> later iMessage search retrieves the person
```

## Verification Results

Fresh verification was run on 2026-05-21 after creating this audit.

| Command | Result |
| --- | --- |
| `git status --short --untracked-files=all` | Only `docs/reviews/current-system-audit.md` was listed as changed. |
| `npm test` | Passed: 25 test files, 101 tests. |
| `npm run build` | Passed: TypeScript compile and Vite production build completed. |
| `npm run eval:agent` | Passed: 12/12 required cases, 100% pass rate, 0 unsafe mutations, 0 hallucinations. |
| `npm run check:imessage-e2e` | Passed: detected Abc, mapped Photon Residency II, saved the high-school backstory, and retrieved Abc from later search. |
| `npm run ingest:check` | Passed: detected Maya Chen and Nina Park, printed event guesses and pending queue. |
| `npm run ingest:local:check -- --mock` | Passed: detected Friendy-101, mapped Photon Residency Dinner, printed the Friendy confirmation prompt, and stayed in dry-run mode. |
| `git diff --check` | Passed. |

This audit intentionally does not modify product code or existing docs.
