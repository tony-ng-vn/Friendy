# Friendy Developer Preferences

Durable workflow preferences for agents working in this repo. Encoded from session behavior — not generic advice.

## Core pipeline

1. **Eval-first** — Freeze log failures as `agentEvalRunner` cases before architecture changes (PR 1 pattern).
2. **Concrete fix stack** — Numbered PRs 1–10 with explicit dependencies; see `friendy-fix-stack/references/pr-stack.md`.
3. **Superpowers primary** — `brainstorming` → spec → `writing-plans` → `executing-plans`. Not GSD for this fix stack.
4. **Diagnosis anchor** — Failures are mostly pre-LLM routing/state, not model weakness.

## Verification gate (required before “done”)

```bash
npm test
npm run eval:agent
npm run build
```

Live Mac changes: also `npm run doctor:friendy` and manual E2E per `friendy-mac-e2e`.

## Git

- **No auto-commit** unless user explicitly asks.
- Commit format: `<scope>:<message>` (e.g. `feat:…`, `test:…`, `docs:…`).

## Session read order

1. `REFERENCE.md`
2. `docs/agent-handoff.md`
3. Active goal under `docs/goals/`
4. `implementation-notes.html` for history (not as first read)

## Handoff trilogy (after meaningful work)

Update all: `docs/agent-handoff.md`, active goal file, `implementation-notes.html`.

## Multi-agent

- Cursor + Codex in parallel is OK on non-overlapping PRs.
- Use `friendy-cross-agent-handoff` for prompts.
- Sync via specs/plans in `docs/superpowers/`, not chat memory.

## Spec review bar

- State passed to LLM router (PR 4 envelope)
- Bounded deterministic tools, no new regex routes
- Eval cases listed
- Delta vs merged work clear (PR 9)

## Project skills

Located in `.agents/skills/` (Codex) and `.cursor/skills/` (Cursor). Start with `friendy-skill-router`.

**Live PR status:** `npm run friendy:stack-status`

Each skill uses `references/` for detailed examples (iMessage parsing, eval patterns, parallel agent prompts).
