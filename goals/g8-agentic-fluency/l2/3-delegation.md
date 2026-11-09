---
title: Plan mode, tests, subagents, and parallel sessions
---

L1 set the order: plan before editing, then work in steps that each end with a check (G8.3 L1). Claude Code has a tool for each part.

**Plan mode.** Shift+Tab cycles the permission mode; the status bar shows `plan mode on`. To start in it: `claude --permission-mode plan`. In plan mode Claude reads files and runs commands to explore, writes a plan, and edits nothing until you approve; Ctrl+G opens the plan in your editor first. The `opusplan` model alias plans with Opus and carries the plan out with Sonnet, the cheaper model (G8.1 L2).

**Tests first.** Test-driven development (TDD) writes a failing test before the code that makes it pass. With an agent the test is also the definition of done, and the agent's own check:

1. `Write a failing test in DocumentControllerTest that reproduces the bug: an invalid cursor returns 500 where it should return 400. Don't fix anything yet.`
2. Run it and see it fail for the right reason. Commit the test.
3. `Make the test pass. Don't change the test.`
4. Review the diff: the test file must be unchanged (G8.4 L2).

Kent Beck runs the same loop from a plan file: "find the next unmarked test in plan.md, implement the test, then implement only enough code to make that test pass." The Claude Code docs also suggest two sessions: "have one Claude write tests, then another write code to pass them."

**Subagents.** A **subagent** is a separate Claude with its own context window, system prompt, tools, and permissions. The main session gives it a task; it does the work in its own context and returns only a summary, often 1,000–2,000 tokens, so the file contents it read never enter the main context. Claude Code ships three:

| Subagent | Tools | Used for |
|---|---|---|
| Explore | read-only | finding files and code |
| Plan | read-only | research for a plan, in plan mode |
| general-purpose | every tool subagents may have | multi-step work, including edits |

Your own live in `.claude/agents/` (shared through git) or `~/.claude/agents/` (yours in every project), one Markdown file each. From the docs:

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

Claude picks a subagent from its `description`, or you name it: "use the code-reviewer agent". `tools` limits what it can do, here read-only; `model` can route cheap work to Haiku. A subagent can start subagents of its own, up to three levels below the main session.

**Parallel sessions.** A **git worktree** is a second working folder of the same repository, checked out on its own branch, so two sessions edit files without colliding. `claude --worktree paging` creates one under `.claude/worktrees/paging/` and starts a session in it. The docs' writer–reviewer pattern uses two: one session writes the change, a second reviews it with a fresh context, because "Claude won't be biased toward code it just wrote."

**Headless runs.** `claude -p "…"` runs one task without the interactive screen and prints the result, for scripts and CI:

```bash
claude -p "List every endpoint without an integration test" \
  --output-format json \
  --allowedTools "Read,Grep,Glob" \
  --max-turns 20
```

- `--output-format` — `text`, `json`, or `stream-json` (one JSON event per line).
- `--allowedTools` — the tools that run without asking; in a script nothing can ask, so list exactly what the task needs.
- `--max-turns` — a cap on the loop (G5.5).
- `--permission-mode dontAsk` — deny anything not pre-approved, for locked-down CI.

**Fan-out.** For the same change across many files, the docs loop a headless run over a list:

```bash
for file in $(cat files-to-migrate.txt); do
  claude -p "Migrate $file from RestTemplate to RestClient. Run its tests. Reply OK or FAIL." \
    --allowedTools "Edit,Bash(./mvnw test *)"
done
```

Their advice: "Refine your prompt based on what goes wrong with the first 2-3 files, then run on the full set."

**Starting over.** Esc stops Claude mid-turn; Esc twice or `/rewind` restores code and conversation to an earlier prompt. Anthropic's data science team works like a slot machine: "Save your state before letting Claude work, let it run for 30 minutes, then either accept the result or start fresh… Starting over often has a higher success rate than trying to fix Claude's mistakes." Their RL team tries one shot first and reports it works "about one-third of the time".

Sources: [Claude Code — Permission modes (plan mode)](https://code.claude.com/docs/en/permission-modes) · [Claude Code — Best practices](https://code.claude.com/docs/en/best-practices) · [Claude Code — Subagents](https://code.claude.com/docs/en/sub-agents) · [Anthropic — Effective context engineering (subagent summaries)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) · [Claude Code — Worktrees](https://code.claude.com/docs/en/worktrees) · [Claude Code — Headless mode](https://code.claude.com/docs/en/headless) · [Claude Code — Checkpointing](https://code.claude.com/docs/en/checkpointing) · [Kent Beck — Augmented coding: beyond the vibes](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes) · [Anthropic — How Anthropic teams use Claude Code (PDF)](https://www-cdn.anthropic.com/58284b19e702b49db9302d5b6f135ad8871e7658.pdf)
