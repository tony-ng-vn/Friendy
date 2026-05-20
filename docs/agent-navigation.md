# Agent Navigation Design

Friendy uses a small agent-navigation layer so coding agents can find the right project context without loading every product decision, spec, and implementation note into the prompt.

## Principle

Agents understand dense context well once it is in front of them, but they are weaker at deciding which files matter in an unfamiliar repository. Optimize the repo like an index:

- `REFERENCE.md` is the top-level map.
- Root `AGENTS.md` contains global behavior and durable repo rules.
- Nested `AGENTS.md` files contain only local rules that change how work should happen in that subtree.
- Specs, plans, and implementation notes remain separate files linked from the map.

Do not turn `AGENTS.md` into a second README or a copied spec. Every extra rule competes with the task for model attention.

## Structure

```text
AGENTS.md
REFERENCE.md
docs/
  AGENTS.md
  agent-navigation.md
  goals/
    AGENTS.md
  superpowers/
    AGENTS.md
src/
  AGENTS.md
  relationship/
    AGENTS.md
    transports/
      AGENTS.md
```

## What Belongs Where

| File | Use it for | Do not use it for |
| --- | --- | --- |
| `REFERENCE.md` | Fast repo routing, current architecture snapshot, key commands, active work pointers | Full specs, long rationales, implementation scratchpads |
| Root `AGENTS.md` | Global constraints: commits, destructive commands, comments, navigation habits | Product requirements or feature-specific behavior |
| Scoped `AGENTS.md` | Local invariants, test commands, boundaries that only apply inside that folder | Repeating root rules or copying another folder's instructions |
| `implementation-notes.html` | Decisions made during implementation, tradeoffs, verification history | Navigation maps or broad project docs |
| `docs/superpowers/*` | Approved specs and execution plans | Current status tracking during a goal loop |
| `docs/goals/*` | Goal-mode prompts and measurable progress tracking | General product documentation |

## Writing Rules

- Keep each `AGENTS.md` under roughly 80 lines unless the directory is unusually complex.
- Prefer bullets over prose paragraphs.
- Write rules as operational constraints: "Do X when Y" beats abstract advice.
- Link to canonical docs instead of copying them.
- Add scoped files only when the subtree has rules that differ from the parent.
- Remove stale rules when the architecture changes.

## Update Triggers

Update this navigation layer when:

- a new top-level subsystem appears;
- a transport, memory backend, or agent boundary changes;
- a new command becomes the preferred test or demo path;
- an agent repeats the same wrong exploration path;
- a code review finds that future agents need durable local context.

Do not update it just because a single implementation detail changed. Put those details in the implementation notes or the relevant spec.

## Research Basis

- OpenAI's Codex `AGENTS.md` guide documents project instruction discovery and nested instruction files, including splitting instructions across directories when size becomes a problem: https://developers.openai.com/codex/guides/agents-md
- Anthropic's Claude Code memory docs recommend concise, specific project memory and moving multi-step or local instructions out of broad memory files: https://docs.anthropic.com/en/docs/claude-code/memory
- Anthropic's context-engineering guidance treats context as a finite resource and recommends high-signal, minimal context plus just-in-time retrieval through lightweight identifiers such as paths and links: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic's agent-building guidance argues for simple, composable patterns and clear tool boundaries before adding framework complexity: https://www.anthropic.com/engineering/building-effective-agents
- "Lost in the Middle" shows that long-context retrieval can degrade depending on where relevant information appears, which supports keeping always-loaded files short and using maps to load details on demand: https://arxiv.org/abs/2307.03172
- "Context Engineering for AI Agents in Open-Source Software" studies real AGENTS.md adoption and frames these files as project structure, build/test, and workflow context for autonomous coding agents: https://arxiv.org/abs/2510.21413
- "Evaluating AGENTS.md" is a useful warning: context files can increase cost and hurt task success when they add unnecessary requirements, so Friendy should keep instructions minimal and human-curated: https://arxiv.org/abs/2602.11988

## Current Recommendation

Keep the current structure. Add new scoped `AGENTS.md` files only when a directory has a different invariant that future agents are likely to miss. For this repo, the highest-value scoped guidance is around `src/relationship/` because the LLM interpretation boundary is easy to accidentally blur.
