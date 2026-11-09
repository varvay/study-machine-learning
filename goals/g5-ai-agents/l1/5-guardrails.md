---
title: Failure modes and guardrails
---

An agent fails differently from a single LLM call. It takes many steps, and each step builds on the ones before, so one early mistake carries into every later step. It also acts, so a mistake can change real data instead of only producing a wrong sentence. Four failures are the most common:

- **Loop** — the agent repeats a step without making progress, such as re-running a failing query with the same error, or cycling between two tools. Nothing in the loop forces an end; it stops only when the model decides to answer (G5.1).
- **Wrong tool** — the agent calls a tool that does not fit the step: `send_email` when the user asked for a draft, or web search for a figure that sits in the company database. The usual causes are vague or overlapping tool descriptions and too many tools to choose from (G5.4).
- **Invented arguments** — the right tool, called with values the model made up: a customer ID nobody gave it, a guessed date. The call is well formed, so it runs and returns data that looks right and is not. Anthropic's docs show the pattern: asked "What's the weather?" with no place given, a model may call `get_weather` with a guessed `"New York, NY"`.
- **Cost blow-up** — tokens, time, and money grow far past what the task is worth. Each call re-sends the whole context, so the total grows faster than the number of turns: in the G5.1 walkthrough, 5 model calls sent 30 messages. Loops multiply it. Anthropic measured agents using about 4 times the tokens of a chat, and a multi-agent system about 15 times (G5.3).

The harm a failure can do grows with what the agent is allowed to do. OWASP, a security nonprofit that publishes a top-10 risk list for LLM applications, calls this **excessive agency** and names three causes: tools the task does not need, permissions wider than it needs, and high-impact actions with no human check.

A **guardrail** is a check that runs outside the model and limits what the agent can do or catches a bad step before it takes effect. Code or a separate checker enforces it, so it holds even when the model errs or a prompt injection tricks it (text in the user's input or a tool result, written to pass as instructions to the model; G3.5 L1). A line in the system prompt such as "never delete data" is an instruction the model can fail to follow; a database user without delete rights is a guardrail.

Guardrails come in four kinds, each aimed at different failures:

| Kind | What it does | Catches |
|---|---|---|
| **Limits** | caps turns, time, tokens, or spend per task, then stops the agent | loops, cost blow-up |
| **Validation** | checks the input, each tool call's arguments, and the output against rules before they are used, such as "this customer ID exists" | invented arguments, off-topic or unsafe requests and answers |
| **Permissions** | gives the agent only the tools and access the task needs, such as read-only database access | wrong tool, excessive agency |
| **Human approval** | pauses before a risky action, such as a payment, an email, or a delete, until a person confirms it | any failure that reaches a risky action |

No single guardrail catches every failure, so a production agent combines several. G5.5 L2 builds each kind.

Sources: [Anthropic — Tool use with Claude](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) · [Anthropic — Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) · [Anthropic — Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) · [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) · [OWASP — LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) · [OpenAI Agents SDK — Guardrails](https://openai.github.io/openai-agents-python/guardrails/)
