# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This folder is the owner's AI engineering study journal, preparing for an AI / ML Engineer interview. [goal.md](../goal.md) defines what the study must achieve: goals G1–G7, the capstone project, and the interview readiness checklist. Every topic traces back to one goal.

## Succinct and effective — above all

Every text I write — replies, docs, topic pages, commit messages — uses the fewest words that land the point for its reader. Lead with the point. Cut every sentence the reader can do without. Full rules in [doc-writer](skills/doc-writer/SKILL.md).

## Faults — read these before anything else

**[.claude/skills/fault-tracker/.faults.md](skills/fault-tracker/.faults.md) holds every mistake already made in the owner's repos.** Read it at the start of every session, before touching the repo. Read each entry's **trigger** — the fault itself is done and unrepeatable, while the situation that produced it is what comes round again, and recognising it in the moment is the only thing that stops a repeat.

When a fault lands — the user corrects you, or you catch yourself — record it immediately through the [fault-tracker](skills/fault-tracker/SKILL.md) skill: a new entry, or the occurrence count bumped on the entry whose **guard** it already broke.

## Skills — load them all at the start

**Load every skill in [.claude/skills](skills/) before the work.** A skill reached for once the draft exists is reached for too late — the style it governs is already set. They carry the house style for source ([code-writer](skills/code-writer/SKILL.md)), prose ([doc-writer](skills/doc-writer/SKILL.md)), commit messages ([commit-writer](skills/commit-writer/SKILL.md)), and the fault record above ([fault-tracker](skills/fault-tracker/SKILL.md)).

## Working style

- **Read to the end.** Act on a document or an instruction only once its last line is read — the clause that qualifies the first half sits in the second, so a part-read is a misread.
- **Narrate commands.** Before running a shell command, announce it in the format `{main operation} [read-only|write] — {explanation}` (e.g. `git commit [write] — commit the new topic`). Keep the operation a short label, not the whole command.
- **Let the code speak.** Names, types, and structure carry the meaning; a comment is a last resort for a constraint they cannot express. Full rule in [code-writer](skills/code-writer/SKILL.md).
- **Define by what a thing is** — no apophasis, no litotes. A negative definition hands the reader's focus to what was denied, and loosens the rule the moment a new case appears.
- **Don't hard-wrap docs.** Write each paragraph and bullet as one physical line and let the editor soft-wrap — no manual line breaks mid-sentence.
- **Cite the outside world.** A claim about a model, library, cloud service, or paper carries a source or the word unsourced in the same sentence — this field moves fast, and interview answers built on a stale fact cost the owner.

## The journal is the owner's

- Notes and code under `topics/`, and the capstone project, are written by the owner. Write or change them only when asked.
- `goal.md` is the owner's roadmap. Tick a checkbox or change a goal only when asked.
- The README describes the journal to visitors. How-to and technical detail live here.
- Claude-related files live in `.claude/`, never at the folder root.

## Adding a topic

The site is not yet built. It follows learnleetcode's page model ([../programming/learnleetcode](../../programming/learnleetcode/)): notes plus animated explainers, built with Astro and React. When the site is set up, port its explainer engine (`src/explainer/`), page components, and UI spec (`docs/ui-design.html`), then replace this paragraph with the real paths and dev commands.

Create `topics/<goal>-<slug>/`, e.g. `topics/g1-vector-search/`:

- `index.md` — frontmatter (including an optional `description`) and notes.
- `explainer.tsx` (optional) — the animated walkthrough, a React island. It default-exports `defineExplainer({...})`: examples, input fields and parsing, the step list, and one `Scene` component per stage, drawn only from the shared scene building blocks. A scene is a pure function of `input` and `step`; moving a block between steps animates it.
- `approach-*.md` and `approach-*.tsx` (optional) — the reasoning that builds up to the concept, shown under **How to get there** in file-name order (`approach-1-intuition.md`, `approach-2-brute-force.tsx`, …). An `.md` file is a text box: frontmatter `title`, then Markdown. A `.tsx` file is an explainer. Use an explainer for a point that needs motion to land, and text for the rest.
- every other file in the folder (`demo.py`, `schema.sql`, …) renders on the page as highlighted code.

A topic page reads top to bottom: description, how to get there, explainer, code, notes.

```md
---
title: Vector Search
goal: G1                  # G1..G7 from goal.md
tags: [database, vector-db]
studied: 2026-10-01
description: How ANN indexes trade recall for latency   # optional
---
```

## Commit convention

Commits follow [Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<scope>): short imperative summary

<optional body>
```

- **type** — `feat`, `fix`, `docs`, `refactor`, `chore` (add others as needed).
- **scope** — optional area: `topics`, `goal`, `capstone`, `site`.
- Prefer **atomic commits** (one logical change); a new topic is one commit.

Example:

```
feat(topics): add g1 vector search
```

**Committing is a manual, deliberate step.** Do not auto-commit or install commit hooks; only commit when the user asks, keeping diffs easy to review.

**The index belongs to the user.** Staging is how they mark work as reviewed, so they are the only one who moves it — in either direction. Never stage (`git add`), and never unstage (`git reset`, `git restore --staged`, `git stash`). To commit, name the paths (`git commit <paths> -m …`), which writes those files and leaves the rest of the index where it stands. Untracked files can't be committed by path; the user stages them.

**Pushing and deploying are the user's.** `git push` and any deploy publish to GitHub; the user runs them.
