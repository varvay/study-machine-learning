---
name: code-writer
description: The house style for writing and editing source code in this repo — names, types, and structure carry the meaning, so comments stay a last resort. Covers the Astro site and explainers; code under goals/ and the capstone is the owner's own.
---

# Writing code

Code communicates through three things: its **names**, its **types**, and its **structure**. A reader — human or compiler — should grasp intent from those alone, without comments narrating it. When a piece of code is hard to read, the fix is almost always a better name, a clearer type, or a different shape — not a comment.

## Study code is the owner's

Code under `goals/` and the capstone project is the owner's study work, in the owner's style. Write or edit them only when asked, and then keep their style.

## Names carry the meaning

- Spell words out. `validateAmount`, not `valAmt`; `monthlyMin`, not `cap1`. A reader must never have to decode an abbreviation.
- Let names encode the relationships. `monthlyMin / monthlyMax / dailyMin / dailyMax` tells you which values pair and which bound which; `cap1..cap4` hides all of it and forces a comment to recover it.
- Name a thing for what it *is*, not for how one call site happens to use it.

## Types document themselves

A structural type with bare fields forces the reader to guess, then invites a comment. Name the type and its members instead — zero runtime cost, and the compiler now guards the meaning.

```ts
// AVOID — what goes in `value`? are these names, ids, coordinates?
type Value = string | { source: string; destination: string };

// PREFER — the names answer both questions on their own
type TextLabel = string;
type DataMappingLabel = { sourceId: string; destinationId: string };
type Label = TextLabel | DataMappingLabel;
```

Naming each case of a union also makes the union legible at a glance — you read the alternatives, not decode them.

## Structure carries the meaning

How code is decomposed is as much a readability decision as what it's named. Shape it so a reader can understand a piece at one level of abstraction and descend into detail only when they choose to.

- Split a long function the moment a block earns a name. A well-named function *is* documentation — and unlike a comment, the compiler keeps its signature honest.
- Inline what is trivial and used once; extract what carries a concept, is reused, or hides detail the caller shouldn't care about. Don't extract a clear one-liner just to give it a name.
- Keep each function at a single level of abstraction — one that orchestrates named steps shouldn't also carry the fiddly detail of any one step.
- Prefer guard clauses and early returns over nesting; the happy path should read top-to-bottom without deep indentation.

## State has one owner

Never write into a parameter — a caller has no sign its argument comes back changed. Mutate your own fields, or return what changed. Same for a caller's array or map: copy before `push`/`sort`/`splice`.

The exception is a pass whose job *is* editing in place, and its name says so.

## Comments are a liability, not documentation

Comments are not compiled, so nothing keeps them true. As code changes they drift out of sync, and a stale comment misleads worse than none. Almost every comment is a naming, typing, or structure problem in disguise — fix that instead.

- Don't restate what the code shows, don't record where code came from, don't narrate the next line, don't justify why a change is correct.
- Reserve a comment for a constraint the code genuinely cannot express — an external invariant, a non-obvious *why*. If you're explaining *what*, rename or restructure.
- Before writing a file, delete the comments from the draft and fix what each was compensating for.

## When uncertain, ask

Self-explanatory code assumes you know what to express. When you don't — a name, type, shape, or interface has more than one reasonable form and the right one turns on knowledge you're missing — ask rather than guess. This is for genuine forks only: when there's an obvious default, take it and move on.
