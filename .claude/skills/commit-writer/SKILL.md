---
name: commit-writer
description: House style for git commit messages in this repo. Load before writing a commit. Core rule — keep it concise: an imperative subject, and a short body only when the "why" isn't obvious from the subject and diff. The mechanical format (Conventional Commits, atomic commits, commit only when asked, never stage) lives in CLAUDE.md.
---

# Writing commit messages

The format and rules — [Conventional Commits](https://www.conventionalcommits.org), atomic commits, *commit only when asked, never auto-commit or add hooks*, and *never stage* — live in [CLAUDE.md](../../CLAUDE.md#commit-convention). This skill is the writing style on top.

## Keep it concise

The diff already shows *what* changed; the message says what the diff can't — the intent. Don't restate the diff, don't narrate the work.

- **Subject** — one imperative line, `type(scope): summary`, lowercase after the colon, no trailing period. Aim for ~50 characters. It should complete "this commit will …".
- **Body** — optional, and only when the *why* or a non-obvious consequence isn't already clear. A few short lines, not a paragraph per file. Nothing to add → omit it.
- **No journey.** State the change as it stands, not the path that produced it — "add X", not "tried Y, then switched to X". Same principle as [doc-writer](../doc-writer/SKILL.md).
- **No file inventory.** "update the topic page layout" beats listing each path; the diff has the paths.

## A long message is usually a commit that should split

Needing paragraphs, or an "and" in the subject, is the tell: prefer several atomic commits, each with a one-line subject, over one commit narrated at length.
