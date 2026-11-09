---
title: Observability
---

Recap (G6.6 L1): an LLM app emits logs, metrics, and traces, and tracks latency, tokens, cost, quality, and user feedback. Here you wire the capstone to send traces to Langfuse, metrics to Prometheus and Grafana, and thumbs up / down back to both.

## Traces with OpenTelemetry

Spring AI records a **Micrometer observation** around every ChatClient call, advisor, model call, tool call, and vector store operation. Micrometer is Spring's instrumentation library, the code that measures what the app does: one observation produces both a timer metric and a trace span. Spring Boot 4 bridges these spans to OpenTelemetry and exports them over **OTLP**, OpenTelemetry's wire protocol, to any backend (a tool that stores and displays the signals) that accepts it.

Dependencies to add to the G6.2 app (versions come from the Spring Boot BOM):

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-opentelemetry</artifactId>
</dependency>
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
</dependency>
```

Configuration:

```yaml
management:
  tracing:
    sampling:
      probability: 1.0
  opentelemetry:
    tracing:
      export:
        otlp:
          endpoint: https://cloud.langfuse.com/api/public/otel/v1/traces
          headers:
            Authorization: Basic ${LANGFUSE_AUTH}
            x-langfuse-ingestion-version: "4"
  endpoints:
    web:
      exposure:
        include: health,prometheus
  metrics:
    distribution:
      percentiles-histogram:
        gen_ai.client.operation: true
```

- `sampling.probability: 1.0` traces every request. At high traffic, lower it, such as 0.1 for one request in ten, to cut cost.
- The OTLP `endpoint` and `headers` point the exporter at Langfuse (next section).
- `exposure.include` publishes `/actuator/prometheus` for Prometheus to scrape (pull on a schedule).
- `percentiles-histogram` makes the model-call timer publish histogram buckets, counts of calls per latency range, which the p95 query below needs.

One chat request then produces a trace like this:

```text
http post /api/chat                                   2.9 s
└─ spring.ai.chat.client (call)                        2.8 s
   ├─ spring.ai.advisor  MessageChatMemoryAdvisor
   ├─ spring.ai.advisor  QuestionAnswerAdvisor
   │  └─ db.vector.client  query (pgvector)            0.04 s
   │     └─ embedding  amazon.titan-embed-text-v2:0    0.12 s
   └─ chat  us.anthropic.claude-haiku-4-5-…            2.5 s
      gen_ai.usage.input_tokens=3120  gen_ai.usage.output_tokens=180
```

The span names and timings are illustrative (unsourced); the attributes are real. Spring AI puts OpenTelemetry's **GenAI semantic conventions** on the model spans: `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.request.temperature`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, and the cache counts `gen_ai.usage.cache_read.input_tokens` and `gen_ai.usage.cache_creation.input_tokens`. Those conventions are still marked *Development* and keep moving: Spring AI 2.0.1 tags the provider as `gen_ai.system`, while the current spec names it `gen_ai.provider.name`, so a backend may show either.

**Prompts and answers stay out of traces by default**, because they can hold personal data (G6.7). `spring.ai.chat.observations.log-prompt` and `log-completion` turn them on; Langfuse's Spring AI guide adds an `ObservationFilter`, a hook that edits each observation before export, that copies them into span attributes. Turn them on only after PII redaction.

## Langfuse

**Langfuse** is an open-source LLM observability platform: it stores traces, shows each request's spans with their prompts, tokens, cost, and latency, and attaches **scores** (quality judgments) to traces. It runs as a cloud service or self-hosted with Docker; the self-hosted version keeps prompts inside your network (G6.4).

It receives OpenTelemetry traces at `/api/public/otel` (traces at `/api/public/otel/v1/traces`), over OTLP HTTP only, not gRPC (a binary RPC protocol, OTLP's other transport). Authentication is HTTP Basic with the project's public key as user and secret key as password:

```bash
export LANGFUSE_AUTH=$(echo -n "pk-lf-…:sk-lf-…" | base64)
```

The `x-langfuse-ingestion-version: "4"` header makes traces appear in real time; without it, Langfuse's docs say they can arrive up to 10 minutes late. LangSmith, LangChain's hosted tracing platform, plays the same role.

## Metrics with Prometheus and Grafana

**Prometheus** is a time-series database that **scrapes**, pulls on a schedule, each app instance's metrics endpoint. **Grafana** draws dashboards and fires alerts from queries written in **PromQL**, Prometheus's query language. A scrape job for the app:

```yaml
scrape_configs:
  - job_name: docs-assistant
    metrics_path: /actuator/prometheus
    static_configs:
      - targets: ["docs-assistant:8080"]
```

Spring AI's meters (Micrometer's word for a metric) appear in Prometheus with dots turned into underscores. Labels are the key-value tags on each series, used to filter and group:

| Metric | Type | Labels |
|---|---|---|
| `gen_ai_client_operation_seconds_{count,sum,max}`, plus `_bucket` with the histogram setting | timer: each model call's duration | `gen_ai_operation_name`, `gen_ai_request_model`, … |
| `gen_ai_client_token_usage_total` | counter: tokens used | `gen_ai_token_type` = `input`, `output`, `total` |
| `db_vector_client_operation_seconds_{count,sum,max}` | timer: vector store operations | `db_operation_name`, `db_system` |

Four panels cover the essentials:

```text
# p95 model-call latency, per model
histogram_quantile(0.95, sum by (le, gen_ai_request_model) (rate(gen_ai_client_operation_seconds_bucket[5m])))

# tokens per minute, input vs output
sum by (gen_ai_token_type) (rate(gen_ai_client_token_usage_total{gen_ai_token_type!="total"}[5m])) * 60

# estimated dollars per hour, at Claude Haiku 4.5's US geo prices ($1.10 in, $5.50 out per million tokens, G6.8)
(sum(rate(gen_ai_client_token_usage_total{gen_ai_token_type="input"}[1h])) * 1.10
 + sum(rate(gen_ai_client_token_usage_total{gen_ai_token_type="output"}[1h])) * 5.50) * 3600 / 1e6

# share of thumbs-down answers over the last hour
sum(rate(assistant_feedback_total{rating="down"}[1h])) / sum(rate(assistant_feedback_total[1h]))
```

How to read them:

- `rate(counter[5m])` is the per-second increase over the last 5 minutes; multiplying by 60 or 3600 gives per minute or per hour.
- `histogram_quantile(0.95, …)` estimates the value under which 95% of calls fell, from the bucket counts. Summing `by (le, …)` (`le` is each bucket's upper bound) first combines all app instances, which is why the app must publish buckets rather than precomputed percentiles.
- The cost panel multiplies tokens by the list price and ignores cache discounts, so it slightly overstates when prompt caching is on. The Bedrock bill stays the source of truth; this panel catches a spike within minutes instead of at month end.

In Grafana, add Prometheus as a data source, make one panel per query, and add alert rules: for example, when p95 latency stays above 8 s for 10 minutes, or the thumbs-down share tops 20%. Those thresholds are examples to tune on your own traffic.

## Thumbs up / down

User feedback is only useful linked to the request it judges, so each answer carries its **trace ID**, the 32-hex-character ID shared by all spans of one request. In the G6.2 controller, add a `traceId` field to `ChatAnswer` and fill it from Micrometer's `Tracer`:

```java
String traceId = tracer.currentSpan().context().traceId();
return new ChatAnswer(response.getResult().getOutput().getText(), sources, traceId);
```

The UI shows thumbs-up and thumbs-down buttons under each answer and posts the verdict back with the trace ID. The app stores it three ways: in PostgreSQL for error analysis (G2.5), as a metric for the dashboard, and as a Langfuse score on the trace.

```sql
CREATE TABLE answer_feedback (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trace_id   char(32)    NOT NULL,
    helpful    boolean     NOT NULL,
    comment    text,
    created_at timestamptz NOT NULL DEFAULT now()
);
```

```java
@RestController
class FeedbackController {

    record Feedback(String traceId, boolean helpful, String comment) {}

    private final JdbcClient jdbc;
    private final MeterRegistry meters;
    private final RestClient langfuse;

    FeedbackController(JdbcClient jdbc, MeterRegistry meters, RestClient.Builder restClients,
            @Value("${langfuse.host}") String langfuseHost,
            @Value("${langfuse.public-key}") String publicKey,
            @Value("${langfuse.secret-key}") String secretKey) {
        this.jdbc = jdbc;
        this.meters = meters;
        this.langfuse = restClients.baseUrl(langfuseHost)
                .defaultHeaders(headers -> headers.setBasicAuth(publicKey, secretKey))
                .build();
    }

    @PostMapping("/api/feedback")
    void record(@RequestBody Feedback feedback) {
        jdbc.sql("INSERT INTO answer_feedback (trace_id, helpful, comment) VALUES (?, ?, ?)")
                .params(feedback.traceId(), feedback.helpful(), feedback.comment())
                .update();
        meters.counter("assistant.feedback", "rating", feedback.helpful() ? "up" : "down").increment();
        langfuse.post()
                .uri("/api/public/scores")
                .body(Map.of("traceId", feedback.traceId(), "name", "user-feedback",
                        "value", feedback.helpful() ? 1 : 0, "dataType", "BOOLEAN"))
                .retrieve()
                .toBodilessEntity();
    }
}
```

The Micrometer counter `assistant.feedback` becomes `assistant_feedback_total` in Prometheus, the series the dashboard's last panel reads. In Langfuse, filtering traces by `user-feedback = 0` lists every disliked answer with its prompt, chunks, and model, which is where error analysis starts, and each confirmed failure becomes a question in the evaluation set (G6.5).

Sources: [Spring AI observability (spans, attributes, meters, log-prompt)](https://docs.spring.io/spring-ai/reference/observability/index.html) · [Spring Boot — observability (observations give metrics and traces)](https://docs.spring.io/spring-boot/reference/actuator/observability.html) · [Spring Boot — tracing with OpenTelemetry and OTLP](https://docs.spring.io/spring-boot/4.0/reference/actuator/tracing.html) · [Spring Boot 4.0 application properties](https://docs.spring.io/spring-boot/4.0/appendix/application-properties/index.html) · [Spring Boot — metrics, Prometheus, histograms](https://docs.spring.io/spring-boot/4.0/reference/actuator/metrics.html) · [OpenTelemetry GenAI spans (Development status)](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md) · [GenAI attribute registry (`gen_ai.provider.name`)](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/registry/attributes/gen-ai.md) · [Langfuse — OpenTelemetry endpoint](https://langfuse.com/integrations/native/opentelemetry) · [Langfuse — Spring AI integration](https://langfuse.com/integrations/frameworks/spring-ai) · [Langfuse — scores](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk) · [Langfuse — user feedback](https://langfuse.com/docs/observability/features/user-feedback) · [Langfuse public API (`POST /api/public/scores`)](https://cloud.langfuse.com/generated/api/openapi.yml) · [Langfuse self-hosting](https://langfuse.com/self-hosting) · [LangSmith](https://docs.langchain.com/langsmith/home) · [Micrometer — Prometheus naming and timers](https://docs.micrometer.io/micrometer/reference/implementations/prometheus.html) · [Micrometer Tracing API](https://docs.micrometer.io/tracing/reference/api.html) · [Prometheus — `histogram_quantile`](https://prometheus.io/docs/prometheus/latest/querying/functions/) · [Grafana — Prometheus data source](https://grafana.com/docs/grafana/latest/datasources/prometheus/) · [Grafana alerting](https://grafana.com/docs/grafana/latest/alerting/) · [W3C Trace Context (trace ID format)](https://www.w3.org/TR/trace-context/)
