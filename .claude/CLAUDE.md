# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This folder is the owner's AI engineering study journal, preparing for an AI / ML Engineer interview. [goal.md](../goal.md) defines what the study must achieve: goals G1–G7, the capstone project, and the interview readiness checklist. Every topic traces back to one goal.

## Succinct and effective — above all

Every text I write — replies, docs, topic pages, commit messages — uses the fewest words that land the point for its reader. Lead with the point. Cut every sentence the reader can do without, never the fact they need: on a study page, each term opens with its definition, then an example; the example never stands in for the definition. Then answer the reader's next question. Full rules in [doc-writer](skills/doc-writer/SKILL.md).

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

- Notes and code under `goals/`, and the capstone project, belong to the owner. Write or change them only when asked.
- `goal.md` is the owner's roadmap. Tick a checkbox or change a goal only when asked.
- The README describes the journal to visitors. How-to and technical detail live here.
- Claude-related files live in `.claude/`, never at the folder root.

## Content model

The site is an Astro journal with animated explainers, ported from learnleetcode. Each goal in `goal.md` has a page, and each of its levels (see `plan.md`) is a sub-page: `/g1-database-architecture/l1/`.

```
goals/g1-database-architecture/
  index.md                    goal page — frontmatter: title, description?
  l1/                         level page, L1–L3
    index.md                  frontmatter: description?; body: the owner's notes
    1-relational-modeling.md  one section per goal.md checkbox — frontmatter: title
    1-relational-modeling.tsx the section's explainer (optional)
    7-vector-search.1-hnsw.tsx  one of several explainers, shown in file-name order
  hnsw.tsx                    code shared by explainers on several levels
  l2/                         a level folder renders once it has an index.md
    …
```

- A section file is `<item-number>-<item-slug>.md`; the number makes its label (G1.1) and the slug its anchor (`#relational-modeling`). The slugs are the ones in `plan.md`.
- An explainer default-exports `defineExplainer({...})` from `src/explainer/types.ts`: examples, input fields and parsing, the step list, and one `Scene` per stage, drawn from the building blocks in `src/explainer/scene.tsx`. A scene is a pure function of `input` and `step`; moving a block between steps animates it. `goals/g1-database-architecture/l1/2-indexing.tsx` is the reference.
- Use an explainer for a point that needs motion to land, a static diagram for a structure, and text for the rest. A diagram is inline SVG in the section's Markdown, styled by the `.diagram` classes in `src/components/Sections.astro` so it follows the theme; `4-oltp-olap.md` is the reference.
- Any other file in a level folder (`schema.sql`, `demo.py`) renders as highlighted code after the sections.

A level page reads: level tabs, contents, sections, code, notes.

## Development

- `npm run dev` serves at `localhost:4321/ai/`. Start it with `astro dev --background`, and manage it with `astro dev stop|status|logs`.
- `npm run build` writes to `dist/`. Internal links go through `url()` from `src/lib/url.ts`, which adds the base path.
- The base path `/ai` in `astro.config.mjs` must match the GitHub repository name once it is published to Pages.
- Docs: https://docs.astro.build

## Commit convention

Commits follow [Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<scope>): short imperative summary

<optional body>
```

- **type** — `feat`, `fix`, `docs`, `refactor`, `chore` (add others as needed).
- **scope** — optional area: `goal` (goal.md, plan.md), `goals` (the pages), `site`, `capstone`.
- Prefer **atomic commits** (one logical change); a new level page is one commit.

Example:

```
feat(goals): add g1 l1 database surface
```

**Committing is a manual, deliberate step.** Do not auto-commit or install commit hooks; only commit when the user asks, keeping diffs easy to review.

**The index belongs to the user.** Staging is how they mark work as reviewed, so they are the only one who moves it — in either direction. Never stage (`git add`), and never unstage (`git reset`, `git restore --staged`, `git stash`). To commit, name the paths (`git commit <paths> -m …`), which writes those files and leaves the rest of the index where it stands. Untracked files can't be committed by path; the user stages them.

**Pushing and deploying are the user's.** `git push` and any deploy publish to GitHub; the user runs them.
