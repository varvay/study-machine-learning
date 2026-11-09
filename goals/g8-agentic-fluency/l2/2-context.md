---
title: Writing instructions and tasks
---

L1 named the four inputs you control: the task, the project instructions, reference files, and a definition of done (G8.2 L1). Here each one is written for Claude Code.

**Where CLAUDE.md files live.** Claude Code loads them in this order, broadest first, so a project instruction comes after a user one:

| Scope | Location | For | Shared with |
|---|---|---|---|
| Managed policy | `/Library/Application Support/ClaudeCode/CLAUDE.md` (macOS), `/etc/claude-code/CLAUDE.md` (Linux) | company standards, security rules | everyone in the organization |
| User | `~/.claude/CLAUDE.md` | your preferences in every project | you |
| Project | `./CLAUDE.md` or `./.claude/CLAUDE.md` | build commands, conventions, layout | the team, through git |
| Local | `./CLAUDE.local.md`, listed in `.gitignore` | your sandbox URLs, test data | you, in this project |

- **Folders.** CLAUDE.md files in the folders above the working folder load at launch; one in a subfolder loads when Claude reads a file there.
- **Imports.** `@path/to/file.md` inside a CLAUDE.md pulls that file in, up to four levels deep. An import organizes a long file without shrinking it: imported files load at launch too.
- **Rules.** Markdown files in `.claude/rules/` with a `paths` pattern in their frontmatter load only when Claude works on matching files, such as `src/api/**`.
- **AGENTS.md.** In a repository with no CLAUDE.md, Claude Code reads `AGENTS.md` (version 2.1.277 or later). To keep one file for every agent and add Claude-only notes, put `@AGENTS.md` at the top of a CLAUDE.md.
- **`/init`** reads the codebase and writes a first CLAUDE.md, or suggests improvements to an existing one.
- **Auto memory.** Claude also writes its own notes, `MEMORY.md`, from your corrections; the first 200 lines or 25 KB load every session. You write CLAUDE.md; Claude writes auto memory. Read it now and then, since it steers every session.

**What goes in.** The docs list: commands Claude cannot guess, code style that differs from the defaults, how to run the tests, branch and pull request conventions, architecture decisions, environment quirks, and common gotchas. What stays out: anything Claude would do anyway, full API documentation (link to it), and long tutorials. Add a line when Claude makes the same mistake twice, or when a review catches something it should have known. The docs' test for every line: "Would removing this cause Claude to make mistakes? If not, cut it." Target under 200 lines, because "longer files consume more context and reduce adherence". A procedure that only some tasks need belongs in a skill (G8.6 L2).

A project CLAUDE.md for the capstone:

```markdown
# Document assistant (capstone)

Spring Boot 4, Spring AI 2.0, PostgreSQL with pgvector.

## Commands
- Build and test: `./mvnw verify`
- One test class: `./mvnw test -Dtest=DocumentControllerTest`
- Local database: `docker compose up -d db`

## Layout
- `api/` REST controllers; `rag/` retrieval and advisors; `db/migration/` Flyway SQL
- Schema: see `db/migration/V1__init.sql` before writing any query

## Rules
- Every schema change is a new Flyway migration; never edit an applied one.
- Embeddings are `vector(1024)`; query with `<=>` (cosine distance).
- Ask before adding a dependency.
- Never commit secrets; config comes from environment variables.
- Done means `./mvnw verify` passes. Show its output.

# Compact instructions
Keep the current plan, failing test names, and files changed.
```

**The task.** A task Claude can finish alone states four things:

```text
Goal: GET /documents returns at most 50 items, with a cursor for the next page.
Where: api/DocumentController.java; follow the paging in api/ChunkController.java.
Constraints: no new dependencies; keep the existing response fields.
Done when: a new test in DocumentControllerTest covers the first page, the last page,
and an invalid cursor, and ./mvnw verify passes.
```

For a larger feature, the docs suggest letting Claude ask the questions first: have it interview you about the feature, then "write a complete spec to SPEC.md", and carry the spec out in a fresh session, so the interview does not fill the context of the work.

**Reference files and data.** `@path` adds a file to the prompt; a pasted screenshot gives Claude a design to match; piped input works in scripts: `cat build.log | claude -p "find the root cause"`.

**Keeping the context lean.**

- **One task per session.** `/clear` between unrelated tasks; `/rename` first if you want to come back with `/resume`.
- **Search in a subagent.** Broad exploration ("find every place we call the embedding API") fills the main context with file contents; a subagent reads them in its own context and returns a summary (G8.3 L2).
- **CLI over MCP** where a command-line tool exists; `/mcp` disables servers you are not using.
- **Watch it.** `/context` shows what fills the window; the status line can show usage all the time.

Sources: [Claude Code — How Claude remembers your project (CLAUDE.md, rules, AGENTS.md, auto memory)](https://code.claude.com/docs/en/memory) · [Claude Code — Best practices](https://code.claude.com/docs/en/best-practices) · [Claude Code — Manage costs (compact instructions, context)](https://code.claude.com/docs/en/costs) · [Claude Code — Explore the context window](https://code.claude.com/docs/en/context-window)
