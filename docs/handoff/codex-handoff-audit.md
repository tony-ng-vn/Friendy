# Codex Handoff Audit — Fix Stack PR 5-10

Date: 2026-05-24

Repo audited: `/home/thien/Desktop/Friendy`

Current HEAD: `456530515bbf74123130ca47d70e9be798e4222d`

Branch state: `main...origin/main`, clean before this audit file was written.

## Phase 0 Result

Phase 0 passed for baseline verification: tests, build, evals, and stack-status all ran successfully. Phase 1 may start with PR 5 only after treating this audit as the source of truth over the master handoff prompt where they conflict.

The requested `superpowers:doubt-driven-development` skill is not installed in this Codex session. The audit still followed the requested posture manually: assume the handoff is wrong until repo evidence proves it.

The requested `.agents/skills/friendy-fix-stack/references/parallel-tracks.md` file is not present in this checkout (`rg --files -g 'parallel-tracks.md'` returned no matches).

## Fresh Verification

Commands run locally:

| Command | Result |
| --- | --- |
| `git log -15 --oneline` | Exit 0. HEAD `4565305`; PR 4 merge `4e5d8c4` is in recent history. |
| `git status --short --branch` | Exit 0. `## main...origin/main` before audit edits. |
| `npm run friendy:stack-status` | Exit 0. Script reports PR 1-4, 6-8, 10 done; PR 5 prep; PR 9 partial. See corrected table below because script overstates integration status for PR 6/7/10. |
| `npm test` | Exit 0. 65 files passed, 448 tests passed. |
| `npm run build` | Exit 0. `tsc && vite build` succeeded; Vite transformed 32 modules. |
| `npm run eval:agent` | Exit 0. 42 required cases, 42/42 passed, fallback usage count 35. |

Independent read-only review agents confirmed the same baseline and did not edit files.

## Confirmed

- PR 4 is merged into `main`; HEAD is now `4565305`, not the PR 4 merge commit itself.
- `buildRouterInputEnvelope` is wired in `src/relationship/interpretedAgent.ts`: import near line 50, call near line 630, and `interpreter.interpret({ message, routerContext })`.
- `src/relationship/openAIInterpreter.ts` already accepts the interpreter input envelope shape.
- PR 5 prep exists:
  - `src/relationship/pendingReminderPolicy.ts` exports `decidePendingReminder`.
  - `src/relationship/pendingReminderPolicy.test.ts` covers the pure policy.
  - `src/relationship/responseComposer.ts` exports `composePendingContactsFooter`.
  - `src/relationship/routePolicyValidator.ts` delegates suppression compatibility to `pendingReminderPolicy`.
- PR 6 prep exists:
  - `src/relationship/personIdentity.ts` and tests exist.
  - `src/relationship/duplicateResolution.ts` and tests exist.
  - repository and SQLite person identity APIs/migrations exist.
- PR 7 prep exists:
  - `src/relationship/memoryTargetLookup.ts` and tests exist.
  - `tools.lookup_memory_target` exists.
  - delete/update disambiguation composers exist.
- PR 9 trace type prep exists:
  - `src/relationship/trace.ts` includes `scope_boundary`, model metadata fields, active workflow kind, and selected tool fields.
- PR 10 prep exists:
  - `src/relationship/conversationSession.ts` exists.
  - `src/relationship/conversationSessionStore.ts` has the in-memory store and tests.
- The legacy inline pending reminder append is still live in `src/relationship/interpretedAgent.ts`: it imports `composePendingContactReminder` and appends it after `search_memory`.

## Wrong Or Stale Handoff Claims

- Master prompt repo path `/Users/minhthiennguyen/Desktop/Friendy` is wrong for this environment. Use `/home/thien/Desktop/Friendy`.
- Master prompt baseline `36/36` evals is stale. Live result is `42/42`.
- Master prompt branch statement "synced with origin/main at merge `4e5d8c4`" is stale. Live HEAD is `4565305`, with `4e5d8c4` in history.
- Master prompt "local uncommitted changes" section is stale. The tree was clean before writing this audit.
- `docs/agent-handoff.md` is stale:
  - It still says PR 4 branch status / in progress elsewhere.
  - It records older verification counts such as 52/340, 51/322, 36/36, and 35/35.
  - It lists the macOS path, not this environment's path.
- `npm run friendy:stack-status` overstates PR 6/7/10 as done. It is useful as a hint, not proof of agent/runtime integration.

## Unknown Or Needs Verification During Integration

- Whether doctor strict-mode behavior is fully complete was not exhaustively audited beyond the main wiring claims.
- Whether PR 9 docs are fully aligned remains unknown.
- Whether existing eval regressions prove PR 6/7 behavior is complete is unknown; source evidence shows the required agent workflows are not wired even though some eval cases exist.
- The live macOS E2E state was not run during this audit.

## Corrected Stack Status

| PR | Topic | Corrected status | Evidence |
| --- | --- | --- | --- |
| 1 | Regression freeze | Done | Evals include the regression cases and full eval passes 42/42. |
| 2 | `list_people` tool | Done | `tools.list_people` and list evals are present; full eval passes. |
| 3 | Structured intent router | Done | `routePolicyValidator.ts`, structured intents, and suppress-compat path are present. |
| 4 | Pass state into LLM router | Done | `buildRouterInputEnvelope` is wired into `interpretedAgent.ts` and OpenAI. |
| 5 | Pending reminder policy | Prep, integration not started | Policy + footer composer exist, but trace fields and agent wiring are missing; legacy inline reminder append remains. |
| 6 | Identity resolution | Prep/repo partial, agent workflow not started | Types/repo/parser exist; no `resolve_duplicate_person` tool; no active duplicate workflow in `interpretedAgent.ts`. |
| 7 | Robust delete/update | Prep/tool partial, agent workflow not started | `lookup_memory_target` exists; agent still has legacy `pendingDelete`, inline `rankDisplayNameMatches`, and direct mutation paths. |
| 8 | Sensor normalization ack | Done | Runtime files and tests are present; no Phase 1 work planned here. |
| 9 | Strict-mode dogfooding trace | Partial | Trace fields exist; OpenAI model metadata and real-turn trace population are incomplete. |
| 10 | Durable conversation session | Prep only | Session types and in-memory store exist; no SQLite `conversation_sessions`, no agent session-store option, no runtime wiring. |

## PR 5 Task Matrix

| Task | Corrected status | Evidence |
| --- | --- | --- |
| T1 policy tests | Done | `pendingReminderPolicy.test.ts` exists. |
| T2 policy implementation | Done | `decidePendingReminder` handles TTL/cooldown/same-name/list suppression. |
| T3 footer composer | Done | `composePendingContactsFooter` exists. |
| T4 trace fields | Done | `FriendyTrace` / runtime trace include allowlisted `pendingReminderDecision` and `pendingReminderReason`. |
| T5 agent wiring | Done | `interpretedAgent.ts` calls `decidePendingReminder`, updates process-local `reminderState`, and appends `composePendingContactsFooter` only on policy append. |
| T6 PR 5 evals | Done | `pending-reminder-*` eval ids exist and consume the supplied eval interpreter instead of local stubs. |
| T7 route policy migration | Done | `routePolicyValidator` keeps `suppressPendingReminder` as compatibility metadata only; append/defer lives in `pendingReminderPolicy.ts`. |
| T8 docs/final verification | Done | Docs updated after integration. Final verification: targeted PR 5 suite 6 files/93 tests, `npm run build`, `npm run eval:agent` 46/46, and `git diff --check` all passed. |

## PR 6 Task Matrix

| Task | Corrected status | Evidence |
| --- | --- | --- |
| T1 domain types | Partial | Person identity types exist, but `RelationshipMemory.personId` remains optional. |
| T2 in-memory repo API | Done/prep | Repository person identity methods exist. |
| T3 SQLite schema/backfill | Done/prep | SQLite person/link migration and backfill code exist. |
| T4 duplicate parser | Done | `duplicateResolution.ts` parses `same`, `different`, `ignore`, and `not sure` with tests. |
| T5 tool/composer | Done | `resolve_duplicate_person` exists in `tools.ts`; duplicate prompt copy now advertises all deterministic replies. |
| T6 agent workflow | Done | `interpretedAgent.ts` opens and resolves `duplicate_resolution` before context capture, with `activeWorkflowKind` trace. Runtime prompts also ask same/different for same-name saved people. |
| T7 eval/docs | Done | Same-name eval, focused agent/runtime tests, handoff docs, and implementation notes updated. |

## PR 7 Task Matrix

| Task | Corrected status | Evidence |
| --- | --- | --- |
| T1 lookup module | Done/prep | `memoryTargetLookup.ts` exists with tests. |
| T2 tool/composers | Partial | `lookup_memory_target` and composers exist, but not the full agent path. |
| T3 agent routing/frames | Not started | Agent still uses legacy `pendingDelete`, inline display-name ranking, and direct mutation paths. |
| T4 policy/trace | Not started | No strict lookup-before-mutation enforcement; real-turn traces do not populate `selectedTool` / active workflow. |
| T5 eval/verification | Partial | Fuzzy-delete eval exists, but current implementation can still bypass planned lookup-confirm discipline. |

## PR 9 Task Matrix

| Task | Corrected status | Evidence |
| --- | --- | --- |
| T1 trace type extensions | Done | Types exist in `trace.ts`. |
| T2 OpenAI metadata | Not started | Interpreter result type does not carry model metadata fields on all paths. |
| T3 agent scope/workflow trace | Partial | Types exist; real-turn trace population is incomplete. |
| T4 runtime warning/doctor | Partial | Runtime strict-off warning exists; doctor not fully audited. |
| T5 docs | Partial/unknown | Handoff says partial; no complete proof. |
| T6 May 23 joint acceptance | Not started | No dedicated joint transcript acceptance case found. |

## PR 10 Task Matrix

| Task | Corrected status | Evidence |
| --- | --- | --- |
| T1 session types/helpers | Done/prep | `ConversationSession` and helpers exist. |
| T2 in-memory store | Done/prep | `createInMemoryConversationSessionStore` exists. |
| T3 SQLite table/store | Not started | No `conversation_sessions` / SQLite conversation session store found. |
| T4 agent load/write path | Not started | Agent options have no session store; `ConversationContext` remains a process-local `Map`. |
| T5 PR4/PR5 hooks | Not started | Router envelope still reads reconstructed `ConversationState`; PR5 reminder policy is not wired. |
| T6 runtime wiring/docs | Not started | Runtime and Spectrum create agents without a session store. |

## Grep Evidence Snapshot

- `rg -n "decidePendingReminder" src/relationship/interpretedAgent.ts` finds nothing.
- `rg -n "buildRouterInputEnvelope" src/relationship/interpretedAgent.ts` finds import/call.
- `rg -n "pendingReminderDecision" src/relationship/trace.ts` finds nothing.
- `rg -n "resolve_duplicate_person" src/relationship/tools.ts` finds nothing.
- `rg -n "conversationSession" src/relationship/interpretedAgent.ts` finds nothing.
- `rg -n "conversation_sessions|createSqliteConversationSessionStore" src/relationship` finds nothing.
- `rg -n "pending-reminder-" src/relationship/evals` finds nothing.

## Phase 1 Start Here

PR 5 is integrated. Start next with PR 6 identity resolution after final PR 5 verification is green and committed.

## Integration Risks To Keep Visible

1. Status/docs are stale enough to mislead implementation order. Use file evidence over labels.
2. PR 5 legacy reminder behavior is still live and must be removed from the search happy path.
3. PR 6 same-name identity resolution can still be bypassed by generic pending-candidate confirmation until the duplicate workflow is wired.
4. PR 7 delete/update has read-only lookup prep, but destructive mutation paths still need lookup-confirm discipline.
5. PR 10 requires a real SQLite session store and restart proof; in-memory session prep is not durable.
6. PR 9 trace types alone do not prove real-turn trace population.
