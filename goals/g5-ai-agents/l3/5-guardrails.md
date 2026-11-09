---
title: Threat model, sandboxing, audit, degradation
---

L2 added limits, validation, and approvals one at a time. At this level they become one design, driven by a threat model, for the case that matters most: an agent that can change things.

**Threat model** — a structured list of what can go wrong with a system: the **assets** worth protecting, the **entry points** an attacker or an accident can use, the **trust boundaries** where data from one trust level reaches another, and a **control** for each threat. For an agent with write access:

- **Assets** — money, customer data, messages sent in the client's name, the systems the tools can change.
- **Entry points** — everything the model reads: user input, tool results, retrieved documents, memory, other agents' messages, third-party MCP servers and their tool descriptions.
- **Trust boundary** — any text the model reads can steer it, so the model's output is untrusted too. OWASP lists the failure to validate model output before passing it on as **improper output handling** (LLM05).
- **The working assumption** — a fooled or mistaken model can issue any call its tools allow. The worst case is the combined permissions of all its tools, whatever the prompt says.

The main threats, with OWASP's Agentic Top 10 (2026) ids where they apply:

| Threat | Example | Control |
|---|---|---|
| Goal hijack (ASI01) | an email tells the agent to pay a new account | least-privilege tools, policy checks, approval (walkthrough below) |
| Data exfiltration | the agent reads private data, then a web page tells it to post that data to a URL | break the lethal trifecta: no external channel, or an allow-list (G5.4) |
| Tool misuse (ASI02) | a legitimate delete tool, called on the wrong records | narrow tools, dry run, approval for bulk changes |
| Identity and privilege abuse (ASI03) | the agent runs as an admin service account | act with the user's delegated identity, scoped tokens |
| Memory poisoning (ASI06) | an injected "always cc this address" stored as a memory | provenance, no memory writes from untrusted content (G5.2) |
| Cascading failures (ASI08) | one agent's wrong output is the next agent's trusted input | validate at every handoff, as at an external boundary |
| Human trust exploitation (ASI09) | the approver trusts a confident summary and approves | show raw arguments and differences, not the agent's summary |
| Unbounded consumption (LLM10) | a loop burns tokens or calls a paid API thousands of times | caps and budgets (G5.1), rate limits |
| Honest mistakes | the right action on the wrong invoice, a duplicate payment | business rules in code, idempotency keys |

The walkthrough below plays the first row through: an injected payment instruction arrives in a tool result, the model is fooled, and two checks outside the model decide what happens.

**Sandboxing** — running the code and tools an agent triggers inside an isolated environment with its own file system, network, and credentials, so a hijacked or buggy action cannot reach past it. What the sandbox limits:

- **File system** — only the task's working directory, read-only where possible.
- **Network** — an egress allow-list, the outside addresses the sandbox may connect to; everything else blocked. This closes the external channel that data theft needs.
- **Credentials** — none stored inside; the tool layer injects short-lived, narrowly scoped tokens per call.
- **Resources** — CPU, memory, and time limits, so a runaway process dies on its own.
- **Lifetime** — a fresh sandbox per task, destroyed afterwards, so nothing carries over between users.

For write tools that change business systems, the equivalent of a sandbox is a **dry run**: the tool first returns what it would change (a diff, a preview), and a second call, often approved, applies it. The MCP specification asks the same of local servers: run them sandboxed, with minimal default privileges, and grant more access explicitly.

**Audit trail** — an append-only record of what the agent did: on whose behalf, with which inputs, under which rules, and with what effect. A trace (G5.6) serves debugging and can be sampled; an audit trail serves accountability and must be complete. Each entry holds:

- the trace id and the user and agent identities;
- the model and prompt versions;
- each tool call with its arguments and result, with personal data redacted;
- each policy decision (allowed or denied, and by which rule);
- each approval: who approved, when, and what they were shown;
- the effect's id in the target system, such as the payment id.

It must be **tamper-evident**: stored where entries cannot be changed or deleted before their retention ends, such as S3 Object Lock (S3 is AWS's object storage), which stores objects in a write-once-read-many (WORM) model. It must be **complete enough to replay**: an investigator can rebuild what the model saw at each step and why it acted. Token passthrough breaks this, because the downstream system logs the wrong identity (G5.4); AgentCore Policy logs every allow and deny decision to CloudWatch, AWS's logging and monitoring service. The same records later become eval cases (G5.6).

**Graceful degradation** — when a component fails or a limit is hit, the system drops to a safer, reduced mode and keeps serving, instead of failing hard or acting wrongly. For agents, the ladder of modes:

1. **Full autonomy** — acts within its policy.
2. **Propose only** — prepares drafts and proposals; people apply them.
3. **Read only** — answers and looks things up; no writes.
4. **Hand over** — routes the case to a person, with a summary of what was done and what remains.

What moves the agent down the ladder:

- **Model or provider outage** — fall back to another model, or queue the work.
- **Tool outage** — a circuit breaker, a switch that stops calls to a failing service for a while and then tries again, stops calling the failing tool, and the agent is told the tool is unavailable, so it does not retry forever.
- **Budget or step cap reached** (G5.1) — stop and hand over with the partial result.
- **A guardrail blocks one action** — block that action; continue the safe ones.
- **An incident** — a kill switch, a feature flag that disables all write tools at once, without a deploy.

Two rules keep degradation safe. Writes **fail closed**: when a policy check or the approval service is unreachable, the write is refused, never waved through. Retries are **idempotent**: a write is retried only with its idempotency key, so a timeout never becomes a double payment.

**In an interview**

- *Walk me through the threat model for an agent that can issue refunds.* The asset is money, and the entry points are everything the model reads, including tickets and emails an attacker can write. I assume a fooled model will call the refund tool with anything it allows, so the tool itself enforces the limits: refunds only to the original payment method, up to the order value, once per order. A policy engine checks amounts and velocity (how many refunds in how short a time), amounts above a limit need approval, and every call lands in an append-only audit log.
- *The approval service goes down during peak hours. What does your agent do?* Writes fail closed: the agent drops to propose-only, queues its proposals with full context, and tells the user the action is pending. Reads and answers keep working, and the queued proposals are approved when the service returns; nothing is auto-approved because a check was unavailable.

Sources: [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/) · [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) · [OWASP LLM10:2025 Unbounded Consumption](https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/) · [Simon Willison — The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) · [MCP — Security best practices](https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices) · [Amazon S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html) · [Policy in Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy.html)
