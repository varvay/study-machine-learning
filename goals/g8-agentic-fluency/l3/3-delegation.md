---
title: Orchestrating large changes
---

L2 gave the tools: plan mode, tests first, subagents, worktrees, headless runs, and fan-out (G8.3 L2). This level chooses between them for a large change, prices the choice, and says when to keep the work.

**The ways to run more than one Claude.**

| Pattern | What it is | Fits | Cost |
|---|---|---|---|
| **Subagents** | the main session hands side tasks to Claudes with their own context, and reads their summaries | search, research, review inside one task | each subagent's own tokens; the main context stays small |
| **Parallel sessions** | you run several sessions, each in its own git worktree | independent tasks at once | one session's tokens each; your attention is the limit |
| **Fan-out** | a script runs `claude -p` once per item from a list | the same change across many files | tokens per item; easy to stop, retry, and log |
| **Cloud sessions** | sessions on Anthropic VMs that push a branch when done | long or overnight tasks | plan usage; review when they finish |
| **Agent teams** | a lead session coordinates teammate sessions through a shared task list and messages; experimental, off by default | work that splits into parts that must talk | "approximately 7x more tokens than standard sessions when teammates run in plan mode" |

**Why multi-agent coding is costly.** Anthropic's multi-agent research system used about 15 times the tokens of a chat, and its authors named "most coding tasks" as a poor fit, because coding has fewer truly parallel parts than research (G5.3 L3). Parallel agents editing one codebase make **implicit decisions**: two workers choose different names, error styles, or data shapes, and the parts do not fit. What does pay off is separating roles: Anthropic's harness for long-running app development split a planner, a generator, and an evaluator, and found that "separating the agent doing the work from the agent judging it proves to be a strong lever". The working rule: one writer per area of code, and as many readers and reviewers as help.

**Worked example: a migration across 300 files.** The capstone moves its HTTP calls from Spring's older HTTP client, `RestTemplate`, to its newer one, `RestClient`, in 300 files.

1. **Map it.** In plan mode, ask for the list of affected files grouped by pattern, and for the cases that will not convert mechanically. Write them to `files-to-migrate.txt` and `MIGRATION.md`.
2. **Write the recipe once.** Turn the conversion rules and two before/after examples into a skill, `restclient-migration` (G8.6 L2), so every run gets the same instructions.
3. **Pilot.** Run it by hand on 3 files of different shapes. The docs: "Refine your prompt based on what goes wrong with the first 2-3 files, then run on the full set."
4. **Fan out.** Loop `claude -p` over the list with only `Edit` and the test command allowed, `--max-turns` set, and `--output-format json` so each result is logged. Files whose tests fail go to a retry list, not into the commit.
5. **Review by sample and by sensor.** CI runs everything; you read every file of the unusual patterns and a random sample of the rest (G8.4 L3).
6. **Ship in a stack.** Group the changes into small pull requests by package, a **stack** where each builds on the last. GitHub's advice: "teach coding agents to decompose work into a clean, ordered stack" instead of "one huge, un-reviewable pull request".

**Cost against speed.** Parallel runs cut wall-clock time, not tokens. With the L2 figures (about $1.30 for a 30-request task on Opus 5.5 with caching; G8.1 L2), 300 small migrations at 10 requests each cost about 300 × $0.43 ≈ $130 at API prices, whether they run one at a time or 20 at once. Sonnet 5.5 suits a mechanical change: its list price is half Opus's, which halves the uncached input and the output (its cache reads cost the same $0.20 per million). The expensive part is the human: every parallel stream ends in a review.

**When doing it yourself is faster.**

- **Short tasks.** An Anthropic engineer: "[For] a task that I anticipate will take me less than 10 minutes… I'm probably not going to bother using Claude." Writing the prompt and reviewing the diff have a fixed cost.
- **Tasks that rest on what you know.** Code you know deeply, in a repository full of unwritten context. METR's 2025 randomized trial gave 16 experienced open-source developers 246 tasks in repositories they knew well (averaging over a million lines). With AI allowed, tasks took 19% longer. They had forecast a 24% speedup, and afterwards still believed they had been 20% faster.
- **Learning.** When the point is to learn the technology, delegating it skips the learning (G8.4 L3).

The METR result has limits: early-2025 tools, a small sample, and expert developers on their own code. METR's 2026 follow-up, with 57 developers and later tools, measured an 18% speedup for returning developers and 4% for new ones, neither statistically significant, and found that 30–50% of developers avoided submitting tasks they did not want to do without AI, which biases the sample. METR now says "speedups now seem likely" and calls its earlier slowdown outdated. The lesson that holds is the **perception gap**: developers misjudged their own speed by about 40 points. Measure, rather than trust the feeling (G8.6 L3).

**In an interview**

- *How would you use agents to migrate a large codebase?* Map the change in plan mode, write the conversion as a skill with examples, pilot it on three varied files, then fan out with `claude -p` over the file list with tight tool permissions and logged results. Failures go to a retry list. Review the unusual cases fully and sample the rest, with CI as the gate, and ship as a stack of small pull requests.
- *Would you run ten agents in parallel on a feature?* Not on one feature: parallel writers in the same code make conflicting implicit decisions, and the multi-agent token bill is many times a single session's. I parallelize independent tasks in separate worktrees, and inside a task I use subagents to read and review, keeping one writer.
- *Does AI make developers faster?* It depends on the task and the developer. Field experiments found gains, such as 26% more completed tasks with Copilot across three companies; METR found experienced developers 19% slower on their own repositories in 2025, then probable speedups in 2026. The consistent finding is that developers misjudge it, so I would measure it on the team's own work.

Sources: [Claude Code — Subagents](https://code.claude.com/docs/en/sub-agents) · [Claude Code — Worktrees](https://code.claude.com/docs/en/worktrees) · [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) · [Claude Code — Agent teams](https://code.claude.com/docs/en/agent-teams) · [Claude Code — Manage costs (agent team tokens)](https://code.claude.com/docs/en/costs) · [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) · [Cognition — Don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents) · [Anthropic — Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) · [Claude Code — Best practices (fan-out)](https://code.claude.com/docs/en/best-practices) · [GitHub Blog — Turn one giant AI-generated pull request into a reviewable stack](https://github.blog/engineering/turn-one-giant-ai-generated-pull-request-to-a-reviewable-stack/) · [Claude — Pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [Anthropic — How AI is transforming work at Anthropic](https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic) · [METR — Early-2025 AI and experienced developer productivity](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) · [Becker et al., METR paper](https://arxiv.org/abs/2507.09089) · [METR — 2026 uplift update](https://metr.org/blog/2026-02-24-uplift-update/) · [Cui et al., Effects of generative AI on high-skilled work (Microsoft Research)](https://www.microsoft.com/en-us/research/publication/the-effects-of-generative-ai-on-high-skilled-work-evidence-from-three-field-experiments-with-software-developers/)
