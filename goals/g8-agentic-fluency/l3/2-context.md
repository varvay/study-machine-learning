---
title: Instructions that hold
---

L2 wrote a CLAUDE.md and a task (G8.2 L2). This level is about why instructions get ignored, which rules belong in instructions and which in code, and how to keep context useful over a long session and over months.

**Why instructions get ignored.**

- **Count.** IFScale (2025) gave 20 models up to 500 simple instructions at once. "Even the best frontier models only achieve 68% accuracy at the max density of 500 instructions." The strongest reasoning models held near-perfect "through 150 or more instructions" and then declined; others declined steadily from the start. Under load, models more often dropped an instruction entirely than followed it wrongly.
- **Position.** Earlier instructions were followed more reliably than later ones, a bias that peaked around 150–200 instructions. Separately, models recall the middle of a long input worst (Liu et al., G8.1 L3).
- **Bloat.** The Claude Code docs: "Bloated CLAUDE.md files cause Claude to ignore your actual instructions!" Thoughtworks' Technology Radar (April 2026) lists **agent instruction bloat** under Caution: "Instructions become long and sometimes conflict with each other. Models tend to attend less to content buried in the middle."

So every line in an always-loaded file competes with every other line, and with the task. That is the reason for the 200-line target and the cut test in G8.2 L2.

**Advisory or enforced.** CLAUDE.md is context, and the docs are plain about it: Claude treats it "as context, not enforced configuration. To block an action regardless of what Claude decides, use a PreToolUse hook instead." Sort each rule by what breaking it costs:

| Rule | Where it belongs | Why |
|---|---|---|
| "Run `./mvnw verify` before saying done" | CLAUDE.md, plus a `Stop` hook that runs it | the hook makes it certain |
| "Never edit an applied migration" | a `PreToolUse` hook (G8.6 L2) | breaking it corrupts the database history |
| "Never push" | a deny rule (G8.5 L2) | deny rules hold in every mode |
| "Format with the project's formatter" | a `PostToolUse` hook | free to enforce, so never ask |
| "Prefer composition over inheritance" | CLAUDE.md | a judgement no script can check |
| "How to write a migration" | a skill | needed in some tasks only |

Birgitta Böckeler, on martinfowler.com, calls the whole setup a **harness** for the coding agent, built from **guides** that "steer it *before* it acts" and **sensors** that "observe *after* the agent acts and help it self-correct". Sensors come in two kinds: **computational** (tests, linters, type checkers: certain and cheap) and **inferential** (AI review, an LLM as judge: flexible and fallible). Put a rule in the most certain place that can check it.

**Rules that can be checked.** "Write clean code" gives Claude nothing to act on; "functions over 40 lines get split" does, and a linter can enforce it. A good rule names the situation and the act: "When adding an endpoint, add an integration test in `api/`." A rule Claude keeps breaking is either unclear, buried, or in conflict with another rule; check those three before writing it in capitals.

**A mistake log the agent reads at start.** This journal keeps one: a fault-tracker skill whose ledger, `.faults.md`, records every mistake an agent made in the owner's repositories, and CLAUDE.md tells Claude to read it before touching the repo. Each entry has four fields, and the one that does the work is the **trigger**: the situation that made the wrong move look reasonable, such as "wanting a before/after comparison of my own work". A fault is done and will not recur in the same form, but its trigger will, and recognising it in the moment is what stops the repeat. Each entry is capped at 400 characters, because a long log gets skimmed and a skimmed guard is broken. Claude Code's **auto memory** (G8.2 L2) is the built-in version of the idea: notes Claude writes itself from your corrections. Read it now and then; a wrong note steers every session.

**Instructions go stale.** An Anthropic engineer building agent harnesses: "Every component in a harness encodes an assumption about what the model can't do on its own… they can quickly go stale as models improve." A rule written to correct last year's model may now just cost tokens, or block a better approach. Anthropic's rollout guide says to treat CLAUDE.md changes like versioned documentation: review them in pull requests, date the reasons, and delete rules whose cause is gone.

**Conflicts.** User, project, local, and rule files all load together, broadest first, and Claude reconciles them by judgement. When two files disagree, say which wins in the more specific one, or remove one of them.

**Context over a long task.** A task longer than one context window needs a way to carry state forward. Anthropic describes three, from its post on context engineering:

- **Compaction** — summarize the conversation and continue in a fresh window. Cheap and automatic; details the summary drops are gone.
- **Structured notes** — "the agent regularly writes notes persisted to memory outside of the context window": a progress file, a task list, the plan. Claude reads them back when needed.
- **Sub-agents** — explore in separate contexts that return "a condensed, distilled summary of its work (often 1,000-2,000 tokens)".

For work spanning many sessions, Anthropic's harness for long-running agents starts each session from files, since "each new session begins with no memory of what came before": a feature list in JSON, a progress file, and git commits. Each session takes "only one feature at a time" and leaves notes for the next. A later Anthropic post found resets with handoff files worked better than compaction alone for a model that showed "context anxiety", rushing to finish as its window filled.

**In an interview**

- *Your agent keeps ignoring a rule in CLAUDE.md. What do you do?* First I check the file: is it long, does another rule contradict this one, is the rule buried in the middle? Instruction-following drops as the count grows, so I cut lines that no longer prevent a mistake. Then I ask whether the rule should be an instruction at all. Anything that must always hold becomes a hook or a permission rule, because CLAUDE.md is advisory and a hook is deterministic.
- *How do you keep an agent on track across a task that takes days?* State lives in files, not in the conversation: a plan, a feature checklist, a progress note, and small commits. Each session starts by reading them, works on one item, verifies it, and updates the notes. Compaction covers the gaps within a session; the files cover the gaps between sessions.

Sources: [Jaroslawicz et al., How many instructions can LLMs follow at once? (IFScale)](https://arxiv.org/abs/2507.11538) · [Liu et al., Lost in the middle](https://aclanthology.org/2024.tacl-1.9/) · [Claude Code — Best practices](https://code.claude.com/docs/en/best-practices) · [Thoughtworks Radar — Agent instruction bloat](https://www.thoughtworks.com/radar/techniques/agent-instruction-bloat) · [Claude Code — How Claude remembers your project](https://code.claude.com/docs/en/memory) · [Birgitta Böckeler — Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html) · [Anthropic — Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) · [Anthropic — Scaling agentic coding across your organization (PDF)](https://resources.anthropic.com/hubfs/Scaling%20agentic%20coding%20across%20your%20organization.pdf) · [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) · [Anthropic — Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
