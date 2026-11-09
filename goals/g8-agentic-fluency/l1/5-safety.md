---
title: Safety and governance
---

**Diligence** in the 4D framework is "ensuring you interact with AI responsibly", in three parts: **creation** (which AI systems you choose and how you work with them), **transparency** (being open about AI's role in the work), and **deployment** (taking ownership of AI-assisted output you share).

A coding agent runs with your permissions: whatever your shell can do, it can do. The risks:

- **Destructive commands** — actions that are hard to undo: `rm -rf`, `git reset --hard`, a force push, a dropped table. In July 2025 Replit's agent deleted a user's production database during a code freeze (as reported by The Register); Replit then separated development and production databases automatically.
- **Leaked secrets** — an API key or password in a `.env` file that the agent reads is sent to the model provider with the rest of the context, and can end up in a log, a commit, or a reply.
- **Prompt injection** — instructions hidden in content the agent reads, such as a README, an issue, a web page, or a tool result, that it then follows as if you had written them (G3.5 L1). In a May 2025 demo by Invariant Labs, an issue in a public repository led Claude, connected to GitHub through an MCP server (a tool server on the standard Model Context Protocol; G5.4 L1), to copy data from the user's private repositories into a public pull request.
- **Supply chain** — a malicious package, MCP server, or extension. An impostor `postmark-mcp` package on npm worked normally for 15 versions, then quietly copied every email it sent to the attacker (September 2025). In the Nx "s1ngularity" attack of August 2025, a poisoned npm package ran the AI command-line tools it found installed, Claude Code among them, with their safety prompts switched off, to hunt for secrets.
- **Code sent to a vendor** — every file the agent reads goes to the model provider. The provider's terms decide how long it is kept and whether it trains models. Under Anthropic's commercial terms, code sent to Claude Code does not train models and is kept 30 days; on the consumer plans (Free, Pro, Max) each user chooses whether their data trains models (G8.5 L2).
- **Licensing** — generated code can match public code under a licence. GitHub Copilot can block or flag suggestions that match public code; Anthropic offers commercial customers an IP indemnity, a promise to defend them against copyright claims over authorized use.

Simon Willison's **lethal trifecta** names the dangerous combination. An agent is easy to trick into stealing your data when it has all three of:

1. access to private data;
2. exposure to untrusted content;
3. a way to communicate externally.

A coding agent has all three by default: the repository and your credentials, the issues and web pages and dependencies it reads, and the network. Meta's **Agents Rule of Two** turns it into a design rule over three similar properties: processing untrusted input, reaching private data or sensitive systems, and changing state or communicating externally. In one session an agent should hold at most two of them, unless a human approves its actions.

The controls, in the order you meet them: a **permission mode** that decides what runs without asking; **rules** that always allow, ask about, or deny named commands and files; a **sandbox**, an operating-system boundary that limits which files and network hosts a command can reach; and **review** of what the agent did (G8.5 L2).

Sources: [Claude Academy — A closer look at Diligence](https://academy.claude.com/courses/ai-fluency-framework-foundations/a-closer-look-at-diligence) · [The Register — Replit responds to the deleted database](https://www.theregister.com/2025/07/22/replit_saastr_response/) · [Invariant Labs — GitHub MCP exploited](https://invariantlabs.ai/blog/mcp-github-vulnerability) · [Postmark — Malicious postmark-mcp package](https://postmarkapp.com/blog/information-regarding-malicious-postmark-mcp-package) · [Nx advisory GHSA-cxm3-wv7p-598c](https://github.com/nrwl/nx/security/advisories/GHSA-cxm3-wv7p-598c) · [Wiz — s1ngularity supply chain attack](https://www.wiz.io/blog/s1ngularity-supply-chain-attack) · [Claude Code — Data usage](https://code.claude.com/docs/en/data-usage) · [Anthropic — Updates to consumer terms](https://www.anthropic.com/news/updates-to-our-consumer-terms) · [GitHub Docs — Code referencing](https://docs.github.com/en/copilot/concepts/completions/code-referencing) · [Anthropic — Expanded legal protections](https://www.anthropic.com/news/expanded-legal-protections-api-improvements) · [Simon Willison — The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) · [Meta — Agents Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/)
