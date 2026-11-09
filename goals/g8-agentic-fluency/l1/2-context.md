---
title: Context and instructions
---

An agent's **context** is everything the model reads on a call: the system prompt (the harness's standing instructions; G3.5 L1), the tool definitions, the project's instruction files, the conversation, and every file it read and every command output it saw. The model keeps nothing between calls, so the harness sends the whole context each time (G5.1 L1). What is in the context decides what the agent does; what is missing, it guesses.

**Context engineering** is Anthropic's name for the skill: "the set of strategies for curating and maintaining the optimal set of tokens (information) during LLM inference" (a token is a word or piece of a word, the unit a model reads and is billed by; G3.1 L1). Its aim is "the smallest possible set of high-signal tokens that maximize the likelihood of some desired outcome". Prompt engineering writes one prompt; context engineering manages everything that enters the window over a whole session.

The 4D framework calls the same skill **Description**, "communicating clearly with AI systems", in three parts:

- **Product** — what you want the AI to create. For a coding agent: the change, and how you will know it is right.
- **Process** — how the AI should approach it: which files, which pattern to follow, what to avoid.
- **Performance** — how it should behave while working: ask before adding a dependency, stop and report when a test fails twice, keep replies short.

You control four inputs:

1. **The task** — what to change, where, and why. The Claude Code docs contrast "improve this codebase", which sends the agent scanning everything, with "add input validation to the login function in auth.ts". A good task also states the symptom and where to look, as in the docs' example: "The checkout flow is broken for expired cards. Code is in src/payments/. Investigate and fix."
2. **A project instructions file** — a Markdown file the agent loads at the start of every session, with what it needs every time: build and test commands, code conventions, the project layout, rules such as "never push". Claude Code reads **CLAUDE.md**. **AGENTS.md** is the cross-tool convention, stewarded by the Linux Foundation's Agentic AI Foundation and read by OpenAI Codex, Cursor, GitHub Copilot, Gemini CLI, and others; Claude Code reads it when a repository has no CLAUDE.md (G8.2 L2).
3. **Reference files** — an existing file that already does it right, named in the prompt with `@`, such as `@src/api/users.ts`, so the agent copies its pattern.
4. **A definition of done** — a check the agent can run itself: a test, a build, a screenshot to compare. The Claude Code docs: "Give Claude a check it can run: tests, a build, a screenshot to compare. It's the difference between a session you watch and one you walk away from."

The context window is finite, and quality falls before it is full. Claude Code's docs put it first in their best practices: "Claude's context window fills up fast, and performance degrades as it fills." Anthropic calls the effect **context rot**: "as the number of tokens in the context window increases, the model's ability to accurately recall information from that context decreases." So a session holds one task: a long session that drifted through three topics carries the first two into every call of the third (G8.2 L2).

Sources: [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) · [Claude Academy — A closer look at Description](https://academy.claude.com/courses/ai-fluency-framework-foundations/a-closer-look-at-description) · [Claude Code — Best practices](https://code.claude.com/docs/en/best-practices) · [Claude Code — Manage costs (specific prompts)](https://code.claude.com/docs/en/costs) · [Claude Code — How Claude remembers your project](https://code.claude.com/docs/en/memory) · [AGENTS.md](https://agents.md) · [Linux Foundation — Agentic AI Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
