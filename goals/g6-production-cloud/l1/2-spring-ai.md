---
title: Spring AI
---

**Spring AI** is a framework for building AI applications in Java with Spring Boot, the Java framework that sets up a ready-to-run service from its dependencies and a properties file. It puts one portable API in front of many model providers, vector stores (databases that find the stored vectors closest to a query's; G1.7), and tools, so switching from OpenAI to Amazon Bedrock changes a dependency and some configuration, not the app's code. It fills the role the Python frameworks LangChain and LlamaIndex fill for LLM apps. The reference docs show version 2.0.1 as the stable release.

Why not call a provider's SDK (its own client library) directly? Each SDK has its own request format, and the patterns every LLM app needs (conversation memory, RAG, the tool-calling loop, parsing answers into objects, metrics) would be rewritten for each provider. Spring AI implements them once, as Spring beans (objects Spring creates and hands to the code that needs them) that a **Boot starter** (a dependency that auto-configures a feature from properties) sets up.

Its core parts:

- **ChatModel** — the interface to one provider's chat model. Each provider has a starter that creates it: Amazon Bedrock (through Bedrock's Converse API, one request format for all its chat models), Anthropic, OpenAI, Ollama (a tool that runs open-weight models on your own machine), and others.
- **ChatClient** — the fluent API the app calls, one built from chained method calls. It builds a prompt from a system message (the app's standing instructions to the model; G3.5) and a user message, sends it through the advisors to the ChatModel, and returns the answer: `chatClient.prompt().user("Tell me a joke").call().content()`. `call()` waits for the whole answer; `stream()` returns it piece by piece as it is generated (G6.8).
- **Advisor** — a component that wraps every ChatClient call: it can change the request on its way to the model and the response on its way back. Advisors form a chain, and the first to see the request is the last to see the response. Built-in ones:
  - `MessageChatMemoryAdvisor` — adds the conversation's earlier messages to the prompt. A model is **stateless**: it remembers nothing between calls, so memory is the app's job. The messages live in a `ChatMemory`, by default a window of the last 20, kept in memory or in a database.
  - `QuestionAnswerAdvisor` — RAG: searches a vector store with the user's question and adds the closest chunks to the prompt (G1.7). `RetrievalAugmentationAdvisor` builds the same flow from swappable steps.
  - `ToolCallingAdvisor` — runs the tool-calling loop described below. ChatClient adds it automatically.
  - `SimpleLoggerAdvisor` — logs each request and response, for debugging.
- **VectorStore** — the interface to a vector database. `add` stores documents (embedding them first with an `EmbeddingModel`, the interface to a model that turns text into a vector), `delete` removes them, and `similaritySearch` returns the documents nearest a query: the top k (4 by default), optionally above a similarity threshold and matching a metadata filter (a condition on fields stored with each document, such as its source or date). It has 20+ implementations, including `PgVectorStore` for PostgreSQL with pgvector (the PostgreSQL extension that stores and searches vectors; G1.7), the capstone's store.
- **Tool calling** — letting the model ask the app to run a function, such as looking up an order. A Java method annotated `@Tool(description = "…")` becomes a tool, and its description and parameters are sent to the model. The loop: the model replies with a tool name and arguments instead of an answer → the app runs the method → the result goes back to the model → repeat until the model answers. The model never runs code or reaches an API itself; the app does, so the app controls what the model can touch (G6.7).
- **MCP (Model Context Protocol)** — an open protocol for offering tools, data, and prompt templates to AI apps through one standard interface, so a tool written once works in any app that speaks MCP (G5.4). Spring AI has starters for both sides: the MCP client starter lets the app use tools from MCP servers, and the MCP server starters expose the app's own methods as tools to other apps.

Beyond these, Spring AI maps answers into Java records (structured output), loads documents into a vector store (its ETL pipeline: extract, transform, load; G6.3), and emits metrics and traces, the numbers and per-request records that monitoring reads (G6.6).

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 215" role="img" aria-labelledby="spring-ai-call-title">
<title id="spring-ai-call-title">One ChatClient call: the request passes through a memory advisor, a RAG advisor, and a tool advisor to the ChatModel; each advisor uses its own resource below it</title>
<text class="note" x="6" y="24">the request passes left to right; the response returns right to left through the same advisors</text>
<path class="key-link" d="M102,68 H116 M276,68 H290 M450,68 H464 M624,68 H638" />
<rect class="fold-test" x="6" y="40" width="96" height="56" rx="8" /><text class="table-name" x="54" y="64" text-anchor="middle">ChatClient</text><text class="key-tag" x="54" y="82" text-anchor="middle">your code calls</text>
<rect class="fold-train" x="116" y="40" width="160" height="56" rx="8" /><text class="table-name" x="196" y="64" text-anchor="middle">memory advisor</text><text class="key-tag" x="196" y="82" text-anchor="middle">MessageChatMemoryAdvisor</text>
<rect class="fold-train" x="290" y="40" width="160" height="56" rx="8" /><text class="table-name" x="370" y="64" text-anchor="middle">RAG advisor</text><text class="key-tag" x="370" y="82" text-anchor="middle">QuestionAnswerAdvisor</text>
<rect class="fold-train" x="464" y="40" width="160" height="56" rx="8" /><text class="table-name" x="544" y="64" text-anchor="middle">tool advisor</text><text class="key-tag" x="544" y="82" text-anchor="middle">ToolCallingAdvisor</text>
<rect class="fold-test" x="638" y="40" width="116" height="56" rx="8" /><text class="table-name" x="696" y="64" text-anchor="middle">ChatModel</text><text class="key-tag" x="696" y="82" text-anchor="middle">one per provider</text>
<path class="key-link" d="M196,96 V150 M370,96 V150 M544,96 V150 M696,96 V150" />
<rect class="fold-train" x="126" y="150" width="140" height="50" rx="8" /><text class="table-name" x="196" y="171" text-anchor="middle">ChatMemory</text><text class="key-tag" x="196" y="189" text-anchor="middle">earlier messages</text>
<rect class="fold-train" x="300" y="150" width="140" height="50" rx="8" /><text class="table-name" x="370" y="171" text-anchor="middle">VectorStore</text><text class="key-tag" x="370" y="189" text-anchor="middle">PgVectorStore</text>
<rect class="fold-train" x="474" y="150" width="140" height="50" rx="8" /><text class="table-name" x="544" y="171" text-anchor="middle">tools</text><text class="key-tag" x="544" y="189" text-anchor="middle">@Tool methods, MCP</text>
<rect class="fold-train" x="638" y="150" width="116" height="50" rx="8" /><text class="table-name" x="696" y="171" text-anchor="middle">provider API</text><text class="key-tag" x="696" y="189" text-anchor="middle">Bedrock, Ollama…</text>
</svg>
</div>
<figcaption>One ChatClient call with three advisors. Each advisor adds what it owns to the request, such as earlier messages or retrieved chunks. Only the ChatModel knows which provider answers, which is what makes the rest portable.</figcaption>
</figure>

Sources: [Spring AI reference — overview](https://docs.spring.io/spring-ai/reference/) · [ChatClient API](https://docs.spring.io/spring-ai/reference/api/chatclient.html) · [Chat Model API](https://docs.spring.io/spring-ai/reference/api/chatmodel.html) · [Advisors API](https://docs.spring.io/spring-ai/reference/api/advisors.html) · [Chat Memory](https://docs.spring.io/spring-ai/reference/api/chat-memory.html) · [Vector Databases](https://docs.spring.io/spring-ai/reference/api/vectordbs.html) · [Tool Calling](https://docs.spring.io/spring-ai/reference/api/tools.html) · [MCP overview](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-overview.html) · [Structured Output](https://docs.spring.io/spring-ai/reference/api/structured-output.html) · [ETL Pipeline](https://docs.spring.io/spring-ai/reference/api/etl-pipeline.html) · [Observability](https://docs.spring.io/spring-ai/reference/observability/index.html)
