---
title: Threat model for an agent with repo and shell access
---

L2 set up the controls: permission modes, rules, the sandbox, containers, and data terms (G8.5 L2). This level builds the threat model they answer, checks it against real incidents, and turns it into a policy for client code. It extends the agent threat model in G5.5 L3 and the RAG and agent threat model in G6.7 L3 to a coding agent.

**The threat model.** A threat model lists what an attacker wants, how their input gets in, and what the system can be made to do. For Claude Code on a developer's machine, mapped onto the lethal trifecta (G8.5 L1):

| Trifecta leg | In a Claude Code session | Control that cuts it |
|---|---|---|
| **Private data** | source code; `.env` files; `~/.ssh`, cloud and npm credentials; Claude's own credentials; production data reachable from the machine | deny `Read` rules on secret paths; secrets injected at run time; a container holding only the project |
| **Untrusted content** | dependencies and their install scripts; issues and pull request text; web pages through WebFetch; MCP tool results; skills, plugins, hooks, and settings from someone else's repository | vetted MCP servers and plugins; reading another repository's `.claude/` before trusting it |
| **External communication** | `curl` and every other network command; WebFetch; `git push`; MCP tools that send or write | the sandbox's network allowlist; deny rules on network commands; `ask` on `git push` |

Cut one leg for the whole session and an injection can still mislead the agent, but cannot carry the data out. The sandbox is the strongest single cut, because it holds even when the model is fooled.

**Incidents, and what each teaches.** A CVE is the public ID given to a known vulnerability.

| When | What happened | Lesson |
|---|---|---|
| May 2025 | Invariant Labs: an issue in a public repository led Claude, connected to the GitHub MCP server, to leak private repositories into a public pull request | all three legs in one session; a single token that reaches both public and private repositories |
| Jul 2025 | Amazon Q Developer for VS Code 1.84.0 shipped code an attacker committed through an over-scoped token; it failed to run only because of a syntax error (CVE-2025-8217) | the agent's own build pipeline is part of the attack surface |
| Jul–Aug 2025 | Cursor: an injected prompt could write `.cursor/mcp.json` without approval and so run any command (CurXecute, CVE-2025-54135); an MCP config approved once could later be swapped (MCPoison, CVE-2025-54136) | a config the agent can write is code it can run; an approval must bind to the exact content approved |
| Aug–Oct 2025 | Claude Code: a flaw in parsing `echo` bypassed the approval prompt (CVE-2025-54795); later, project code could run before the user accepted the trust dialog (CVE-2025-59536) | the permission layer has bugs; update promptly and keep the sandbox as a second wall |
| Aug 2025 | Nx "s1ngularity": a poisoned npm release ran the installed claude, gemini, and q CLIs with their permission checks skipped to hunt secrets; over 1,000 valid GitHub tokens leaked and over 5,500 private repositories were made public | an installed agent is a tool for whoever runs code on the machine; organizations can switch off the bypass mode |
| Sep 2025 | `postmark-mcp`, an impostor npm package, behaved for 15 versions, then copied every email to the attacker | pin MCP server versions and install only from the real publisher |
| Dec 2025–Feb 2026 | "Clinejection": Cline's issue-triage workflow ran `claude-code-action` with shell access for any GitHub user; a prompt in an issue title led to a poisoned CI cache, a stolen npm token, and a malicious `cline@2.3.0` | in CI, untrusted triggers, a shell, and secrets are the trifecta |

**MCP-specific risks.** Invariant Labs named three in 2025:

- **Tool poisoning** — hidden instructions in a tool's description, which the model reads and the user never sees.
- **Rug pull** — "a malicious server can change the tool description after the client has already approved it."
- **Shadowing** — one server's description changes how the agent uses another, trusted server.

The MCP specification requires the client side to defend: clients "MUST consider tool annotations to be untrusted unless they come from trusted servers"; there "SHOULD always be a human in the loop with the ability to deny tool invocations"; a server "MUST NOT accept any tokens that were not explicitly issued for the MCP server" (token passthrough); and a one-click install of a local server MUST show the exact command and ask for consent. The Claude Code docs add: "Verify you trust each server before connecting it."

**OWASP's map.** The OWASP Top 10 for Agentic Applications (December 2025) names the risks for any agent; for a coding agent the closest are ASI01 Agent Goal Hijack (prompt injection), ASI02 Tool Misuse, ASI03 Identity & Privilege Abuse (an agent using the developer's full credentials), ASI04 Agentic Supply Chain Vulnerabilities (MCP servers, plugins, skills), ASI05 Unexpected Code Execution, and ASI06 Memory & Context Poisoning (a poisoned CLAUDE.md or auto memory).

**Audit trails.** After an incident you need to know what the agent did:

- **Transcripts** — every session, in `~/.claude/projects/`, kept 30 days by default (`cleanupPeriodDays`).
- **OpenTelemetry** — the open standard for traces and metrics (G6.6); Claude Code exports per-user tokens, cost, and tool activity through it to the organization's monitoring stack.
- **A logging hook** — a `PreToolUse` hook with matcher `*` can append every tool call to a central log.
- **Git** — the `Co-Authored-By` trailer marks agent commits, and commits from cloud sessions link to the session.

**Policy for client code.** Managed settings are deployed by the organization through the Claude admin console, device management, or a `managed-settings.json` file, and override every user and project setting. A policy for a consultancy working on client repositories:

1. **Accounts** — commercial plan only (Team or Enterprise), so code never trains models; zero data retention where the contract requires it; no personal accounts on client code (G8.5 L2).
2. **No bypass** — `disableBypassPermissionsMode`; unattended runs only in CI containers.
3. **Sandbox on** — `sandbox.enabled` with `failIfUnavailable`, and a network allowlist limited to the package registry and the client's own hosts (`allowManagedDomainsOnly`).
4. **Central rules** — `allowManagedPermissionRulesOnly` and `allowManagedHooksOnly`, so a cloned repository cannot loosen them; deny reads of secret paths.
5. **Vetted MCP** — `allowedMcpServers` lists the approved servers, pinned to versions.
6. **CI** — agent workflows trigger only for users with write access (the action's default); no secrets in jobs that untrusted input can start; tools limited with `--allowedTools`.
7. **Operations** — keep Claude Code current; export OpenTelemetry; know which tokens to revoke when a machine is compromised.

**In an interview**

- *What is the security risk of giving a coding agent shell access?* The agent runs with my permissions and reads untrusted text: dependencies, issues, web pages, tool results. Any of it can carry instructions. If the same session can read secrets and reach the network, an injection can steal them: that is the lethal trifecta. I cut the network leg with a sandbox allowlist, keep secrets out of reach, and require approval for anything that leaves the machine, like a push.
- *A client asks whether their code is safe with Claude Code. What do you set up?* A commercial plan so nothing trains models, zero retention if the contract needs it, then managed settings: bypass mode off, the sandbox required, central permission rules and hooks, an allowlist of MCP servers, and audit logging through OpenTelemetry. In CI, the agent runs only for trusted triggers, with minimal tools and no secrets exposed to untrusted input.

Sources: [Simon Willison — The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) · [Meta — Agents Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/) · [Invariant Labs — GitHub MCP exploited](https://invariantlabs.ai/blog/mcp-github-vulnerability) · [AWS security bulletin AWS-2025-015](https://aws.amazon.com/security/security-bulletins/AWS-2025-015/) · [Cursor advisory GHSA-4cxx-hrm3-49rm (CurXecute)](https://github.com/cursor/cursor/security/advisories/GHSA-4cxx-hrm3-49rm) · [Check Point — MCPoison](https://research.checkpoint.com/2025/cursor-vulnerability-mcpoison/) · [GitHub advisory GHSA-x56v-x2h6-7j34 (CVE-2025-54795)](https://github.com/advisories/GHSA-x56v-x2h6-7j34) · [GitHub advisory GHSA-4fgq-fpq9-mr3g (CVE-2025-59536)](https://github.com/advisories/GHSA-4fgq-fpq9-mr3g) · [Nx advisory GHSA-cxm3-wv7p-598c](https://github.com/nrwl/nx/security/advisories/GHSA-cxm3-wv7p-598c) · [Wiz — s1ngularity](https://www.wiz.io/blog/s1ngularity-supply-chain-attack) · [Postmark — Malicious postmark-mcp package](https://postmarkapp.com/blog/information-regarding-malicious-postmark-mcp-package) · [Cline — Post-mortem: unauthorized Cline CLI npm release](https://cline.bot/blog/post-mortem-unauthorized-cline-cli-npm) · [Invariant Labs — MCP tool poisoning attacks](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks) · [MCP specification — Security best practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices) · [MCP specification — Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) · [Claude Code — MCP](https://code.claude.com/docs/en/mcp) · [OWASP — Top 10 for Agentic Applications](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/) · [Claude Code — Data usage](https://code.claude.com/docs/en/data-usage) · [Claude Code — Monitoring usage (OpenTelemetry)](https://code.claude.com/docs/en/monitoring-usage) · [Claude Code — Settings reference (attribution)](https://code.claude.com/docs/en/settings-reference) · [Claude Code — Managed settings](https://code.claude.com/docs/en/managed-settings) · [Claude Code — Sandboxing](https://code.claude.com/docs/en/sandboxing) · [Claude Code — GitHub Actions (who can trigger runs)](https://code.claude.com/docs/en/github-actions)
