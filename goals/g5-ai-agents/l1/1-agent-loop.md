---
title: The agent loop
---

An **agent** is an LLM (large language model: a model that reads text and writes the next words of a reply; G3.1 L1) that calls tools in a loop until a task is done. A plain LLM call turns one prompt into one reply. An agent can also act: run a query, search, send an email. It reads what came back before it decides the next step.

- **Tool** — a function the application offers the model, such as `sql_query` or `convert_currency`. The model sees each tool's name, a description of what it does, and its parameters (G5.4). The application decides which tools exist; the model decides which one to call, from their descriptions.
- **Tool call** — a model reply that names a tool and the arguments to call it with, in place of an answer. The model never runs the tool itself. The application runs it and sends the result back to the model as a new message.

Each turn of the loop has three parts:

1. **Reason** — the model reads everything so far and works out what it still needs.
2. **Act** — it replies with a tool call.
3. **Observe** — the application runs the tool and adds the result to the conversation. That result is the **observation**, and the next turn reasons over it.

The loop ends when the model replies with plain text and no tool call: that text is the answer. A model can also keep calling tools without end, so the application caps the number of turns too (G5.5).

The model keeps nothing between calls. Every call sends the whole conversation again: the system prompt (the application's standing instructions to the model, sent before the user's messages; G3.5 L1), the question, each tool call, and each result. That growing list of messages is the agent's **context**, its short-term memory (G5.2). Each turn adds to it, so each call is slower and costs more than the one before; API pricing counts every input token (a token is a word or piece of a word, the unit a model reads and is billed by; G3.1 L1), tool calls and tool results included.

**ReAct** (Reason + Act) is the pattern behind this loop, from a 2022 paper. Before each action the model writes a short reasoning step, then reads the observation the action returns.

- The reasoning helps it plan, track progress, and handle errors, such as a failed query.
- The observations ground it in real data. On question answering with a Wikipedia search tool, ReAct made fewer invented facts than reasoning alone (**chain-of-thought**, where the model writes out its reasoning but never looks anything up).

In the paper, the model wrote its steps as plain text lines (Thought, Action, Observation) that the program parsed. Model APIs now return a tool call as structured data, such as a `tool_use` block in Anthropic's API, and the loop is the same.

The walkthrough below runs one question through the loop. The model queries a database, reads the result, converts the currency, and answers. Try the example with failed queries to watch the model fix its own SQL from the error text.

Sources: [Yao et al., ReAct paper](https://arxiv.org/abs/2210.03629) · [Anthropic — Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) · [Anthropic — Tool use with Claude](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
