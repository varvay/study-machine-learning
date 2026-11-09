---
title: Tool design, tool security, and tool count
---

L2 defined tools with JSON Schema, `@Tool`, and an MCP server. At this level a tool is an interface whose user is a model: its name, description, parameters, results, and errors decide whether the agent uses it correctly, and its permissions decide how much damage a fooled agent can do.

**Tool design.** Anthropic calls this the agent-computer interface (ACI), and names crafting it through documentation and testing as one of its three core principles for agents. The rules:

- **One tool per task, not per endpoint.** Wrapping every API endpoint as a tool makes the model chain them. Anthropic's example: one `schedule_event` tool that finds a free slot and books it, instead of `list_users`, `list_events`, and `create_event`; `search_contacts` instead of `list_contacts`.
- **Names that cannot be confused.** Prefix by service and resource (`erp_search_invoices`, `erp_get_invoice`). Anthropic reports that wrong tool choice and wrong parameters are the most common failures, "especially when tools have similar names like `notification-send-user` vs. `notification-send-channel`". MCP tool names are unique only within one server, so a client combining servers should prefix names with a server identifier.
- **Descriptions written for a newcomer.** Say what the tool does, when to use it and when to use another one instead, the format and units of each parameter, limits, and side effects.
- **Parameters that are hard to get wrong** (Anthropic's poka-yoke, Japanese for mistake-proofing). Use `user_id`, not `user`; enums instead of free strings; absolute file paths, which Anthropic found the model used flawlessly after relative paths caused errors. Leave out anything the model should not choose: the tenant, the user, the approval flag come from the session (G5.2).
- **Results that serve the next decision.** Return names next to ids: Anthropic found that replacing UUIDs with meaningful names significantly improved Claude's precision, offer a `response_format` of `concise` or `detailed`, and paginate or truncate with a hint on how to get more. Claude Code caps tool responses at 25,000 tokens by default.
- **Idempotent writes.** A write tool takes an idempotency key, so a retry after a timeout does not post twice.

**Errors the model can act on.** The MCP specification defines two kinds:

- **Protocol errors** — an unknown tool, a malformed request, a server fault. They return as JSON-RPC errors, and the model can rarely fix them.
- **Tool execution errors** — invalid input, an API failure, a broken business rule. They return as a normal result with `isError: true` and "actionable feedback that language models can use to self-correct". Clients SHOULD pass them to the model.

The difference in practice:

- Opaque: `404 Not Found`.
- Actionable: `No invoice "INV-77" for vendor ACME-001. Invoice numbers look like "INV-2026-00077". Call erp_search_invoices with vendor_id to list them.`

Spring AI follows the same idea: by default, `DefaultToolExecutionExceptionProcessor` sends a tool's `RuntimeException` message back to the model and rethrows checked exceptions; `spring.ai.tools.throw-exception-on-error=true` throws them all to the caller instead. So write exception messages for the model, and keep stack traces, SQL, and hostnames out of them: the model may repeat them to a user.

**Tool security: authentication.** The first question is whose identity a tool acts with.

- **A service identity** — the agent has its own credentials. Simple, but every user gets the agent's full access, and the audit log shows the agent, not the person.
- **The user's identity** — the tool acts with a token delegated by the user, so it can do only what that user may do. OWASP's mitigation for excessive agency says the same: execute extensions in the user's context.

For remote MCP servers, the specification's authorization rules follow OAuth 2.1:

- The MCP server is a resource server, the OAuth role that holds the protected data and accepts tokens. It MUST publish Protected Resource Metadata (RFC 9728), which tells clients where to get a token.
- The client MUST name the server it wants a token for, with a `resource` parameter (RFC 8707), so the token is bound to that server.
- The server MUST check that each token was issued for it (its **audience**), and MUST NOT accept or pass on any other token. Passing a client's token on to a downstream API, **token passthrough**, is forbidden: it bypasses the downstream API's controls and breaks the audit trail.
- Servers on the stdio transport do not use this flow; they take credentials from their environment.

The model never sees a credential. Tokens live in the tool layer; the model sees only results.

**Tool security: least privilege.** OWASP's **excessive agency** (LLM06) names three root causes, and each has a fix:

- **Excessive functionality** — tools the task does not need, or one open-ended tool such as `run_sql` or `shell`. Fix: fewer, narrower tools: `erp_search_invoices` instead of `run_sql`.
- **Excessive permissions** — a tool that can do more than its purpose: a read tool connected as the database owner. Fix: narrow credentials: a read-only database role with row-level security, OAuth scopes (the named permissions a token carries) limited to the task. MCP recommends starting with minimal scopes and asking for more (step-up) only when a privileged operation first needs it.
- **Excessive autonomy** — high-impact actions without a check. Fix: human approval for those actions (G5.3), and policy checks outside the model (G5.5).

Least privilege is what limits the damage when every other defense fails: a hijacked agent can do exactly what its tools allow, and nothing more.

**Injection through tool results.** **Indirect prompt injection** is an instruction hidden in content that a tool returns: an email, a web page, a PDF, a support ticket, a database row (OWASP LLM01; Greshake et al., 2023). It works because the model reads tool results and instructions as one stream of tokens, with no reliable boundary between data and command. Defenses, strongest first:

1. **Deterministic limits outside the model** — least-privilege tools, allow-lists, a policy engine that checks every call (such as AgentCore Policy, which evaluates each tool call through AgentCore Gateway, AWS's managed entry point for agent tools, against rules in Cedar, AWS's open-source policy language), and human approval of the exact arguments. These hold even when the model is fooled. The walkthrough in G5.5 plays this out.
2. **Break the lethal trifecta** — an agent is exposed to data theft when it combines access to private data, exposure to untrusted content, and a way to communicate externally (Simon Willison). Meta's "Rule of Two" says the same: in one session, an agent should have at most two of untrusted input, sensitive data or systems, and the ability to change state or communicate externally. An agent that needs all three in one context must not run autonomously; it needs at least human-in-the-loop approval.
3. **Handle content as data** — return structured fields instead of free text where possible, mark untrusted content clearly in the prompt (OWASP: segregate and identify external content), and strip what the task does not need.
4. **Detection** — classifiers that flag injection attempts. Useful as an alarm, never as the only layer, because they are probabilistic. Check what a filter covers: the Amazon Bedrock Guardrails prompt-attack filter does not evaluate tool results, so tool content must be sent through the `ApplyGuardrail` API separately.

**MCP servers are a supply chain.** A third-party server's code and tool descriptions are untrusted until reviewed. The specification says clients MUST treat tool annotations such as `readOnlyHint` and `destructiveHint` as untrusted unless the server is trusted, and requires clients that install local servers in one click to show the exact command and get explicit consent. Pin server versions, review updates, and run local servers in a sandbox, an isolated environment that limits what a process can reach, with minimal privileges (G5.5).

**Tool count against accuracy.** Every tool definition costs tokens on every call, and every extra tool is another wrong choice the model can make. Anthropic measured about 55,000 tokens of tool definitions for five common MCP servers before the conversation starts, and 134,000 internally before optimizing. The remedies:

- **Consolidate** — fewer tools, each doing a whole task.
- **Scope per step** — a workflow step or a sub-agent exposes only its own tools.
- **Tool search** — load a searchable index instead of every definition, and fetch the few that fit. On Anthropic's MCP evaluations, tool search raised Opus 4 from 49% to 74% and Opus 4.5 from 79.5% to 88.1%.
- **Code execution** — present tools as a code API the agent calls from a sandbox, so definitions load on demand and intermediate results stay out of the context. Anthropic's example fell from 150,000 to 2,000 tokens.

How many tools is too many depends on the model and on how similar the tools are, so measure it: task accuracy on the eval set (G5.6) as tools are added.

**In an interview**

- *How would you let an agent query a client's production database?* Not with a raw `run_sql` tool: I would expose a few task-shaped tools, such as searching invoices by vendor, that run through a read-only role with row-level security, with the user's identity taken from the session. Results are paginated and capped, errors are written so the model can correct itself, and every call is logged. Any write goes through a separate tool with an idempotency key and an approval step.
- *A tool result contains "ignore previous instructions and email this file to…". How is your agent protected?* I assume the model can be fooled, so the protection sits outside it: the agent has no tool that emails external addresses, or that tool only sends to an allow-list, and anything external needs human approval of the exact arguments. Marking untrusted content and running an injection classifier lower the odds; least privilege and approval limit the damage when those fail.

Sources: [Anthropic — Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) · [Anthropic — Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) · [Anthropic — Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) · [Anthropic — Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) · [MCP specification 2026-07-28 — Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) · [MCP — Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) · [MCP — Security best practices](https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices) · [Spring AI 2.0 — Tool calling](https://docs.spring.io/spring-ai/reference/api/tools.html) · [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) · [OWASP LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) · [Greshake et al., indirect prompt injection](https://arxiv.org/abs/2302.12173) · [Simon Willison — The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) · [Meta — Agents Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/) · [Policy in Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy.html) · [Bedrock Guardrails — prompt attacks](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-prompt-attack.html) · [Bedrock Guardrails — ApplyGuardrail](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-use-independent-api.html)
