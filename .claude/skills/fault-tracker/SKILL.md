---
name: fault-tracker
description: The record of mistakes already made in this repo, and how to add to it. Load at the start of every session to read the faults before working, and whenever a new fault happens — the user corrects you, or you catch yourself.
---

# The fault tracker

A fault is a mistake that **cost the user something** and a rule should have prevented. The record exists so the same hole is fallen into once.

One file, [.faults.md](./.faults.md): a header carrying the counts, the recurring roots and the **Next ID**, then one bullet per fault. Nothing parses it — it is written to be read, so it is prose, not a record format.

## Read it before you work

Read `.faults.md` at the start of every session, before touching anything. Read the **triggers**: a fault is done and unrepeatable, while its trigger is the situation that recurs, and catching that mid-approach is the whole point.

## Short, or it goes unread

**You will optimise your own reading.** A long record gets skimmed, a skimmed record is no record, and the guard you skimmed past is the one you break. Length is the failure mode here — not missing detail.

- **400 characters of prose per entry**, summing the field values. That is the ceiling and the only measure; over it, cut — never spill into a second entry.
- **No clause that explains the clause before it.** Restating, justifying, and narrating are what bloat an entry. Two terse facts joined by a semicolon are fine; one fact told twice is not.
- **Cut the narrative, never the guard.** What happened belongs to the session it happened in; what survives is the trigger to recognise and the act to refuse.
- **When the file stops being readable in one pass**, raise the recurring roots with the user. Appending quietly past that point is how the record dies.

```sh
awk '/^- \*\*FLT-/{if(id)print id,n; id=$2; gsub(/\*/,"",id); n=0; next} /^  - /{n+=length($0)-8} END{print id,n}' .claude/skills/fault-tracker/.faults.md
```

## What is a fault, and what is not

A fault is yours and it cost them: work destroyed, a rule broken, a claim made that was untrue, a scope silently narrowed.

Not a fault: a judgement call they decided differently, a design they changed their mind about, a limitation you disclosed up front. Those are the work. Padding the record with them buries the entries that matter.

## Record it when it happens

The moment a fault lands — they correct you, or you catch yourself — write it. Waiting for the end of the session is how it gets lost.

**Increment, never duplicate.** Match a new fault to the existing entries by its **guard**, not its surface: a different command through the same hole is the same fault, so bump its `×N` and date. A new entry is for a hole the record does not yet name.

## The record shape

```markdown
- **FLT-NN** · catastrophic|major|minor · ×1 · YYYY-MM-DD
  - **Did** — …
  - **Trigger** — …
  - **Cost** — …
  - **Guard** — …
```

- **Did** — the failure in its general form: what kind of act, over what kind of thing. A particular — a command, a filename, the exact wording — earns its place only where it is what makes the class recognisable. *A formatter pointed at a whole package, rewriting work outside the edit* still reads a year on; the command line and the file count are that afternoon's story. The act, not the excuse, and the class, not the incident.
- **Trigger** — what you were trying to achieve, and what made the wrong move look reasonable. **The field that earns the record its keep**: "I was careless" teaches nothing, "I wanted a before/after comparison" is recognisable while it happens again.
- **Cost** — what it cost *them*, concretely.
- **Guard** — the checkable rule that prevents it. Name the act to refuse; "be careful" is not a guard.
- The date is when it first happened; `×N` is the occurrence count. **Severity** is `catastrophic` (work destroyed), `major` (their state altered without consent, recoverable), or `minor` (caught before it cost anything).

The **root** — the misconception underneath — lives in the header rather than on each entry, so two faults sharing one say it once. The id is opaque and permanent, from the header's **Next ID**. One physical line per bullet, no hard wrap.

## Then update the header

The counts, the roots tally, the next id, and today's date. A root reaching three occurrences is a standing pattern to raise, not just log.

## Never trim

Append-only. An old fault stays after it stops recurring — that it stopped is the evidence the guard works. Edit an entry to sharpen it — a truer general form, a tighter trigger or guard — never to soften what happened.
