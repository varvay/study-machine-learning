---
title: Cost and latency
---

An LLM request's cost and latency come from four sources:

- **Tokens** — the pieces of text a model reads and writes, about 4 characters or 0.75 English words each. Model APIs bill input and output tokens separately, per million, and output costs more: Claude Sonnet 5.5 lists at $2 per million input tokens and $10 per million output tokens. Time follows the same split. The model reads the whole prompt in one parallel pass, then writes the answer one token at a time, each token depending on the ones before. So a long prompt mainly delays the first token, and a long answer stretches everything after it.
- **Model size** — a larger model, with more parameters (the learned weights; G2.4), computes more per token, so it costs more and writes more slowly. Claude Haiku 4.5 lists at $1 / $5 per million input / output tokens, Claude Opus 5.5 at $4 / $20. A small model is often enough for a simple step, such as classifying a question or rewriting a search query.
- **Network** — every call to a remote service adds a round trip, more for a distant region. A RAG answer makes several calls in sequence (the embedding API, the database, the model), so their round trips add up.
- **Retrieval** — the vector search and any reranking (a second, more precise scoring of the chunks found, to keep only the best). With an index it takes milliseconds (G1.7), but the chunks it returns become input tokens, so the number of chunks (top-k) and their size set most of the prompt's length, and with it much of the bill.

Some costs are fixed, whatever the traffic: the vector database's servers, and any self-hosted model endpoint, bill by the hour (G6.1).

Two latencies matter:

- **Time to first token (TTFT)** — from sending the request to receiving the first token. It covers the network, any queue at the provider, and reading the prompt.
- **End-to-end latency** — until the last token arrives: TTFT + time per output token × (output tokens − 1).

When the answer **streams** (is shown token by token as it is written), the user starts reading at TTFT, so TTFT is the wait they feel. The walkthrough below follows one question through a RAG app and adds up where its time and money go.

Sources: [Anthropic — pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [Modular — LLM inference metrics](https://handbook.modular.com/llm-inference-basics/llm-inference-metrics) · [OpenAI — pricing (embedding price in the walkthrough)](https://developers.openai.com/api/docs/pricing)
