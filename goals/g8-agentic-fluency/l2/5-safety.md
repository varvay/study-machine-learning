---
title: Permissions, sandboxes, and data terms
---

L1 listed the risks and the controls in the order you meet them: a permission mode, rules, a sandbox, and review (G8.5 L1). Here each control is set up in Claude Code.

**Permission modes.** A mode sets what runs without asking you. From the docs:

| Mode | Runs without asking | For |
|---|---|---|
| `default` (Manual) | reads only | reviewing every action yourself; sensitive work |
| `acceptEdits` | reads, file edits, and common file commands (`mkdir`, `touch`, `mv`, `cp`) | iterating on code you are reviewing |
| `plan` | reads, plus commands the classifier approves when auto mode is available | exploring before changing anything |
| `auto` | everything, with a second model, the **classifier**, reviewing each action in your place | long tasks; fewer prompts |
| `dontAsk` | reads and pre-approved tools; anything that would ask is denied | locked-down CI and scripts |
| `bypassPermissions` | everything | "isolated containers and VMs only" |

Shift+Tab cycles the modes; `--permission-mode` picks one at start; `permissions.defaultMode` in a settings file sets the starting mode. From version 2.1.283, `auto` is the starting mode in the terminal and VS Code. A project's settings file cannot set `auto` or `bypassPermissions`, so a cloned repository cannot turn its own guard off.

**Rules.** Rules in a settings file pre-approve or block named tools, commands, and paths, on top of the mode:

```json
{
  "permissions": {
    "allow": ["Bash(./mvnw test *)", "Bash(git diff *)", "WebFetch(domain:docs.spring.io)"],
    "ask":   ["Bash(git commit *)", "Bash(git push *)"],
    "deny":  ["Read(./.env)", "Read(./secrets/**)", "Bash(rm -rf *)", "Bash(curl *)"]
  }
}
```

- **Order.** "Rules are evaluated in order: deny, then ask, then allow. The first match in that order determines the outcome."
- **Modes.** "Deny rules block in every mode, including `bypassPermissions`." Allow rules have no effect in `bypassPermissions`.
- **Files.** Settings come from, highest first: managed settings (the organization's), `--settings` on the command line, `.claude/settings.local.json` (yours, uncommitted), `.claude/settings.json` (the team's, committed), and `~/.claude/settings.json` (yours, every project). Rule lists from different files are combined, so each file can add rules without removing another's.
- **Limits.** The docs warn that "Bash permission patterns that try to constrain command arguments are fragile": `Bash(curl http://github.com/ *)` misses other spellings of the same request. To control the network, deny `curl` and `wget`, allow the WebFetch tool per domain, and add the sandbox.

This journal's own `.claude/settings.json` denies `git push`, `rm -rf`, `git reset --hard`, and history rewrites, and asks before `git commit`, `git reset`, `git restore`, `git stash`, and the other commands that rewrite the index or the working files.

**The sandbox.** The Bash sandbox is an operating-system boundary around every shell command Claude runs. Turn it on with `/sandbox`, or `"sandbox": {"enabled": true}` in settings.

- **Mechanism** — Seatbelt, macOS's built-in sandbox, on macOS; bubblewrap, a Linux sandboxing tool, on Linux and WSL2; native Windows has none.
- **Files** — commands write only inside the working folder and the temp folder.
- **Network** — traffic goes through a local proxy whose list of allowed hosts starts empty; it refuses names that resolve to local or cloud-metadata addresses, such as `169.254.169.254`.
- **Scope** — Bash only. The file tools, MCP servers, and hooks run outside it.
- **Hardening** — `allowUnsandboxedCommands: false` removes the escape hatch that retries a blocked command outside the sandbox; `failIfUnavailable` makes Claude Code exit when the sandbox cannot start.

Anthropic reports that sandboxing "reduces permission prompts by 84%". For fewer prompts without the classifier, the docs pair Manual mode with the sandbox in auto-allow mode, where sandboxed commands run without asking and deny rules still apply.

**Containers.** For unattended runs with `--dangerously-skip-permissions` (the flag for `bypassPermissions`), the docs require a container, a VM, or the sandbox runtime, run as a non-root user. Anthropic's reference dev container (a Docker image with the project's tools, used as the development environment) adds a firewall that allows only listed hosts. The docs still warn that inside it a malicious project can send out anything the container holds, Claude's credentials included.

**Secrets.** Keep them out of the agent's reach, so they never enter the context:

- deny reads of `.env` and secret folders (above);
- inject secrets at run time from a vault or environment variables, never from files in the repository;
- never paste a key into the prompt.

Claude Code keeps session transcripts in plain text under `~/.claude/projects/` and deletes them after 30 days (`cleanupPeriodDays`).

**Read before you approve.** A permission prompt shows the exact command. For Bash, "Yes, and don't ask again" saves a rule for that command in this repository for good, so read what you are allowing. When you approve the same safe command for the tenth time, make it an allow rule, so the prompts that remain are the ones worth reading.

**Data terms.**

| Plan | Trains models on your code? | Retention |
|---|---|---|
| Anthropic commercial: Team, Enterprise, API | no, unless the customer opts in, such as through the Development Partner Program | 30 days; transcripts sent with `/feedback` or `/bug` kept 5 years |
| Anthropic commercial with zero data retention | no | not stored after the response, except data flagged for policy violations (up to 2 years); for qualified Enterprise accounts; switches off cloud sessions and Remote Control |
| Anthropic consumer: Free, Pro, Max | the user chooses (since September 2025) | 5 years if training is on, 30 days if off |
| GitHub Copilot Business, Enterprise (for comparison) | no | prompts in the IDE not kept; 28 days on web, mobile, and CLI |

For client code, a commercial plan is the baseline; a personal Pro account on a client's repository puts that choice in one developer's settings.

**Transparency.** The 4D framework's Diligence includes being open about AI's role. Claude Code adds a `Co-Authored-By` trailer to its commits and an attribution line to its pull requests by default; the `attribution` setting changes or removes them.

Sources: [Claude Code — Permission modes](https://code.claude.com/docs/en/permission-modes) · [Claude Code — Configure permissions](https://code.claude.com/docs/en/permissions) · [Claude Code — Settings files and precedence](https://code.claude.com/docs/en/settings) · [Claude Code — Settings reference (attribution, cleanupPeriodDays)](https://code.claude.com/docs/en/settings-reference) · [Claude Code — Sandboxing](https://code.claude.com/docs/en/sandboxing) · [Anthropic — Making Claude Code more secure and autonomous with sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing) · [Claude Code — Development containers](https://code.claude.com/docs/en/devcontainer) · [Claude Code — Data usage](https://code.claude.com/docs/en/data-usage) · [Claude Code — Zero data retention](https://code.claude.com/docs/en/zero-data-retention) · [Anthropic — Updates to consumer terms](https://www.anthropic.com/news/updates-to-our-consumer-terms) · [GitHub Copilot — Plans and privacy](https://github.com/features/copilot)
