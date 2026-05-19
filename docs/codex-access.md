# Codex Access Setup

## Recommended Command

To give Codex broad command access while keeping approval prompts available for risky actions, start Codex like this:

```bash
codex --sandbox danger-full-access --ask-for-approval on-request -C /home/thien/Desktop/Friendy
```

This is the practical setup for "full access except destructive commands."

## Do Not Use By Default

Avoid this unless the environment is externally sandboxed:

```bash
codex --dangerously-bypass-approvals-and-sandbox
```

That removes both sandboxing and approval prompts.

## Optional Persistent Profile

Add this to `~/.codex/config.toml`:

```toml
[profiles.full_access]
sandbox_mode = "danger-full-access"
approval_policy = "on-request"
```

Then launch with:

```bash
codex --profile full_access -C /home/thien/Desktop/Friendy
```

## Destructive Command Policy

Keep this rule in `AGENTS.md`:

```md
Do not run destructive commands without explicit user approval, including rm -rf, git reset --hard, git clean -fdx, force pushes, deleting branches, dropping databases, broad chmod/chown, or deleting user files.
```

The "except destructive commands" part is enforced by agent instructions and approval policy. It is not a perfect operating-system-level filter.
