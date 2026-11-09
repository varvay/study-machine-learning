---
title: Rolling out to a team, and measuring it
---

L2 built each extension for the capstone (G8.6 L2). This level takes Claude Code to a team: what to share, how to roll it out, how to tell whether it helps, and a worked setup to walk an interviewer through.

**What lives where.**

| Layer | Files | Owned by |
|---|---|---|
| Organization | managed settings, managed CLAUDE.md, approved MCP servers, an internal plugin marketplace | platform or security team |
| Repository | `CLAUDE.md`, `.claude/settings.json`, `.claude/skills/`, `.claude/agents/`, `.claude/rules/`, `.mcp.json`, hook scripts | the team, through pull requests |
| Person | `~/.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/settings.local.json` | each developer |

Thoughtworks put **curated shared instructions** under Adopt in April 2026: "relying on individual developers to write prompts from scratch is emerging as an anti-pattern." A repository's `.claude/` folder is reviewed like code, because it steers every session and every CI run.

**Rolling it out.** Anthropic's guide to scaling agentic coding:

1. **Pilot** — "Begin with a pilot group of 20-50 developers… they're your future agentic coding champions."
2. **Seed the shared setup** — the pilot writes the first CLAUDE.md files and team commands, and a chat channel collects tips; launch with a hackathon.
3. **Govern** — admins push "enterprise managed policy settings that take precedence over user and project settings" (G8.5 L3).
4. **Measure** — sprint throughput, time to completion, satisfaction surveys, onboarding speed, and activity (active users, spend). Lines of code are "notoriously a spotty metric".

Microsoft's early-2026 rollout of Claude Code and Copilot CLI to tens of thousands of engineers found that "first use spread primarily through social networks", so visible peer use drove adoption. Adopters merged about 24% more pull requests, sustained over four months.

**Measuring it.** Three frameworks, from narrow to broad:

- **DORA's five delivery metrics** — throughput: change lead time, deployment frequency, failed-deployment recovery time; instability: change fail rate, deployment rework rate. They show whether more code turned into better delivery (G8.4 L3).
- **SPACE** — productivity has five dimensions, and no single metric captures it: Satisfaction and well-being, Performance, Activity, Communication and collaboration, Efficiency and flow.
- **DX's AI Measurement Framework** — **utilization** (daily and weekly active users, share of pull requests AI-assisted), **impact** (time saved, pull request throughput, change failure rate, maintainability), and **cost** (spend per developer). DX's warning: "more PRs do not automatically mean more business value".

Claude Code's own data feeds the first and third: the Team and Enterprise analytics dashboard shows daily active users, sessions, and contribution metrics; the Analytics APIs return them per user; OpenTelemetry streams tokens, cost, and tool activity into the team's monitoring.

**What the evidence says.**

| Source | Finding |
|---|---|
| Cui et al., field experiments at Microsoft, Accenture, and a Fortune 100 company (4,867 developers, Copilot) | 26% more completed tasks; less experienced developers gained more |
| METR randomized trial, 2025 (16 experienced developers, own repositories) | 19% slower with AI, while believing they were 20% faster |
| METR follow-up, 2026 (57 developers) | 18% and 4% speedups, not statistically significant; METR now expects speedups |
| DORA 2024 / 2025 | throughput and stability down with adoption in 2024; throughput up, stability still down in 2025 |
| Anthropic, internal | "more than 80% of the code we merge… was authored by Claude" (May 2026); engineers merged 8 times as much code per day as in 2024, which Anthropic itself says overstates the real gain |
| Google | "75% of all new code at Google is now AI-generated and approved by engineers" (April 2026) |

Read together: output volume rises clearly; delivery outcomes and quality move less, and depend on the team's practices. That is why the measures pair throughput with stability and rework.

**Worked example: this journal's setup.** This study journal is built with Claude Code, and its `.claude/` folder is a small, real configuration:

- **`CLAUDE.md`** — the project instructions. It opens with the rule that matters most ("succinct and effective — above all"), then tells Claude to read the fault ledger and load every skill before working. It sets working rules (read a document to the end, announce each shell command, cite a source for any claim about the outside world), ownership rules (notes, goal pages, and the roadmap are the owner's; Claude edits them only when asked), the site's content model, and git rules (never stage files, never push; commits only when asked).
- **Skills** — `doc-writer` and `code-writer` hold the house style for prose and code; `commit-writer` holds the commit message style; `fault-tracker` holds the ledger and how to add to it.
- **The fault ledger** — the mistake log of G8.2 L3: each fault's trigger and guard, read at the start of every session. It is gitignored, so it records freely without passing review.
- **`.claude/settings.json`** — deny rules on `git push`, deploys, `rm -rf`, `git reset --hard`, and history rewrites; ask rules on `git commit`, `git reset`, `git restore`, `git stash`, and the other commands that rewrite the index or the working files; auto-compaction turned off.
- **Personal files** — `settings.local.json` and other `*.local.json` files are gitignored.

Mapped to the 4Ds: CLAUDE.md and the style skills are **Description**; the ownership and git rules draw the line of **Delegation**; the fault ledger and the cite-a-source rule train **Discernment**; the deny list and "pushing is the owner's" are **Diligence**.

Its known gaps show the L3 lessons in miniature:

- **Advisory where it could be enforced.** CLAUDE.md forbids `git add`, but no ask or deny rule covers it, so the rule holds only as long as Claude follows it. A deny rule would make it certain (G8.2 L3).
- **No hooks.** The site's build check runs when Claude remembers to run it; a `Stop` hook could run `npm run build` before every reply ends.
- **No reviewer subagent.** Pages are checked by the same session that wrote them; a read-only reviewer with a fresh context would catch more (G8.4 L2).

**In an interview**

- *How do you use AI tools in your daily work?* I use Claude Code for most of my coding, in a setup I keep in the repository: a short CLAUDE.md with the commands and rules, skills for my house style, and permission rules that stop it from pushing or rewriting history. I plan in plan mode before larger changes, give it a test or a build as the definition of done, and review every diff myself; I keep a log of the agent's mistakes that it reads at the start of each session. My study journal is built this way, so I can show you the configuration.
- *How would you roll out Claude Code to a 50-person team?* Start with a pilot group of volunteers on real work, have them write the shared CLAUDE.md, skills, and permission rules for the main repositories, and put managed settings in place for the security baseline. Then widen through the pilot group as champions. I would measure before and after with DORA's delivery metrics plus utilization and cost, and watch change fail rate and rework, not lines or pull request counts.
- *How would you know it is working?* By delivery outcomes on the team's own work: lead time and deployment frequency up, with change fail rate and rework flat or down. METR showed developers misjudge their own speed by about 40 points, so surveys alone are not enough.

Sources: [Claude Code — Settings files and precedence](https://code.claude.com/docs/en/settings) · [Claude Code — Managed settings](https://code.claude.com/docs/en/managed-settings) · [Thoughtworks Radar — Curated shared instructions for software teams](https://www.thoughtworks.com/radar/techniques/curated-shared-instructions-for-software-teams) · [Anthropic — Scaling agentic coding across your organization (PDF)](https://resources.anthropic.com/hubfs/Scaling%20agentic%20coding%20across%20your%20organization.pdf) · [Murphy-Hill et al., Microsoft's rollout of Claude Code and Copilot CLI](https://arxiv.org/abs/2607.01418) · [DORA — Metrics](https://dora.dev/guides/dora-metrics/) · [Forsgren et al., The SPACE of developer productivity](https://www.microsoft.com/en-us/research/publication/the-space-of-developer-productivity-theres-more-to-it-than-you-think/) · [DX — Measuring AI impact](https://getdx.com/blog/measure-ai-impact/) · [Claude Code — Analytics](https://code.claude.com/docs/en/analytics) · [Claude Code — Monitoring usage](https://code.claude.com/docs/en/monitoring-usage) · [Cui et al. (Microsoft Research)](https://www.microsoft.com/en-us/research/publication/the-effects-of-generative-ai-on-high-skilled-work-evidence-from-three-field-experiments-with-software-developers/) · [METR — Early-2025 AI and experienced developer productivity](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) · [METR — 2026 uplift update](https://metr.org/blog/2026-02-24-uplift-update/) · [Google Cloud — Announcing the 2024 DORA report](https://cloud.google.com/blog/products/devops-sre/announcing-the-2024-dora-report) · [Google Cloud — Announcing the 2025 DORA report](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report) · [Anthropic — When AI builds itself](https://www.anthropic.com/institute/recursive-self-improvement) · [Google — Cloud Next 2026 keynote](https://blog.google/innovation-and-ai/infrastructure-and-cloud/google-cloud/cloud-next-2026-sundar-pichai/)
