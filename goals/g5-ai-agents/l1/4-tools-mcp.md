---
title: Tools and MCP
---

**Tool calling**, also called **function calling**, is a model API feature: the application sends tool definitions with its request, and the model can reply with a structured call to one of them in place of text. It is the "act" step of the agent loop (G5.1).

A **tool definition** has three parts:

- **name** — what the call refers to, such as `get_weather`;
- **description** — what the tool does and when to use it. The model picks tools by reading these, and Anthropic's docs call the description by far the most important factor in how well a tool gets used;
- **input schema** — the parameters, their types, and which are required, written in JSON Schema, a standard JSON format for describing what a JSON object must contain. A `get_weather` tool takes one required string, `location`.

One round trip, in Anthropic's API:

1. The application sends the question and the tool definitions.
2. The model replies with `stop_reason: "tool_use"` (the field that says why the model stopped writing) and a `tool_use` block that holds the tool's name and its arguments, such as `{"location": "San Francisco, CA"}`.
3. The application runs its own function and sends the output back in a `tool_result` block.
4. The model answers from the result, or calls another tool.

The model only proposes the call. Running it, and checking that it is allowed, is the application's job (G5.5).

Without a standard, every AI application wires up every tool its own way, and a tool built for one app must be rebuilt for the next. **MCP** (Model Context Protocol) is an open standard for connecting AI applications to external systems: data sources, tools, and prompt templates. A service wrapped once as an MCP server works in any application that speaks MCP, such as Claude, ChatGPT, and the code editors VS Code and Cursor. Its documentation compares it to a USB-C port. MCP messages are JSON-RPC 2.0 requests and responses: JSON-RPC is a small standard for asking another program to run a named method, sent as JSON.

MCP has three participants:

- **Host** — the AI application the user works in, such as Claude Desktop, VS Code, or a Spring AI app (Spring AI is a Java framework for building LLM applications; G6.2 L1). It runs the model, keeps the conversation, and decides which servers to connect and what the user must approve.
- **Client** — a connector inside the host that holds the connection to exactly one server. A host that uses three servers runs three clients.
- **Server** — a program that offers capabilities to clients. It runs as a local process, such as a filesystem server on the user's machine, or as a remote service, such as the server of Sentry, an error-monitoring service. A server sees only what the host sends it, never the whole conversation.

A server offers three kinds of capability, its **primitives**. They differ in who decides to use each one:

| Primitive | What it is | Who decides to use it | Example, from a database server |
|---|---|---|---|
| **Tools** | functions that act or fetch data | the model | `query`: run a read-only SQL query |
| **Resources** | data that adds context | the application | the schema of each table |
| **Prompts** | reusable message templates | the user, such as through a slash command (a command typed after `/` in the chat box) | `/revenue-report`: a prompt with example queries |

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 310" role="img" aria-labelledby="tools-mcp-title">
<title id="tools-mcp-title">An MCP host holding the model, the conversation, and two clients; each client connects to one server, a local Postgres server offering a tool, a resource and a prompt, and a remote exchange-rate server offering one tool</title>
<rect class="table-body" x="20" y="40" width="300" height="260" rx="8" />
<rect class="fact-head" x="20" y="40" width="300" height="30" rx="8" />
<rect class="fact-head" x="20" y="58" width="300" height="12" />
<rect class="table-outline" x="20" y="40" width="300" height="260" rx="8" />
<text class="table-name" x="32" y="60">host: the AI application</text>
<rect class="fold-test" x="40" y="90" width="110" height="40" rx="8" /><text class="table-name" x="95" y="115" text-anchor="middle">LLM</text>
<rect class="fold-train" x="170" y="90" width="130" height="40" rx="8" /><text x="235" y="115" text-anchor="middle">conversation</text>
<text class="note" x="235" y="150" text-anchor="middle">full history stays here</text>
<path class="key-link" d="M95,130 L95,263 L180,263 M95,197 L180,197 M173,192 L180,197 L173,202 M173,258 L180,263 L173,268" />
<text class="key-tag" x="103" y="168">tool calls</text>
<rect class="fold-train" x="180" y="180" width="120" height="34" rx="8" /><text x="240" y="202" text-anchor="middle">client 1</text>
<rect class="fold-train" x="180" y="246" width="120" height="34" rx="8" /><text x="240" y="268" text-anchor="middle">client 2</text>
<path class="key-link" d="M300,197 C370,197 370,105 440,105" />
<path class="key-link" d="M300,263 C370,263 370,245 440,245" />
<text class="key-tag" x="380" y="206" text-anchor="middle">JSON-RPC</text>
<text class="key-tag" x="380" y="222" text-anchor="middle">one client per server</text>
<rect class="table-body" x="440" y="40" width="300" height="130" rx="8" />
<rect class="dimension-head" x="440" y="40" width="300" height="30" rx="8" />
<rect class="dimension-head" x="440" y="58" width="300" height="12" />
<rect class="table-outline" x="440" y="40" width="300" height="130" rx="8" />
<text class="table-name" x="452" y="60">Postgres MCP server</text><text class="key-tag" x="728" y="60" text-anchor="end">local process</text>
<text class="key-column" x="452" y="96">tool</text><text x="530" y="96">query(sql)</text><text class="key-tag" x="728" y="96" text-anchor="end">model decides</text>
<text class="key-column" x="452" y="124">resource</text><text x="530" y="124">table schemas</text><text class="key-tag" x="728" y="124" text-anchor="end">app decides</text>
<text class="key-column" x="452" y="152">prompt</text><text x="530" y="152">/revenue-report</text><text class="key-tag" x="728" y="152" text-anchor="end">user decides</text>
<rect class="table-body" x="440" y="210" width="300" height="72" rx="8" />
<rect class="dimension-head" x="440" y="210" width="300" height="30" rx="8" />
<rect class="dimension-head" x="440" y="228" width="300" height="12" />
<rect class="table-outline" x="440" y="210" width="300" height="72" rx="8" />
<text class="table-name" x="452" y="230">FX rates MCP server</text><text class="key-tag" x="728" y="230" text-anchor="end">remote service</text>
<text class="key-column" x="452" y="266">tool</text><text x="530" y="266">convert_currency</text><text class="key-tag" x="728" y="266" text-anchor="end">model decides</text>
</svg>
</div>
<figcaption>The host (Claude Desktop, VS Code, or a Spring AI app) runs one client per server. Each server lists its primitives; the host merges all servers' tools into one list for the model and routes each tool call to the client of the server that owns it.</figcaption>
</figure>

How a tool call travels through MCP:

1. Each client asks its server for its tools (`tools/list`), and the host merges them into the tool definitions it sends the model.
2. The model replies with a tool call, as in any tool calling.
3. The host passes the call to the client of the server that owns the tool, which sends `tools/call` with the name and arguments.
4. The server runs the tool and returns the result, which the host adds to the conversation as the observation.

So MCP changes where tools live and how they are found, not the agent loop: the model still sees tool definitions and still replies with tool calls.

Sources: [Anthropic — Tool use with Claude](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) · [Anthropic — Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) · [MCP — What is MCP?](https://modelcontextprotocol.io/docs/getting-started/intro) · [MCP — Architecture overview](https://modelcontextprotocol.io/docs/learn/architecture) · [MCP specification, version 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
