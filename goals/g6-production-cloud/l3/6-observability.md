---
title: Observability
---

Traces and dashboards (L2) show what happened. Running a production LLM app also needs targets that say what "good" means in numbers, a link from every quality score to the request that earned it, and alarms that fire on quality before the client calls.

**Targets for an LLM app.** A **service level indicator (SLI)** is a measured quantity of the service, such as the share of requests answered within 2 seconds. A **service level objective (SLO)** is the target for it: 95% of them, over 28 days. An LLM app needs different SLIs from a classic API, because a streamed answer arrives over many seconds and its length varies:

- **Time to first token (TTFT)** — from the user's request to the first token on screen. For a streamed chat, this is the wait the user feels. It includes everything before the model starts writing: the guardrail check, embedding the question, the vector search, the model's queue, and its **prefill**, the pass over the whole prompt.
- **Time per output token (TPOT)**, also called inter-token latency — the gap between tokens while the answer streams. Its inverse is **output tokens per second (OTPS)**. It depends on the model and its load, not on the prompt.
- **End-to-end latency** — until the last token: TTFT + output tokens × TPOT. For non-streamed work, such as an agent step or a batch extraction, this is the SLI that matters.
- **Error and throttle rate** — the share of requests that fail or are throttled, counted separately, since throttling calls for a quota fix (G6.1) and errors for a code or provider fix.

Example targets for the G6.1 client, agreed with it rather than taken from a standard: TTFT p95 under 2.5 s; median OTPS above 30 tokens a second; errors under 0.5% a day. Three rules keep such targets honest:

- **Percentiles, never averages** — the mean hides the slow tail that users remember. Use p50 for the typical user and p95 or p99 for the tail.
- **Aggregate histograms, not percentiles** — the p95 of a fleet is not the average of each instance's p95. Record latency as histograms and compute percentiles over the merged data.
- **Budget with medians, verify with the tail** — the p95s of the steps do not add up to the p95 of the whole. Split the TTFT budget across the steps using medians, then check the p95 on the end-to-end trace.

| Step before the first token | Budget (p50) |
|---|---|
| input guardrail check | 150 ms |
| embed the question | 60 ms |
| vector search with ACL filter | 40 ms |
| build the prompt, load chat memory | 30 ms |
| model: queue and prefill of 3,500 tokens, network | 800 ms |
| **TTFT** | **≈ 1.1 s** (illustrative) |

A single end-to-end latency SLO fails for LLM apps: a question that deserves a 900-token answer takes longer than one that deserves 50, and a prompt change that lengthens answers raises latency with nothing broken. So alert on TTFT and OTPS, and track answer length as its own signal. Bedrock documents exactly this split: `InvocationLatency = TimeToFirstToken + OutputTokenCount / OTPS × 1000`, so OTPS computed from its CloudWatch metrics separates a slower model from longer answers, and a drop in OTPS is the signal to alarm on.

Where each number comes from:

- **Bedrock** publishes `TimeToFirstToken` (streaming operations only), `InvocationLatency`, `OutputTokenCount`, and `InvocationThrottles` per model ID in CloudWatch.
- **A self-hosted vLLM server** exports `vllm:time_to_first_token_seconds`, `vllm:inter_token_latency_seconds`, `vllm:e2e_request_latency_seconds`, and `vllm:num_requests_waiting`, whose growth is the first sign that the GPUs are saturated.
- **The app** measures what the user feels, including retrieval, which the provider cannot see. The OpenTelemetry GenAI conventions name client histograms `gen_ai.client.operation.time_to_first_chunk` and `gen_ai.client.operation.time_per_output_chunk`, still in Development status. Spring AI's `gen_ai.client.operation` measures the whole call, so record time to first chunk in a streaming advisor (G6.2).

**Linking traces to eval results.** Every quality signal is a score about one answer. It is useful only if it leads back to the full request: the prompt version, the retrieved chunks, the model, and the latency of each step.

- **One join key** — the trace ID, carried in every span, log line, and score, plus the release manifest ID (G6.5) as a span attribute. Then any score can be sliced by release, model, or retrieval setting.
- **Scores as records** — each score is a row keyed by trace ID: who scored (LLM judge, user, annotator, a person paid to label answers, or guardrail), which metric, the value, and when. Langfuse models this directly: scores attach to traces, observations, or sessions (the traces of one conversation, grouped), its online evaluators run LLM-as-a-judge on live traces, and its experiments score datasets offline. A table in the app's PostgreSQL does the same job (G1.8).
- **Offline runs produce traces too** — tag them `run=eval`. A failing eval case then opens the same trace view as a failing production request, and a production failure can be copied into the eval set with its context.
- **Sampling that keeps the interesting traces** — Spring Boot keeps 10% of traces by default, so most thumbs-downs would point to nothing. Send 100% of spans to an OpenTelemetry Collector and **tail-sample** there: decide per trace after it ends, keeping every error, every slow request, and a random share of the rest. All spans of a trace must reach the same collector instance for this to work.
- **Late signals** — a thumbs-down or a judge score arrives minutes after the trace was already kept or dropped. So the app writes a small record for every request (trace ID, release, token counts, latency) to its own store, and keeps prompts and answers for a short retention window, in an access-controlled store, since they contain personal data (G6.7). The score finds its request there even when the trace was sampled out.

**Catching quality regressions from production signals.** Production has no answer key, so quality is watched through proxies, each with its own delay and noise:

| Signal | What a change in it suggests | Speed and noise |
|---|---|---|
| LLM-judge pass rate on a sample (groundedness, relevance) | the answers got worse | minutes; noisy at small samples (G6.5) |
| Guardrails contextual-grounding interventions (the filter that blocks an answer its sources do not support) | answers drift from their sources | real time; per request |
| "I don't know" and refusal rate | retrieval stopped finding documents: a stale or broken index, a filter bug | real time; clear |
| Top retrieval similarity score, its distribution | questions on new topics (drift, G2.6) or an embedding mismatch | real time; clear |
| Output tokens per answer | a prompt or model change lengthened answers; latency and cost follow | real time; clear |
| Thumbs-down rate, rephrased questions, requests for a human | users are not getting what they need | hours; sparse, few users click |

How to act on them:

- **Compare with a baseline, per segment** — the same weekday last week, per topic cluster and per release. A 3-point drop across all traffic can be a 20-point drop on one document type.
- **Alert on sustained deviation** — require several consecutive windows outside the band (Bedrock's own OTPS guide suggests 3 out of 5 datapoints), so one noisy window does not page anyone (wake the on-call engineer).
- **Annotate changes** — mark releases, index syncs, and provider model changes on the dashboards. Most regressions line up with a change; a pinned model version removes the provider-side changes from the list.
- **Close the loop** — alert, then slice by release and topic, open the failing traces, run error analysis (G2.5), fix, and add the failing questions to the eval set so the gate (G6.5) blocks the same regression next time.

Sources: [Google SRE book — Service level objectives](https://sre.google/sre-book/service-level-objectives/) · [Databricks — LLM inference performance engineering](https://www.databricks.com/blog/llm-inference-performance-engineering-best-practices) · [Bedrock runtime metrics](https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-runtime-metrics.html) · [Bedrock — diagnose latency with OTPS](https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-runtime-otps.html) · [vLLM metrics](https://docs.vllm.ai/en/latest/design/metrics.html) · [OpenTelemetry GenAI metrics](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md) · [Spring AI observability](https://docs.spring.io/spring-ai/reference/observability/index.html) · [Spring Boot tracing (sampling default)](https://docs.spring.io/spring-boot/reference/actuator/tracing.html) · [OpenTelemetry Collector tail sampling processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md) · [Langfuse evaluation overview](https://langfuse.com/docs/evaluation/overview) · [Bedrock Guardrails contextual grounding](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-components.html)

**In an interview**

- *What latency SLOs would you set for a RAG chatbot, and why not just p95 end-to-end?* I would set time to first token at p95, because with streaming that is the wait users feel, and output tokens per second at the median, because it shows whether the model itself slowed down. End-to-end latency grows with answer length, so it alarms on a harmless prompt change and cannot tell a slow model from a longer answer. I would budget TTFT across the steps with medians and check the p95 on the full trace.
- *Users say answers got worse this week, but nothing failed. How do you find out why?* I would start from the scores tied to traces: the judge pass rate and refusal rate by release, by topic, and by day, compared with last week. If the drop sits in one topic, I check the index for that source, since stale or missing documents are the usual cause; if it starts at a release, I compare its manifest with the previous one. Then I pull the failing traces for error analysis and add them to the eval set.
