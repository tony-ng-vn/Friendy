# Goal Writing Guide

Use this guide before creating or editing any Friendy `/goal` prompt.

## What A Good Goal Is

A goal is a completion contract for long-running Codex work. It should tell the agent:

- what final state must be true,
- what evidence proves it,
- what constraints must remain intact,
- what files should track progress,
- when to stop and mark the goal complete.

Do not use a goal for a one-line edit, a simple explanation, a small code review, or any task where a normal prompt is enough.

## Required Shape

Use this pattern:

```text
/goal [do the work] until [measurable end state] without [constraints that must hold].
```

For repo goals, prefer storing the long form in `docs/goals/<name>-goal.md`, then run:

```text
/goal Read docs/goals/<name>-goal.md and execute it exactly. Use TDD when changing behavior, keep docs/goals/PLAN.md, docs/goals/EXPERIMENTS.md, docs/goals/EXPERIMENT_NOTES.md, and implementation-notes.html updated, commit incrementally with <scope>:<message>, verify with the required commands, then push main.
```

## Checklist

Every goal file should include:

- `Objective`: one concrete outcome, not a theme.
- `Why This Matters`: the product or engineering reason.
- `Non-Negotiables`: constraints the agent must not violate.
- `Required Behavior`: observable behaviors that must be true.
- `Test Cases`: realistic inputs and expected outputs.
- `Verification Commands`: commands the agent must run before completion.
- `Completion Criteria`: checklist-style, auditable finish line.

For research-heavy goals, also include:

- claim inventory to build,
- what counts as direct evidence,
- what counts as proxy support,
- what counts as blocked,
- required final report sections separating confirmed claims, approximate support, blockers, and uncertainty.

## Make Completion Measurable

Weak:

```text
/goal make search better
```

Strong:

```text
/goal Improve Friendy memory search until the demo query "Find the recruiting agents founder from Photon" returns Maya as the only confident top match, "Who was making devtools?" returns Leo without also returning Rina, and all existing tests still pass.
```

Strong goals name exact examples, expected output, and verification commands.

## Keep Feedback Tight

Give the agent fast checks it can run repeatedly:

- targeted tests for the new behavior,
- a deterministic smoke harness for realistic transcripts,
- `npm test`,
- `npm run build`,
- `git diff --check`.

If a goal depends on a long manual process, add a smaller automated proxy that catches the important behavior.

## Progress Tracking

Each active goal must keep:

- `docs/goals/PLAN.md`: current checklist with statuses.
- `docs/goals/EXPERIMENTS.md`: clean record of red/green cycles, verification commands, and results.
- `docs/goals/EXPERIMENT_NOTES.md`: chronological notes and decisions.

Use the tracking files to preserve state across compaction and resumed turns. Do not rely on chat memory alone.

## Constraints To Repeat Often

Include these unless there is a reason not to:

- Use TDD for behavior changes.
- Commit incrementally with `<scope>:<message>`.
- Keep `implementation-notes.html` updated.
- Do not commit secrets.
- Do not redefine success around partial progress.
- Do not mark the goal complete until every completion criterion has current evidence.
- Push `main` only after verification passes on `main`.

## Friendy Goal Template

```markdown
# Goal: <Name>

## Objective

<One concrete final state.>

## Why This Matters

<Why this moves Friendy toward the relationship-memory MVP.>

## Non-Negotiables

- Use TDD.
- Commit incrementally with `<scope>:<message>`.
- Keep `implementation-notes.html` updated.
- Keep `docs/goals/PLAN.md`, `docs/goals/EXPERIMENTS.md`, and `docs/goals/EXPERIMENT_NOTES.md` updated.
- Do not commit secrets.
- Do not weaken existing behavior to make the new tests pass.

## Required Behavior

- <Behavior 1>
- <Behavior 2>
- <Behavior 3>

## Test Cases

Cover at least:

- <Realistic input> -> <expected output>
- <Realistic input> -> <expected output>
- <Edge case> -> <expected output>

## Verification Commands

Run before completion:

```bash
npm test
npm run build
git diff --check
```

## Completion Criteria

- <Auditable criterion 1>
- <Auditable criterion 2>
- All verification commands pass.
- Relevant docs are updated.
- Changes are committed incrementally.
- `main` is pushed when complete.
```

## Sources

- OpenAI Cookbook, "Using Goals in Codex": https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
- User-provided goal-mode notes in this project thread: use clear quantitative finish lines, tight feedback loops, and markdown progress files.
