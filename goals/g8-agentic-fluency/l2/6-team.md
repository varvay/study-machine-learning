---
title: MCP, skills, hooks, and CI
---

L1 matched each need to an extension point: CLAUDE.md for facts, skills for procedures, hooks for what must always happen, MCP for outside systems, subagents for side tasks, and plugins to share them (G8.6 L1). Here each one is built for the capstone. CLAUDE.md is in G8.2 L2 and subagents in G8.3 L2.

**MCP servers.** `claude mcp add` connects a server. Two from the docs, one remote over HTTP and one local process that talks over stdio (its standard input and output; G5.4 L2):

```bash
claude mcp add --transport http github https://api.githubcopilot.com/mcp/ \
  --header "Authorization: Bearer YOUR_GITHUB_PAT"

claude mcp add --env AIRTABLE_API_KEY=YOUR_KEY --transport stdio airtable \
  -- npx -y airtable-mcp-server
```

| Scope | Loads in | Shared with the team | Stored in |
|---|---|---|---|
| `local` (the default) | this project | no | `~/.claude.json` |
| `project` | this project | yes, through git | `.mcp.json` in the project root |
| `user` | all your projects | no | `~/.claude.json` |

A shared server goes in `.mcp.json`:

```json
{
  "mcpServers": {
    "shared-server": { "type": "http", "url": "https://example.com/mcp" }
  }
}
```

`/mcp` lists servers and their status, and disables the ones you are not using. Only tool names enter the context at start; Claude loads a tool's full definition through tool search when it needs it. The docs' warning: "Verify you trust each server before connecting it. Servers that fetch external content can expose you to prompt injection risk" (G8.5 L3).

**A skill.** A skill is a folder under `.claude/skills/` (or `~/.claude/skills/` for you alone) holding a `SKILL.md`: frontmatter (a YAML metadata block between `---` lines at the top), then instructions in Markdown. The capstone's schema changes follow one procedure, so it becomes a skill:

````markdown
---
name: new-migration
description: Writes a new Flyway migration for a schema change. Use when a task adds or changes tables, columns, indexes, or the embedding column.
allowed-tools: Bash(./mvnw verify *)
---

## Existing migrations

!`ls db/migration`

## Steps

1. Name the file `V<next number>__<what_changes>.sql`, one number above the highest above.
2. Never edit an existing migration.
3. Index a new `vector` column with HNSW and `vector_cosine_ops` (G1.7).
4. Run `./mvnw verify` and show the output.
````

- **`description`** — what the skill does and when to use it. Claude reads only this line at session start and decides from it whether to load the rest, so it names the triggers.
- **`` !`command` ``** — runs before Claude sees the skill and puts the output in its place, so the skill arrives with current data: here, the existing migration files.
- **`allowed-tools`** — tools pre-approved while the skill is active.
- Other fields: `disable-model-invocation: true` (only you can start it, with `/new-migration`), `context: fork` (run it in a subagent), `model` and `effort` (override them while it runs), `paths` (load it automatically only for matching files).

Skill descriptions share a budget of about 1% of the context window; when a project has many skills, some descriptions are cut short.

**Hooks.** A hook is configured under `hooks` in a settings file, with an event and a `matcher` that picks the tools it applies to. Claude Code passes the event's details to the command as JSON on standard input, and the command's exit code is its answer: **0** lets the action go ahead; **2** blocks it, and what the script wrote to stderr goes to Claude, so it can adjust. The main events:

| Event | When | What exit code 2 does |
|---|---|---|
| `SessionStart` | a session starts or resumes | shows the message to you; the session goes on |
| `UserPromptSubmit` | before Claude reads your prompt | blocks the prompt |
| `PreToolUse` | before a tool call runs | blocks the tool call |
| `PostToolUse` | after a tool call succeeds | shows the message to Claude; the tool already ran |
| `Stop` | Claude finishes its reply | keeps Claude working |
| `PreCompact` | before compaction | blocks compaction |

The docs' formatter hook runs Prettier, a code formatter, on every file Claude edits; `jq`, a command-line JSON tool, pulls the file path out of the event. In a Java project, swap in your formatter:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "jq -r '.tool_input.file_path' | xargs npx prettier --write" }
        ]
      }
    ]
  }
}
```

A guard hook turns the CLAUDE.md rule "never edit an applied migration" (G8.2 L2) into one that holds every time:

```bash
#!/bin/bash
# .claude/hooks/protect-migrations.sh
FILE_PATH=$(jq -r '.tool_input.file_path // empty')
case "$FILE_PATH" in
  */db/migration/V*.sql)
    if git ls-files --error-unmatch "$FILE_PATH" >/dev/null 2>&1; then
      echo "Blocked: $FILE_PATH is committed. Write a new migration instead." >&2
      exit 2
    fi ;;
esac
exit 0
```

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect-migrations.sh" }
        ]
      }
    ]
  }
}
```

`/hooks` lists the hooks in effect. A hook runs with your full permissions, outside the sandbox, so review a repository's hooks before you trust it.

**Plugins.** A plugin bundles skills, hooks, subagents, and MCP servers under one manifest, `plugin.json`. `/plugin` browses marketplaces and installs from them; a plugin's skill runs as `/plugin-name:skill-name`.

**GitHub Actions.** `/install-github-app` in Claude Code installs the Claude GitHub App, stores the key as a repository secret, and opens a pull request with the workflow. The workflow that answers `@claude` in comments, from the docs:

```yaml
name: Claude Code
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
jobs:
  claude:
    if: contains(github.event.comment.body, '@claude')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
      id-token: write
      actions: read
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 1
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

- **Two modes** — with no `prompt` input the action waits for `@claude`; with a `prompt`, it runs on the event itself, such as every opened pull request or a nightly schedule.
- **`claude_args`** — passes command-line flags, such as `--max-turns 5` or `--allowedTools`. In a scheduled run with a plain prompt, Claude has no shell or GitHub access until a flag or rule grants it.
- **Who can trigger it** — on issue and pull request events, only users with write access to the repository; bots are refused unless listed in `allowed_bots`.
- **Cost** — GitHub Actions minutes plus tokens. A concise CLAUDE.md, `--max-turns`, and a workflow timeout keep both down.

Sources: [Claude Code — MCP](https://code.claude.com/docs/en/mcp) · [Claude Code — Skills](https://code.claude.com/docs/en/skills) · [Claude Code — Hooks guide](https://code.claude.com/docs/en/hooks-guide) · [Claude Code — Hooks reference](https://code.claude.com/docs/en/hooks) · [Claude Code — Plugins](https://code.claude.com/docs/en/plugins/overview) · [Claude Code — GitHub Actions](https://code.claude.com/docs/en/github-actions) · [Claude Code — Manage costs](https://code.claude.com/docs/en/costs)
