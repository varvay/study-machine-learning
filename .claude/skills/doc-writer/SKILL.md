---
name: doc-writer
description: House style for prose in this repo — the README, .claude/ files, and any page copy. Load when creating or editing any of them. Core rules — describe the current state, not the journey to it, and say it in as few words as carry the fact — plus the repo's lean / no-hard-wrap conventions. Pages under goals/ and goal.md are the owner's own.
---

# Writing docs in this repo

A doc describes **the current state, present-tense, as if it always was.** It is not a changelog or a record of how the design was reached. The reader does not know what you explored and set aside — so don't reference it.

Pages under `goals/` and the roadmap in `goal.md` are the owner's study writing, in the owner's voice. Write or edit them only when asked.

## Describe the state, not the journey

Cut any phrasing that only makes sense as a contrast to a road not taken, or to a previous version:

- ✗ "instead of X, we do Y" / "rather than X" / "X buys nothing"
- ✗ "there is no X" — where X is an alternative the project never had
- ✗ "was X, now Y" / "we moved from X to Y" / "no longer …"
- ✗ negations that only mean something against a thing you removed
- ✗ meta-commentary about the doc or the work ("this section captures…")

Write what the thing **is**, once, declaratively.

**The test:** read each sentence and ask *"would this make sense to someone who never saw our exploration?"* If it only lands as a contrast to something considered-and-dropped, cut it.

## Still allowed

- **Status / scope metadata** — "not yet implemented", "deferred", a **Known gaps** list. These describe the present state, not the path to it.
- **Standing rules**, framed as forward guidance ("do X; the smell that you aren't is Y") — not as a history of past mistakes.

## Say it short

**Verbose is not clear.** A point circled three times leaves the reader assembling it; one direct sentence hands it over. Every clause costs the reader time and earns it or goes.

- **State the design; don't argue it.**
- **Stop at the rule.** What a reader derives from a rule already stated needs no sentence of its own.
- **One claim per sentence.** A clause restating the last one in fresh words is a cut, not an emphasis.
- **Trim the frame.** Lead-ins, summarising tails, and a body that repeats its own bold lead all go.

**The test:** halve the paragraph and read what is lost. Usually nothing.

## Write it plain

**Plain words, short sentences.** Use the shortest ordinary words that carry the fact — no metaphor, no inversion, no cadence for its own sake. Every fact still has to land.

- Verbs, not noun-stacks. Two short sentences beat one dense clause.
- Never define a word with itself.
- Contrast two things that both exist. A contrast with nothing invents a state the reader then looks for.
- Say each fact once, and decide which sentence owns it; a bullet's body never restates its own label.
- Match the shape of the neighbouring sentences and bullets, and count what you claim.

## Lean & format (repo conventions)

- **No redundancy.** Don't restate what the code or another doc already says; state each fact once.
- **No hard-wrap.** One physical line per paragraph and per bullet — let the editor soft-wrap.
- **Cross-link sparingly** — only the links that earn their place.
- **README is for visitors** — it describes the journal, never how to run or build it. That lives in `.claude/CLAUDE.md`.
