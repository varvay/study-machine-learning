---
title: Observability
---

**Observability** is the ability to tell what a running system is doing, and why, from the data it emits. That data comes as three kinds of **signals**:

- **Logs** — timestamped records of single events: "request 42 failed: timeout calling the model".
- **Metrics** — numbers aggregated over time: requests per second, the error rate, or the **p95 latency**, the time that 95% of requests finish within.
- **Traces** — the path of one request through the system, as a tree of **spans**. A span is one operation, such as the embedding call, the retrieval, the model call, or a tool call, with its start time, duration, and attributes. A trace shows which step made a slow request slow, which a metric averaged over all requests cannot.

**OpenTelemetry** is the open standard for emitting all three to any monitoring tool. Its conventions for generative AI name the attributes of a model call, such as `gen_ai.request.model`, `gen_ai.usage.input_tokens`, and `gen_ai.usage.output_tokens`, so every tool reads them the same way. Spring AI records metrics and traces for its ChatClient, advisor, model, tool, and vector store calls, including a token-usage metric, `gen_ai.client.token.usage` (G6.2).

What an LLM app tracks, and why:

- **Latency** — the total time, and the **time to first token**: how long until the first word appears, which is the wait a user feels when the answer streams (G6.8). Tracked per span, to find the slow step.
- **Tokens** — input and output tokens per request. They drive both cost and latency, and a sudden rise flags a bug, such as an agent stuck in a loop or a prompt that grew by accident.
- **Cost** — tokens × each model's price, summed per request, per user, and per feature, so a budget alert fires before the invoice arrives.
- **Quality** — whether the answers are good. Production has no answer key, so quality is estimated: an LLM judge scores a sample of traces, for example on whether each answer is supported by the retrieved chunks, and the app watches signals such as the share of "I don't know" answers.
- **User feedback** — explicit, such as a thumbs up or down or a correction, and implicit, such as the user rephrasing the same question or asking for a human. Each is stored with its trace, so a thumbs-down leads straight to the prompt, the chunks, and the model version that produced the answer. That is the input to error analysis (G2.5) and to the feedback stage (G6.3).

Prompts and answers in traces can hold personal data (G6.7). For that reason Spring AI leaves prompt and completion content out of its observations by default.

Sources: [OpenTelemetry — signals](https://opentelemetry.io/docs/concepts/signals/) · [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai) · [Spring AI observability](https://docs.spring.io/spring-ai/reference/observability/index.html)
