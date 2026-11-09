---
title: Agent memory
---

**Agent memory** is the information an agent can draw on beyond its model's training. The model itself keeps nothing between calls (G5.1), so every kind of memory is data the application stores and puts back in front of the model. It comes in two kinds, by where it lives and how long it lasts.

- **Short-term memory** — the **context**: the messages sent with each model call, from the system prompt to the latest tool result. It lasts one conversation, often called a **session** or **thread**. It has a hard size limit, the model's **context window**, counted in tokens (G3.2). A call that exceeds it fails, and many models answer worse over long contexts even inside the limit. So the application trims a long conversation: it drops or summarizes the oldest turns.
- **Long-term memory** — an external store, such as a database table or a vector store (a database that finds stored items by similarity of meaning; G1.7 L1), that outlives the conversation. A later conversation can read what an earlier one saved. The model only sees what the application retrieves from the store into the context, so recall works like RAG (retrieval-augmented generation: fetch the relevant passages and add them to the prompt) over the agent's own history (G1.7).

Long-term memory gets written in one of two ways:

- **The application** extracts facts after a conversation, such as "the user prefers Java", and saves them.
- **The agent** calls a memory tool that saves and reads notes. Anthropic's memory tool is one example: Claude, Anthropic's model, asks for file operations under a `/memories` path, and the application runs them on storage it controls.

Long-term memory splits further by what it holds. The names come from cognitive science:

| Kind | What it holds | Agent example | How it is used |
|---|---|---|---|
| **Semantic** | facts | "the user prefers Java"; "the fiscal year starts in April" | added to the context, so answers fit the user without asking again |
| **Episodic** | experiences: what happened, and when | last week's run, where the revenue query failed until it filtered on `created_at` | recalled as an example when a similar task comes up |
| **Procedural** | how to act | the system prompt, the agent's code, the model's weights (the numbers it learned in training; G2.4 L1) | shapes every run; changing it changes the agent's behavior |

Semantic memory answers "what do I know?"; episodic memory answers "what happened last time?". A support agent that remembers a customer's plan uses semantic memory. One that remembers how it solved that customer's last ticket uses episodic memory.

In the data layer (G1.8), each kind is a table:

- **short-term** — the conversations and messages tables; each call loads the current thread's messages;
- **semantic** — an agent-memory table, one row per fact, keyed by user, often with an embedding (a vector of numbers that encodes the text's meaning; G1.7 L1) to find facts by meaning;
- **episodic** — past messages and traces (step-by-step records of past runs; G5.6), searched by similarity to the current task.

Each row belongs to one user, and retrieval filters by that user before it searches, so one user's memories never reach another's context.

Sources: [LangChain — Memory overview](https://docs.langchain.com/oss/python/concepts/memory) · [Sumers et al., Cognitive Architectures for Language Agents (CoALA)](https://arxiv.org/abs/2309.02427) · [Anthropic — Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
