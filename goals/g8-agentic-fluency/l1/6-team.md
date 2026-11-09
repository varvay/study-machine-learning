---
title: Extending and team workflows
---

Claude Code is configured by files, most of them in a `.claude/` folder in the repository or in `~/.claude/` for you alone. Each extension point answers a different need:

- **CLAUDE.md** — instructions loaded at the start of every session (G8.2). For facts true in every task: commands, conventions, layout.
- **Skills** — a **skill** is a folder with a `SKILL.md` file of instructions, plus any scripts or reference files it needs, for one kind of task, such as writing a migration. Only each skill's name and one-line description load at session start; the body loads when Claude, or you with `/skill-name`, invokes it. Anthropic calls this **progressive disclosure**: an agent can have many skills and pay context only for the ones in use. Custom slash commands are skills too: a file in `.claude/commands/` and one in `.claude/skills/` both create a `/name` command.
- **Hooks** — shell commands Claude Code runs itself at fixed points in a session: before a tool runs, after a file edit, when a session starts, when Claude finishes. A hook can format a file, run a check, or block an action. The docs set them apart from instructions: "Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee the action happens."
- **MCP servers** — programs that give Claude new tools and data over the Model Context Protocol (G5.4 L1), such as a database, an issue tracker, or a browser. For services with a command-line tool, the docs prefer the CLI: `gh`, `aws`, and `gcloud` add nothing to the context until used.
- **Subagents** — named specialists defined in `.claude/agents/`, each with its own instructions, tools, and model, such as a read-only code reviewer (G8.3 L2).
- **Plugins** — a bundle of skills, hooks, subagents, and MCP servers, installed with `/plugin` from a marketplace, a catalog of plugins such as Anthropic's official one.

| Need | Use |
|---|---|
| A fact Claude needs in every task | CLAUDE.md |
| A procedure Claude needs for some tasks | a skill |
| An action that must happen every time | a hook |
| Access to an outside system | a CLI tool, or an MCP server |
| A side task in its own context | a subagent |
| The same setup across many repositories | a plugin |

**Agents in CI and on pull requests.** CI (continuous integration) is the automation that builds and tests every change on a server. Claude Code runs there too:

- **GitHub Actions** — Anthropic's `claude-code-action` runs Claude Code in a workflow. Mention `@claude` in an issue or pull request comment and it answers, implements the change, or pushes commits; given a fixed prompt, it runs on any event, such as each new pull request.
- **Code Review** — Anthropic's managed review on Team and Enterprise plans: several agents review every pull request and a verification step filters out false positives, with no workflow file to maintain.
- **Headless runs** — `claude -p "…"` runs one task without the interactive screen, for scripts and other CI systems (G8.3 L2).

Other vendors have the same pattern: GitHub's Copilot cloud agent takes an assigned issue and opens a pull request.

**Shared by committing it.** Everything above is plain files. Committed to the repository, the `.claude/` folder gives every developer and every CI run the same instructions, skills, hooks, and permission rules; `CLAUDE.local.md` and `.claude/settings.local.json` stay personal. This journal's own `.claude/` folder is the worked example in G8.6 L3.

Sources: [Claude Code — Extend Claude Code (features overview)](https://code.claude.com/docs/en/features-overview) · [Claude Code — Skills](https://code.claude.com/docs/en/skills) · [Anthropic — Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) · [Claude Code — Hooks guide](https://code.claude.com/docs/en/hooks-guide) · [Claude Code — Best practices](https://code.claude.com/docs/en/best-practices) · [Claude Code — MCP](https://code.claude.com/docs/en/mcp) · [Claude Code — Manage costs (prefer CLI tools)](https://code.claude.com/docs/en/costs) · [Claude Code — Subagents](https://code.claude.com/docs/en/sub-agents) · [Claude Code — Plugins](https://code.claude.com/docs/en/plugins/overview) · [Claude Code — GitHub Actions](https://code.claude.com/docs/en/github-actions) · [Claude Code — Code Review](https://code.claude.com/docs/en/code-review) · [GitHub Docs — About Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)
