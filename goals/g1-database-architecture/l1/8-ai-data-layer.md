---
title: Data layer of an AI app
---

An AI app stores more than its documents. Each kind of data below has its own table, or set of tables, and its own job.

| Data | What it holds | Why the app needs it |
|---|---|---|
| Source documents | the original files and their versions | the ground truth that answers cite |
| Chunks and embeddings | passages cut from the documents, each with its vector | what retrieval searches |
| Conversations and messages | every user turn and model reply | context for the next reply, and an audit record |
| Agent memory | facts an agent keeps across sessions, such as "user prefers Java" | personalization without re-asking |
| Features | the input values x₁ … xₙ a machine-learning model reads, computed from raw data, such as a churn model's "orders in the last 30 days" | the same values in training and in production; a mismatch between them (**training-serving skew**) quietly degrades predictions |
| Eval results | quality scores for each model, prompt, and dataset version | proof that a change made answers better, not worse |
| Traces | each request's steps, with latency, tokens, and cost | debugging, cost tracking, and finding slow steps |

An LLM reads text, not features, so the features row matters when the app also runs a classic model, such as a churn score. A **feature store** is a service that computes each feature once and serves the same value to training and to production.

The capstone keeps all of them in PostgreSQL, with pgvector for the embeddings. Any of them can hold personal data, so each needs access control and a way to delete one person's data everywhere it was copied.
