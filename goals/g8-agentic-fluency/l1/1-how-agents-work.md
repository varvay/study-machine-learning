---
title: How coding agents work
---

A **coding agent** is an agent (an LLM, a large language model, that calls tools in a loop until a task is done; G5.1 L1) whose tools work on a software project: read and edit files, search the code, run shell commands such as the tests and git, and fetch web pages. Simon Willison's one-line version: "An LLM agent runs tools in a loop to achieve a goal."

An LLM helps with code at three levels, set by who runs the loop:

| | What it does | Who runs the loop |
|---|---|---|
| **Completion** | suggests the next lines as grey text at the cursor; Tab accepts them | you, keystroke by keystroke |
| **Chat** | answers a question with an explanation or code; you copy the code, run it, and paste the errors back | you |
| **Agent** | takes a task, reads the code, edits files, runs the tests, reads the failures, and fixes them until done | the agent; you set the goal and check the result |

The **harness** is the program around the model that runs the loop. It builds the context the model reads, sends it the tool definitions, checks each tool call the model asks for against the permissions, runs it, and feeds the result back. The harness shapes the work as much as the model does: Anthropic's Economic Index found Claude Code sessions more autonomous than chat sessions on the same tasks, and concluded that "the product used is likely more important than the underlying model".

**Claude Code** is Anthropic's coding agent: a harness around Claude, Opus 5.5 by default, that "reads your codebase, edits files, runs commands". Its docs describe each task as three phases that repeat until the work is done: gather context, take action, verify results. Its main built-in tools:

- **Read, Edit, Write** — read a file, replace text in it, or write a whole file.
- **Grep, Glob** — search file contents with a regular expression, and find files by name pattern. Claude Code finds code with these searches as the task needs them, and keeps no pre-built index of the codebase (G8.1 L3).
- **Bash** — run a shell command: the tests, the build, git, `gh` (GitHub's command-line tool).
- **WebFetch, WebSearch** — read a web page, such as a library's docs, and search the web.
- **Agent** — start a **subagent**, a second Claude with a fresh context of its own, for a side task such as searching the codebase; it returns only a summary (G8.3 L2).
- **Skill** — load a skill, a folder of instructions for one kind of task (G8.6).

Before a tool changes anything, Claude Code checks the session's **permission mode** and rules: it runs the call, asks you, or lets a second model, a classifier, decide (G8.5).

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 320" role="img" aria-labelledby="how-agents-work-title">
<title id="how-agents-work-title">One turn through Claude Code: your task enters the context, Claude reads the context and asks for a tool call, the permission check runs it on your machine or asks you, and the result goes back into the context</title>
<rect class="fold-train" x="20" y="125" width="120" height="80" rx="8" />
<text class="table-name" x="80" y="159" text-anchor="middle">You</text>
<text class="key-tag" x="80" y="179" text-anchor="middle">task, approvals</text>
<rect class="table-body" x="170" y="20" width="390" height="285" rx="8" />
<rect class="fact-head" x="170" y="20" width="390" height="30" rx="8" />
<rect class="fact-head" x="170" y="38" width="390" height="12" />
<rect class="table-outline" x="170" y="20" width="390" height="285" rx="8" />
<text class="table-name" x="182" y="40">Claude Code: the harness</text>
<rect class="fold-train" x="190" y="98" width="165" height="100" rx="8" />
<text class="table-name" x="202" y="120">Context</text>
<text class="key-tag" x="202" y="142">system prompt, CLAUDE.md</text>
<text class="key-tag" x="202" y="160">the conversation</text>
<text class="key-tag" x="202" y="178">every tool result</text>
<rect class="fold-test" x="390" y="98" width="150" height="62" rx="8" />
<text class="table-name" x="465" y="124" text-anchor="middle">Claude (model)</text>
<text class="key-tag" x="465" y="144" text-anchor="middle">picks the next step</text>
<rect class="dimension-head" x="390" y="225" width="150" height="62" rx="8" />
<rect class="table-outline" x="390" y="225" width="150" height="62" rx="8" />
<text class="table-name" x="465" y="251" text-anchor="middle">Permission check</text>
<text class="key-tag" x="465" y="271" text-anchor="middle">mode + rules</text>
<rect class="fold-train" x="595" y="98" width="145" height="189" rx="8" />
<text class="table-name" x="607" y="122">Your machine</text>
<text class="key-tag" x="607" y="150">files</text>
<text class="key-tag" x="607" y="170">shell: tests, build, git</text>
<text class="key-tag" x="607" y="190">network</text>
<path class="key-link" d="M140,165 L190,165" /><path class="key-link" d="M184,161 L190,165 L184,169" />
<text class="note" x="165" y="157" text-anchor="middle">task</text>
<path class="key-link" d="M355,129 L390,129" /><path class="key-link" d="M384,125 L390,129 L384,133" />
<path class="key-link" d="M465,160 L465,225" /><path class="key-link" d="M461,219 L465,225 L469,219" />
<text class="note" x="473" y="196">tool call</text>
<path class="key-link" d="M540,256 L595,256" /><path class="key-link" d="M589,252 L595,256 L589,260" />
<text class="note" x="567" y="248" text-anchor="middle">run</text>
<path class="key-link" d="M667,98 L667,80 L272,80 L272,98" /><path class="key-link" d="M268,92 L272,98 L276,92" />
<text class="note" x="470" y="72" text-anchor="middle">result: file text, test output, errors</text>
<path class="key-link" d="M390,272 L80,272 L80,205" /><path class="key-link" d="M76,211 L80,205 L84,211" />
<text class="note" x="235" y="266" text-anchor="middle">ask, in Manual mode</text>
</svg>
</div>
<figcaption>One turn of the loop. Each result lands in the context, and Claude reads the whole context again before its next step. The loop ends when Claude replies with text and no tool call.</figcaption>
</figure>

One engine runs on several surfaces:

- **Terminal** — `claude` in the project folder: the full feature set, plus `claude -p "…"` for scripts (G8.3 L2).
- **IDE** — extensions for VS Code, Cursor, and JetBrains, with diffs shown inline.
- **Desktop app** — several sessions side by side, each in its own git worktree (a second working folder on its own branch; G8.3 L2).
- **Cloud** — sessions on Anthropic-managed virtual machines, started from claude.ai/code, the mobile app, or `claude --cloud`. They keep running with the laptop closed and push their work to GitHub.
- **Slack and GitHub** — mention @Claude in a Slack thread or `@claude` in an issue or pull request, and a cloud session or a GitHub Actions run does the work (G8.6).

Claude acts as an agent outside coding too:

- **The Claude app** (claude.ai, desktop, mobile) — chat and Cowork became one app on 16 September 2026. Cowork "uses the same agentic architecture that powers Claude Code, with no terminal required": multi-step tasks over your files, connectors (links to services such as Google Drive, built on MCP, a standard protocol for connecting tools to models; G5.4 L1), research, and documents.
- **Claude in Chrome** — a browser extension that reads pages, clicks, types, and fills forms; generally available on paid plans since 26 August 2026.
- **Claude Agent SDK** — Claude Code's loop, tools, and context management as a Python and TypeScript library, for building your own agents (G5).

**The 4Ds, the map of this goal.** Anthropic's AI Fluency course, written with Rick Dakan and Joseph Feller, defines AI fluency as "the ability to collaborate with AI in ways that are effective, efficient, ethical, and safe". It names three modes of working with AI: **automation**, where AI carries out a task you specified; **augmentation**, where you and AI think and work as partners; and **agency**, where "you guide AI to work independently on your behalf". A coding agent works in agency. The course names four competencies, the **4Ds**:

| Competency | Course definition | With a coding agent | Section |
|---|---|---|---|
| **Description** | "Communicating clearly with AI systems" | the task, the project instructions, the definition of done | G8.2 |
| **Delegation** | "Thoughtfully deciding what work to do with AI vs. doing yourself" | what to hand over, in what size of step, after what plan | G8.3 |
| **Discernment** | "Evaluating AI outputs and behavior with a critical eye" | reviewing the diff, catching the typical errors | G8.4 |
| **Diligence** | "Ensuring you interact with AI responsibly" | permissions, secrets, data terms, owning what ships | G8.5 |

G8.6 covers the tooling that carries all four into a team.

Sources: [Claude Code — Overview](https://code.claude.com/docs/en/overview) · [Claude Code — How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works) · [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) · [Claude Code in Slack](https://code.claude.com/docs/en/slack) · [VS Code — Agents concepts (agent loop, harness)](https://code.visualstudio.com/docs/agents/concepts/agents) · [GitHub Docs — Code suggestions](https://docs.github.com/en/copilot/concepts/completions/code-suggestions) · [Simon Willison — I think "agent" may finally have a widely enough agreed upon definition](https://simonw.substack.com/p/i-think-agent-may-finally-have-a) · [Anthropic Economic Index, June 2026](https://www.anthropic.com/research/economic-index-june-2026-report) · [Cowork and chat are one Claude](https://claude.com/blog/cowork-is-now-claude) · [Get started with Claude Cowork](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork) · [Claude in Chrome is generally available](https://claude.com/blog/claude-in-chrome-generally-available) · [Claude Agent SDK — Overview](https://code.claude.com/docs/en/agent-sdk/overview) · [Claude Academy — The 4D framework](https://academy.claude.com/courses/ai-fluency-framework-foundations/the-4d-framework) · [Claude Academy — Introduction to AI Fluency](https://academy.claude.com/courses/ai-fluency-framework-foundations/introduction-to-ai-fluency)
