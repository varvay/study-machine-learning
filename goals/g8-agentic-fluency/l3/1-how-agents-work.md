---
title: Why agents struggle, and how the tools differ
---

L2 ran Claude Code on a task (G8.1 L2). This level explains where agents fail on real codebases, why Claude Code searches the way it does, how it compares with the other agents, and what the benchmarks measure.

**Why agents struggle on large codebases.**

- **Context limits.** A codebase of a million lines never fits in the window, so the agent sees only what it searched for and read. Quality falls well before the window is full. Chroma's 2025 study of 18 models found that "model performance varies significantly as input length changes, even on simple tasks", and that one irrelevant but similar passage, a **distractor**, already lowers accuracy. Liu et al. found models recall facts at the start and end of a long input better than those in the middle ("lost in the middle"). A large repository is mostly distractors: similar names, old versions, dead code.
- **Stale training data.** A model knows libraries as they were at its training cutoff, June 2026 for Claude Opus 5.5, and blends versions it saw. That is the source of invented APIs (G8.4 L1). The fix is to put the current docs in the context: WebFetch the reference page, or pin the version in CLAUDE.md.
- **Missing tribal knowledge.** Why a module is shaped as it is, which pattern is deprecated, which service is fragile: none of it is in the code. An Anthropic engineer: "there is a lot of intrinsic information that I just have about how my team's code base works that Claude will not have by default." CLAUDE.md, rules, and skills are where that knowledge goes (G8.2 L3).

**Agentic search against an embedding index.** An agent finds code in one of two ways:

- **Agentic search** — the model searches as it works, with Grep and Glob, reads what it finds, and searches again. Nothing is prepared in advance.
- **An embedding index** — every file is split into chunks, and each chunk is turned into a vector that captures its meaning (G1.7 L1). A question is embedded the same way and its nearest chunks are retrieved, as in RAG (retrieval-augmented generation).

Claude Code uses agentic search. Boris Cherny, its creator, on the choice: "Claude Code's 'agentic search' is really just glob and grep, and it outperformed RAG." The team had tried local vector databases and dropped them over stale indexes and permission issues. Cursor built the strongest index-based search, trained its own embedding model, and reported in November 2025 that combining grep with semantic search gave the best results; in July 2026 it turned the embedding index down "in favor of grep-based retrieval", and its docs now say it "does not store embeddings of your codebase for search". The trade-off:

| | Agentic search | Embedding index |
|---|---|---|
| Freshness | always current: it reads the files as they are | must be rebuilt as code changes |
| Privacy | code leaves the machine only when read into a prompt | chunks are embedded, often on a server, and stored |
| Exact names | strong: a grep finds every caller | weak: nearest meaning is not exact match |
| Fuzzy concepts ("where do we retry?") | needs the model to guess search terms | strong |
| Cost | tokens and turns per search | indexing infrastructure |

Claude Code adds precision a third way: **code-intelligence plugins** connect a language server, the same engine an IDE uses for "go to definition", so one call replaces a grep and several file reads.

**Claude Code and the other agents.** All four run an LLM in a tool loop; they differ in where they run and how they bound it.

| | Claude Code | Cursor | GitHub Copilot | OpenAI Codex |
|---|---|---|---|---|
| Runs in | terminal, VS Code, JetBrains, desktop, cloud, Slack, CI | its own editor, plus cloud agents | VS Code agent mode; a cloud agent on GitHub Actions | CLI, IDE extension, desktop, cloud |
| Autonomy controls | six permission modes, including an `auto` classifier | auto-review, allowlist, or run everything | terminal commands need approval unless they match auto-approve rules | sandbox modes `read-only`, `workspace-write` (default), `danger-full-access`, with approval policies |
| Local sandbox | Seatbelt (macOS), bubblewrap (Linux), Bash only; off by default | Seatbelt, Landlock + seccomp; network blocked by default | OS sandbox in preview | Seatbelt, bubblewrap + seccomp, Windows sandbox |
| Cloud agent | cloud sessions on Anthropic VMs | cloud agents in VMs, billed at API prices | cloud agent: one pull request per task, 59-minute cap, a human must approve CI runs | Codex cloud, network off during the agent phase by default |
| Instructions file | CLAUDE.md, or AGENTS.md | `.cursor/rules`, AGENTS.md | `.github/copilot-instructions.md`, AGENTS.md | AGENTS.md |
| Pricing | Pro $20, Max $100–200, Team, Enterprise, or API tokens | Individual $20, Teams $40 a user | Pro $10, Pro+ $39, Max $100, with token-based credits | included in ChatGPT plans, from Plus $20 |

Prices are per month, as of October 2026. Seatbelt is macOS's built-in sandbox; bubblewrap, Landlock, and seccomp are Linux sandboxing tools. The difference that matters most in practice is the harness around the model: Anthropic's Economic Index found that "the product used is likely more important than the underlying model" (G8.1 L1).

**What the benchmarks measure.**

- **SWE-bench** — 2,294 real GitHub issues from 12 Python repositories; an agent passes a task when the repository's own tests for the fix pass (Jimenez et al., 2024).
- **SWE-bench Verified** — 500 of those tasks, checked by human annotators to remove vague issues and unfair tests (OpenAI with the SWE-bench authors, 2024). The official leaderboard's top score is 79.2% (last entry February 2026). In February 2026 OpenAI stopped reporting it: in its audit, "at least 59.4% of the audited problems have flawed test cases", and every frontier model it tested could reproduce the original human fix, a sign the tasks had leaked into training data.
- **SWE-bench Pro** — 1,865 tasks from 41 professional repositories, with copyleft-licensed code to deter training on it (Scale AI). In July 2026 OpenAI retracted its recommendation of it after finding about 30% of the public tasks broken.
- **Terminal-Bench** — tasks done entirely in a terminal, each with its own environment and checking tests. Version 4.0 (August 2026) sets an 8-hour limit per task; Anthropic reports 66.4% for Opus 5.5 (vendor-reported).
- **METR time horizon** — "the task duration (measured by human expert completion time) at which an AI agent is predicted to succeed with a given level of reliability", usually 50%. It doubled about every 7 months over six years, and faster since 2024; an early Claude Mythos Preview reached "at least 16hrs".

What they miss: a benchmark task has a clear issue and a test that defines done. Real work has neither, and the developer's review time is not counted. Benchmark gains and field gains also diverge: in METR's 2025 trial, experienced developers using AI on their own repositories took 19% longer (G8.3 L3).

**In an interview**

- *How does a coding agent understand a large codebase?* It searches as it goes: grep and glob to find names, file reads to understand them, and a fresh search when the results point somewhere new. Claude Code uses only this agentic search because it is always current and keeps code local; even Cursor moved off its embedding index in 2026. The limits are the context window and the knowledge that is not in the code, which is what CLAUDE.md and skills supply.
- *Which coding agent would you pick for a team, and why?* Claude Code. The model matters less than the harness, and Claude Code's harness gives fine control over autonomy (permission modes, rules, a sandbox, managed settings), runs the same in the terminal, IDE, cloud, and CI, and is configured by files the team commits. I would check the client's constraints first: data terms, where the code may go, and the editor the team already uses.
- *What does a high SWE-bench score tell you?* That a model fixes well-specified Python issues with good tests. Verified is contaminated and partly broken, and OpenAI stopped reporting it in 2026, so I read benchmark scores as a rough ranking and run a pilot on the team's own code to decide.

Sources: [Chroma — Context rot](https://www.trychroma.com/research/context-rot) · [Liu et al., Lost in the middle](https://aclanthology.org/2024.tacl-1.9/) · [Claude — Models overview (training cutoff)](https://platform.claude.com/docs/en/about-claude/models/overview) · [Anthropic — How AI is transforming work at Anthropic](https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic) · [The Pragmatic Engineer — Building Claude Code with Boris Cherny](https://newsletter.pragmaticengineer.com/p/building-claude-code-with-boris-cherny) · [Cursor — Improving agent search with semantic search](https://cursor.com/blog/semsearch) · [Cursor forum — codebase indexing turned down](https://forum.cursor.com/t/what-do-you-think-about-cursor-removing-the-codebase-indexing-settings/165899/10) · [Cursor docs — Search](https://cursor.com/docs/agent/tools/search) · [Claude Code — Manage costs (code intelligence plugins)](https://code.claude.com/docs/en/costs) · [Claude Code — Permission modes](https://code.claude.com/docs/en/permission-modes) · [Claude Code — Sandboxing](https://code.claude.com/docs/en/sandboxing) · [Cursor — Run modes](https://cursor.com/docs/agent/security/run-modes) · [Cursor — Cloud agents](https://cursor.com/docs/cloud-agent) · [Cursor pricing](https://cursor.com/pricing) · [VS Code — Copilot security](https://code.visualstudio.com/docs/copilot/security) · [GitHub Docs — About Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent) · [GitHub Copilot plans](https://github.com/features/copilot/plans) · [Codex — Agent approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security) · [Codex — Pricing](https://learn.chatgpt.com/docs/pricing) · [AGENTS.md](https://agents.md) · [Claude pricing](https://claude.com/pricing) · [Anthropic Economic Index, June 2026](https://www.anthropic.com/research/economic-index-june-2026-report) · [Jimenez et al., SWE-bench](https://arxiv.org/abs/2310.06770) · [OpenAI — Introducing SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/) · [SWE-bench leaderboard](https://www.swebench.com/) · [OpenAI — Why we no longer evaluate SWE-bench Verified](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/) · [Scale AI — SWE-bench Pro](https://labs.scale.com/leaderboard/swe_bench_pro_public) · [OpenAI — Separating signal from noise in coding evaluations](https://openai.com/index/separating-signal-from-noise-coding-evaluations/) · [Terminal-Bench 4.0](https://www.tbench.ai/news/terminal-bench-4-0) · [Anthropic — Claude Opus 5.5](https://www.anthropic.com/claude-opus-5-5) · [METR — Time horizons](https://metr.org/time-horizons/) · [METR — Measuring AI ability to complete long tasks](https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/) · [METR — Early-2025 AI and experienced developer productivity](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)
