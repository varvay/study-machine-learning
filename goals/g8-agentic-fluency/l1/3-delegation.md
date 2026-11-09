---
title: Planning and delegation
---

**Delegation** in the 4D framework is "thoughtfully deciding what work to do with AI vs. doing yourself". It has three parts:

- **Problem awareness** — understanding your goal and the work involved before you hand any of it over.
- **Platform awareness** — knowing what the AI system can do: here, what Claude Code can reach (files, shell, web), and where it tends to fail (G8.4).
- **Task delegation** — dividing the work between you and the AI, task by task.

**Plan before editing.** A plan is a short written approach: which files change, in what order, and how each step is checked. Claude Code's **plan mode** makes the agent read the code and propose a plan without editing anything; edits start only once you approve it (G8.3 L2). A wrong direction costs a paragraph to fix in a plan and a whole diff to fix in code. The docs: "Separate research and planning from implementation to avoid solving the wrong problem." They also say when to skip it: "If you could describe the diff in one sentence, skip the plan."

**Small, verifiable steps.** A step is the right size when it ends with a check the agent can run: a test passes, the build is green, the page matches a screenshot. An error then shows up at the step that caused it, while it is still cheap to undo. A step too large to check is reviewed by reading alone, which is where agent errors slip through (G8.4).

**What to hand over.** Anthropic surveyed 132 of its own engineers in 2025. One summed up where the agent shines: "absolutely *amazing* for everything where validation effort isn't large in comparison to creation effort." Most said they could hand over fully only 0–20% of their work; the rest they did with Claude, checking as they went.

| Delegate | Keep, or work through it together |
|---|---|
| A bug with a failing test or exact repro steps | Requirements that are still unclear |
| Tests for code that exists | A design that spans many modules and must stay consistent |
| A refactor guarded by tests | Security-sensitive code, personal data, production incidents |
| The same change across many files | A task under ten minutes, where explaining it costs more than doing it |
| Docs, boilerplate, small UI fixes | Something you are trying to learn |

The table draws on GitHub's guidance for its cloud agent, Anthropic's survey, and the Claude Code docs. One Anthropic engineer: "[For] a task that I anticipate will take me less than 10 minutes… I'm probably not going to bother using Claude." Anthropic's product team split work by supervision instead: peripheral features and prototypes run on their own, while "core business logic" and "critical fixes" get synchronous supervision.

Sources: [Claude Academy — A closer look at Delegation](https://academy.claude.com/courses/ai-fluency-framework-foundations/a-closer-look-at-delegation) · [Claude Code — Best practices](https://code.claude.com/docs/en/best-practices) · [Claude Code — Permission modes (plan mode)](https://code.claude.com/docs/en/permission-modes) · [Anthropic — How AI is transforming work at Anthropic](https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic) · [Anthropic — How Anthropic teams use Claude Code (PDF)](https://www-cdn.anthropic.com/58284b19e702b49db9302d5b6f135ad8871e7658.pdf) · [GitHub Docs — Get the best results from Copilot cloud agent](https://docs.github.com/en/copilot/tutorials/coding-agent/get-the-best-results)
