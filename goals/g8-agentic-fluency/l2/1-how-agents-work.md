---
title: Running Claude Code
---

L1 described Claude Code as a harness that runs Claude in a loop of gather context, take action, verify results (G8.1 L1). Here it runs on a real task: what a session holds, how to work through a change, which model to pick, and what it costs.

**Start a session.** Install Claude Code from the quickstart, then run `claude` in the project folder and sign in: with a claude.ai subscription, or with a Claude Console account, which bills per token. If the `ANTHROPIC_API_KEY` environment variable is set, Claude Code bills that API key instead of the subscription.

**What loads before your first prompt.** Run `/context` to see the context broken down by source. From the docs' context-window page:

| Item | Size | Note |
|---|---|---|
| System prompt | about 4,200 tokens | Claude Code's own instructions; hidden |
| Auto memory (`MEMORY.md`) | first 200 lines or 25 KB | notes Claude wrote itself in earlier sessions (G8.2 L2) |
| Environment | about 280 tokens | working folder, platform, shell; git branch, status, and recent commits as a separate block |
| MCP tools | names only | full tool schemas load on demand through tool search |
| Skill descriptions | one line per skill | a skill's body loads when it is used |
| CLAUDE.md files | their full text | your user file and the project's, plus any in parent folders |

**The window and compaction.** Opus 5.5, Sonnet 5.5, and Fable 5.1 have a 1 million-token context window; Haiku 4.5 has 200,000. **Compaction** replaces the conversation with a structured summary when it nears the limit, about 967,000 tokens by default on the 1M models; `/autocompact 500k` makes it happen earlier. After compaction Claude Code loads the startup content again, except the skill list, and re-adds each skill you used, up to 5,000 tokens each and 25,000 in total. Steer the summary with `/compact Focus on the API changes`, or with a `# Compact instructions` section in CLAUDE.md. `/clear` empties the context for the next task and costs nothing. A large window is room, not a target: answers degrade as it fills (G8.2 L1).

**A task, step by step.** The capstone's Spring Boot API needs paging on `GET /documents` (Spring Boot is a Java framework for web services; G6.2 L1). The docs' workflow is explore, plan, implement, commit:

1. **Explore.** Press Shift+Tab until the status bar shows plan mode, so nothing can be edited yet. Ask: `Read DocumentController and its tests. How does listing work today, and how are other endpoints paged?`
2. **Plan.** `Plan cursor-based paging for GET /documents: the files that change, the tests that prove it, and the response shape.` Press Ctrl+G to edit the plan in your editor, then approve it.
3. **Implement.** Claude edits, runs `./mvnw test`, reads the failures, and fixes them. Press Esc to stop it mid-turn; type a correction while it works and it reads it on the next turn.
4. **Verify.** Run the tests yourself and read `git diff` (G8.4 L2).
5. **Commit.** `Commit this with a message that says why.` Read the message before it lands.

Every prompt sets a **checkpoint**: Esc twice, or `/rewind`, restores the code and the conversation to an earlier one. The docs' rule for a session that keeps going wrong: after two corrections on the same issue, `/clear` and start again with a better prompt.

**Choosing a model.** `/model` switches mid-session, by name or alias.

| Model | Alias | API price per million tokens, input / output | Context | Anthropic's guidance |
|---|---|---|---|---|
| Fable 5.1 | `fable` | $10 / $50 | 1M | "your hardest and longest-running tasks": subtle bugs, unfamiliar domains, architecture |
| Opus 5.5 | `opus` | $4 / $20 | 1M | the default on every plan and the API; "complex reasoning tasks" |
| Sonnet 5.5 | `sonnet` | $2 / $10 | 1M | "daily coding tasks": routine edits, mechanical changes, questions about existing code |
| Haiku 4.5 | `haiku` | $1 / $5 | 200K | "simple tasks"; retiring no sooner than 15 October 2026 |

Two more aliases: `best` picks Fable where your plan has it, otherwise Opus; `opusplan` uses Opus in plan mode and Sonnet to carry the plan out. **Effort** sets how much the model thinks before it answers: `/effort` takes `low`, `medium`, `high`, `xhigh`, or `max`; Opus 5.5 and Sonnet 5.5 default to `medium`, most other models to `high`. Thinking is billed as output tokens. Anthropic's rule of thumb: when Claude failed confidently, use a bigger model; when it skipped files or tests, raise the effort.

**Plans and cost.**

| Plan | Price | Claude Code usage |
|---|---|---|
| Pro | $20 a month | included, within the plan's limits |
| Max 5x / Max 20x | $100 / $200 a month | 5 or 20 times Pro's usage |
| Team | $25 a seat a month, Standard ($20 billed yearly); Premium $125 ($100 yearly) | Premium seats get 5 times Standard's usage |
| Enterprise | $20 a seat a month, billed yearly, plus usage | at API rates |
| Claude Console | pay per token | API prices above |

Subscription usage resets on a rolling 5-hour window and a weekly window, shared across chat, Cowork, and Claude Code. Across enterprise deployments Anthropic reports an average of about $13 per developer per active day, $150–250 a month, with 90% of users under $30 a day. `/usage` shows the current session's tokens and estimated cost.

**Why a session costs what it does.** Each model request resends the whole context (G5.1 L1), and a single task makes many requests. **Prompt caching** bills the repeated part of the context as cheap cache reads: 0.05× the input price on Opus 5.5, so $0.20 per million tokens. Take a task of 30 requests on Opus 5.5 over an average context of 60,000 tokens, 57,000 of them cached, with 1,000 output tokens per request (cache-write charges left out):

- per request: 57,000 × $0.20 / 10⁶ + 3,000 × $4 / 10⁶ + 1,000 × $20 / 10⁶ = $0.011 + $0.012 + $0.020 ≈ $0.043;
- per task: 30 × $0.043 ≈ $1.30. With no caching, each request would cost 60,000 × $4 / 10⁶ + $0.020 = $0.26, and the task $7.80.

The cache lives an hour on a subscription and five minutes on an API key by default, so the first request after a longer break rereads the whole context at full price. A session left open all day costs more per question than a fresh one: clear between tasks.

Sources: [Claude Code — Overview](https://code.claude.com/docs/en/overview) · [Claude Code — Explore the context window](https://code.claude.com/docs/en/context-window) · [Claude Code — Model configuration (aliases, effort, auto-compact window)](https://code.claude.com/docs/en/model-config) · [Claude Code — Best practices](https://code.claude.com/docs/en/best-practices) · [Claude Code — Checkpointing](https://code.claude.com/docs/en/checkpointing) · [Claude Code — Manage costs](https://code.claude.com/docs/en/costs) · [Claude — Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) · [Claude — Pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [Claude — Choosing a model and effort level in Claude Code](https://claude.com/blog/claude-model-and-effort-level-in-claude-code) · [Claude pricing (plans)](https://claude.com/pricing) · [What is the Max plan?](https://support.claude.com/en/articles/11049741-what-is-the-max-plan) · [Use Claude Code with your Pro or Max plan](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)
