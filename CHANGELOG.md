# Changelog

This file records the main product, architecture, and verification progress for Friendy from the initial scaffold through the current iMessage-first relationship-memory MVP.

## 2026-05-20

### Current State

- Friendy is framed as an iMessage-first relationship memory agent built around Photon/Spectrum as the communication transport.
- The MVP focus is new phone contact detection, event/context mapping, user confirmation over iMessage, structured memory save, and later search by vague human context.
- The repo is on `main`, pushed to GitHub, with the core checks passing from the latest completed mainline run:
  - `npm test`
  - `npm run build`
  - `npm run eval:agent`
  - `npm run check:imessage-e2e`
  - `npm run ingest:check`
  - `npm run ingest:local:check -- --mock`

### Product And Planning

- Defined the product as a relationship memory agent, not a CRM, social network, identity graph, or scraping system.
- Narrowed V1 to phone contacts as the first detection source and iMessage as the main communication surface.
- Captured product docs for the MVP loop, privacy guardrails, handoff context, and architecture.
- Added Superpowers planning artifacts, goal prompts, goal runbook, and goal-writing guidance.
- Added repo navigation docs so future agents can find the right context quickly through `REFERENCE.md`, scoped `AGENTS.md` files, and goal docs.
- Removed show-oriented wording across the repo so product checks are treated as real verification paths, not one-off presentation artifacts.

### Local Prototype Shell

- Scaffolded the Vite, React, and TypeScript app at the repo root.
- Added a chat-first Friendy interface with side panels for event state, pending candidates, and saved memories.
- Added mocked event/contact signals for the local prototype:
  - Photon Residency Dinner event.
  - Seed contact candidates.
  - User approval flow.
  - Natural-language context capture.
  - Vague recall search.

### Relationship Agent Core

- Added `src/relationship/` as the main agent-system boundary.
- Added typed domain models for users, events, detected contacts, pending candidates, memories, notes, contact methods, and interactions.
- Added deterministic contact-to-calendar event matching with overlap ranking.
- Added an in-memory repository shaped like a future durable storage boundary.
- Added relationship tools for:
  - creating contact candidates,
  - listing pending candidates,
  - listing ranked event matches,
  - confirming candidates,
  - ignoring candidates,
  - syncing fixture calendar events,
  - searching memories.
- Added a deterministic relationship agent core that can confirm, ignore, save, clarify, and search without requiring an LLM.
- Added a terminal transport harness for local agent checks without Spectrum credentials.

### Spectrum And iMessage Transport

- Installed `spectrum-ts` and configured TypeScript module resolution so Spectrum provider subpaths resolve correctly.
- Added a Spectrum/iMessage transport adapter.
- Added `.env.local` and `.env` loading for standalone `tsx` agent scripts.
- Added `readSpectrumCredentials` behavior so `npm run agent:spectrum` fails clearly when Spectrum credentials are missing.
- Kept Spectrum as a communication adapter; all relationship decisions remain in the core agent/tools layer.
- Changed Spectrum runtime identity handling so a first inbound space can become the conversation identity when no explicit user ID exists.
- Added compact interaction logging for interpreted Spectrum messages.

### LLM Interpretation Layer

- Added a transport-agnostic message interpretation contract.
- Added OpenRouter structured-output interpretation using validated JSON.
- Set the default OpenRouter model to `nvidia/nemotron-3-super-120b-a12b:free`.
- Added deterministic fallback interpretation for local testing and missing API keys.
- Added retry and invalid-output fallback behavior.
- Kept the LLM bounded: it interprets messy text into intent JSON, but deterministic tools perform all memory writes, ignores, and searches.

### Contextual Memory Capture

- Expanded manual capture so Friendy accepts natural first-person messages like `I met Amaya at Photon Residency II...`.
- Added conversation-context carryover so follow-up messages like `also met Felix Ng...` can inherit the active event/date context.
- Added `chrono-node` for natural-language date parsing.
- Stored raw date phrases plus normalized date context when users mention `today`, `yesterday`, or similar temporal phrases.
- Added regression coverage for multi-person Photon Residency II memories, including Amaya, Sarah Fah, and Felix Ng.

### Response Composer

- Added `responseComposer.ts` as the user-facing reply boundary.
- Replaced raw database-style response text with short iMessage-style replies.
- Prevented user-facing replies from leaking:
  - `matched:` phrases,
  - scoring/debug details,
  - placeholder labels like `manual contact`.
- Added composed replies for save, search, no-match, clarification, and ignore paths.

### Search And Ranking

- Added field-aware deterministic memory search.
- Weighted specific fields like role, project, school/class year, alias, and context above generic shared event words for narrow searches.
- Preserved broad event-wide recall, so queries like `Who did I meet at Photon Residency II?` can return multiple relevant people.
- Added ambiguity handling for cases like multiple founders from dinner.
- Added transcript coverage for field-aware search behavior.

### Contact Event Verification Queue

- Added `candidateConfirmation.ts` as the deterministic consent boundary for queued contacts.
- Added corrected-event handling so users can override a guessed event during confirmation.
- Added no-event confirmation support when the calendar has no matching event and the user supplies context.
- Added ignore behavior for candidates the user did not meet.
- Added `list_candidate_event_matches` so the agent can inspect ranked calendar guesses before saving a memory.
- Ensured exact corrected event titles are preferred before looser substring matches.

### Agent Evaluation Harness

- Added `src/relationship/evals/` as the product-level eval boundary.
- Added `npm run eval:agent`.
- The required deterministic eval suite covers:
  - clear-event contact confirmation,
  - overlapping-event correction,
  - no-event user-supplied event,
  - ignored candidate,
  - post-confirmation search,
  - vague-search clarification,
  - multi-person event recall,
  - context carryover,
  - hallucination guard,
  - unsafe-save guard,
  - Spectrum first-inbound identity,
  - messy human wording.
- Eval metrics include pass rate, intent accuracy, memory-write correctness, search recall@3, unsafe mutation count, hallucination count, and clarification correctness.
- Optional model-backed evals are gated behind `OPENROUTER_API_KEY` and `FRIENDY_EVAL_RUN_MODEL=1`.

### Contact And Calendar Ingestion

- Added fixture contact snapshot diffing under `src/relationship/ingestion/`.
- Made contact diffing method-centric:
  - new normalized phone/email methods can create detections,
  - name-only edits do not create detections,
  - duplicate normalized methods are ignored.
- Added fixture calendar provider abstraction.
- Added `sync_calendar_events` so ingestion can seed events through the existing tool boundary.
- Added `npm run ingest:check` to print a deterministic contact/calendar ingestion flow without reading real Contacts or calendars.
- Added explicit macOS Contacts smoke command:
  - `npm run ingest:contacts:smoke -- --name Friendy-001`
  - only accepts names matching `Friendy-<number>`,
  - creates or reuses that exact test contact,
  - fails clearly outside macOS.
- Kept real Contacts access out of tests, builds, evals, product checks, and normal agent runs.

### Local macOS Contact/Calendar Checker

- Added `npm run ingest:local:check`.
- Added real macOS Contacts and Calendar provider adapters behind the explicit local command.
- Added deterministic `--mock` mode so local checker behavior can be verified without macOS permissions.
- Added `.friendy/local-contact-snapshot.json` as the local baseline snapshot path and ignored `.friendy/` in git.
- Kept the checker dry-run by default: it prints the Friendy confirmation prompt and does not send a live iMessage.
- Guarded live Spectrum sending behind `FRIENDY_LOCAL_CHECK_SEND=1` plus a target phone number from `FRIENDY_LOCAL_CHECK_TO_PHONE` or `FRIENDY_OWNER_PHONE`.
- Routed detected contacts through the existing contact snapshot diff, calendar matching, repository, pending candidate queue, and confirmation prompt boundary.
- Preserved the no-event case by creating a pending candidate and asking the user where they met the person.

### iMessage Contact Confirmation Flow

- Added `npm run check:imessage-e2e`.
- Added deterministic iMessage/Spectrum-style product flow through the same runtime boundary used by the live Spectrum adapter.
- The flow starts from fixture contact/calendar ingestion, not manually seeded memory.
- The flow proves:
  - new contact candidate detected,
  - best event guess printed,
  - Friendy confirmation prompt generated,
  - messy user reply routed through the iMessage/Spectrum runtime boundary,
  - pending candidate confirmed,
  - structured memory saved,
  - later search retrieves the person.
- Added the hard messy case:

```text
met abc at Photon Residency II after havent met him since high school in minnesota
```

- Friendy now separates:
  - current event context: `Photon Residency II`,
  - relationship backstory: `had not seen him since high school in Minnesota`,
  - contact method from the new phone contact.
- Later search retrieves the person for:

```text
who did I run into from high school at Photon?
```

### Architecture Documentation

- Added `docs/ai-system-architecture.md`.
- Added Mermaid system flows to README and architecture docs.
- Documented Friendy as an AI system made of:
  - transport,
  - ingestion,
  - message normalization,
  - interpretation,
  - deterministic tools,
  - memory repository,
  - search/ranking,
  - response composition,
  - evals,
  - privacy guardrails.
- Documented that the LLM is only one bounded component, not the whole system.

### Verification Snapshot

- Latest full verification on `main` passed after the local checker merge:
  - `npm test`: 25 files, 101 tests.
  - `npm run build`: TypeScript and Vite production build passed.
  - `npm run eval:agent`: 12/12 required cases passed.
  - `npm run check:imessage-e2e`: passed.
  - `npm run ingest:check`: passed.
  - `npm run ingest:local:check -- --mock`: printed the Friendy confirmation prompt for `Friendy-101` and stayed in dry-run mode.
  - `git diff --check`: passed.
  - Forbidden-term search for old show-oriented wording: no matches.

### Current Limitations

- Contact/calendar detection is deterministic for normal product checks and explicit-command-only for real local macOS reads.
- Real Contacts access exists only in explicit local commands.
- Real Apple Calendar ingestion exists only in the explicit local checker, not durable production sync.
- No background watcher/daemon exists yet.
- No durable database exists yet.
- No onboarding/signup flow exists yet.
- LinkedIn, X, Instagram, and other social connection sources are future detectors, not current MVP work.
- Friendy does not read iMessage.
- Friendy does not scrape social platforms.
- Friendy does not auto-save people without confirmation.

### Recommended Next Step

- Harden the explicit local checker into a user-controlled production signal:
  - validate real macOS AppleScript behavior on a machine with Contacts/Calendar permissions,
  - persist candidates durably,
  - connect the printed prompt path to live Spectrum sending only after user-controlled configuration,
  - keep confirmation and later search in the existing iMessage/Spectrum runtime.
