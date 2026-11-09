---
title: Spring AI
---

Before the L2 app faces real users, it needs its own advisors, streaming that fails cleanly, telemetry, and limits on time, retries, and spend. Everything here is Spring AI 2.0.1, the version the reference docs show, which runs on Spring Boot 4.0 and 4.1.

**How the advisor chain runs.** An advisor implements `CallAdvisor` for `call()`, `StreamAdvisor` for `stream()`, or both:

```java
public interface CallAdvisor extends Advisor {
    ChatClientResponse adviseCall(ChatClientRequest chatClientRequest, CallAdvisorChain callAdvisorChain);
}

public interface StreamAdvisor extends Advisor {
    Flux<ChatClientResponse> adviseStream(ChatClientRequest chatClientRequest, StreamAdvisorChain streamAdvisorChain);
}
```

- **Order** — `getOrder()` sorts the chain, and the chain is a stack: the lowest order sees the request first and the response last. `Ordered.HIGHEST_PRECEDENCE` goes first.
- **Built-in orders** — `MessageChatMemoryAdvisor` defaults to `HIGHEST_PRECEDENCE + 200` and `QuestionAnswerAdvisor` to 0. So by default memory runs before RAG, and the memory stores the user's own words, not the question with the retrieved chunks appended. Give a memory advisor a higher order than the RAG advisor, and every stored turn carries its chunks, so the history balloons.
- **Context** — `ChatClientRequest` is a record of a `Prompt` and a `context` map. Values passed with `.advisors(a -> a.param(key, value))` land in that map; an advisor reads them there and changes the request through `mutate()`.
- **The `BaseAdvisor` shortcut** — it splits the work into `before(request, chain)` and `after(response, chain)`. Two details matter when streaming. `before` runs on Reactor's `boundedElastic` scheduler, a thread pool meant for blocking work, so blocking I/O inside it is safe. And `after` runs only on the chunk that carries the finish reason (the field saying why generation stopped), so it never sees the whole answer.

**A custom advisor: a token budget per tenant.** A consulting platform serves several client teams, and each has a monthly token allowance. The check belongs in an advisor: every call passes through it, whatever code builds the prompt.

```java
public final class TokenBudgetAdvisor implements CallAdvisor, StreamAdvisor {

    public static final String TENANT_ID = "tenant_id";

    private final TokenBudget budget;

    public TokenBudgetAdvisor(TokenBudget budget) {
        this.budget = budget;
    }

    @Override
    public String getName() {
        return "TokenBudgetAdvisor";
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }

    @Override
    public ChatClientResponse adviseCall(ChatClientRequest request, CallAdvisorChain chain) {
        String tenantId = tenantOf(request);
        budget.ensureRemaining(tenantId);
        ChatClientResponse response = chain.nextCall(request);
        charge(tenantId, response);
        return response;
    }

    @Override
    public Flux<ChatClientResponse> adviseStream(ChatClientRequest request, StreamAdvisorChain chain) {
        String tenantId = tenantOf(request);
        return Mono.fromRunnable(() -> budget.ensureRemaining(tenantId))
            .subscribeOn(Schedulers.boundedElastic())
            .thenMany(new ChatClientMessageAggregator()
                .aggregateChatClientResponse(chain.nextStream(request), response -> charge(tenantId, response)));
    }

    private static String tenantOf(ChatClientRequest request) {
        if (request.context().get(TENANT_ID) instanceof String tenantId) {
            return tenantId;
        }
        throw new IllegalArgumentException("Every call must pass the advisor param " + TENANT_ID);
    }

    private void charge(String tenantId, ChatClientResponse response) {
        ChatResponse chatResponse = response.chatResponse();
        if (chatResponse == null) {
            return;
        }
        Usage usage = chatResponse.getMetadata().getUsage();
        budget.charge(tenantId, usage.getPromptTokens(), usage.getCompletionTokens());
    }
}
```

```java
ChatClient chatClient = chatClientBuilder
    .defaultAdvisors(
        new TokenBudgetAdvisor(tokenBudget),
        MessageChatMemoryAdvisor.builder(chatMemory).build(),
        QuestionAnswerAdvisor.builder(vectorStore)
            .searchRequest(SearchRequest.builder().topK(5).similarityThreshold(0.6).build())
            .build())
    .build();

String answer = chatClient.prompt()
    .user(question)
    .advisors(a -> a.param(TokenBudgetAdvisor.TENANT_ID, tenantId)
        .param(ChatMemory.CONVERSATION_ID, conversationId))
    .call()
    .content();
```

The design choices, each with its reason:

- **Highest precedence** — an over-budget tenant is rejected before the retrieval runs, so a rejected call costs nothing, and the advisor is last to see the response, after every other advisor.
- **Both interfaces, not `BaseAdvisor`** — in a stream, `after` sees only the last chunk. `ChatClientMessageAggregator` passes every chunk through to the caller untouched, then hands the advisor one response assembled from all of them, with the usage the provider reported.
- **The blocking check moved off the stream thread** — `ensureRemaining` reads a database. `subscribeOn(Schedulers.boundedElastic())` runs it on a thread pool meant for blocking work.
- **The budget is soft** — the check runs before the call, and the charge after it. Ten parallel calls can each pass the check and overshoot together. A hard limit reserves an estimate before the call (input tokens plus `max_tokens`, the way Bedrock does, G6.1) and settles after.

**Streaming with Reactor.** `stream().content()` returns a `Flux<String>`, and a Spring MVC controller can return it directly as server-sent events. The user arrives as a `Jwt`, the signed login token from the identity provider, whose `tenant` claim names the team:

```java
@GetMapping(value = "/ask", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
Flux<String> ask(@RequestParam String question, @AuthenticationPrincipal Jwt user) {
    return chatClient.prompt()
        .user(question)
        .advisors(a -> a.param(TokenBudgetAdvisor.TENANT_ID, user.getClaimAsString("tenant")))
        .stream()
        .content()
        .timeout(Duration.ofSeconds(15))
        .onErrorResume(TimeoutException.class, timeout -> Flux.just("[the answer took too long, please retry]"));
}
```

What can go wrong, and what handles it:

- **A stalled stream** — `Flux.timeout(Duration)` fails when no item arrives within the duration of the previous one, or of the subscription (the moment the caller starts listening) for the first. So one setting bounds both the time to first token and any gap between tokens. It does not bound the total length; cap that with `max_tokens`.
- **The user leaves** — the Servlet API (the Java web standard Spring MVC runs on) gives no notice of a disconnect; the server learns it when the next write fails. Tokens flowing are writes, so a disconnect mid-answer cancels the subscription at the next token. During a long wait for the first token, nothing is written and nothing is noticed. Whether cancelling also stops the provider from generating, and billing, depends on the provider client closing its HTTP stream; measure it with the provider's token metrics (unsourced).
- **Unsafe output** — a streamed token is already on the user's screen, so an output check after the stream comes too late. Either check sentence by sentence while buffering one sentence, or accept the risk for low-harm content and redact the stored copy.
- **Broken traces** — the docs note that for streaming calls to OpenAI and Anthropic models, the HTTP-level span is not parented under the chat-model span, because the context is lost across threads. The model span itself is fine.

**Observability through Micrometer.** Spring AI records Micrometer observations, which become both metrics and trace spans:

| Observation | Recorded when | Useful for |
|---|---|---|
| `spring.ai.chat.client` | each `call()` or `stream()` | end-to-end latency of the whole chain |
| `spring.ai.advisor` | each advisor runs | which advisor is slow (retrieval, memory) |
| `gen_ai.client.operation` | each chat or embedding model call | model latency, tagged with `gen_ai.request.model` and `gen_ai.system` |
| `gen_ai.client.token.usage` | each model call | token counts, the input to cost dashboards |
| `db.vector.client.operation` | vector store `query`, `add`, `remove` | retrieval latency |
| `spring.ai.tool` | each tool call | slow or failing tools |

- **Export** — the Spring Boot starter `spring-boot-starter-opentelemetry` exports spans over OTLP to the address in `management.opentelemetry.tracing.export.otlp.endpoint`.
- **Sampling** — Spring Boot keeps 10% of traces by default (`management.tracing.sampling.probability=0.1`). A thumbs-down on an unsampled request then has no trace to open. Sample at 100% into a collector (a service that receives telemetry, filters it, and forwards it) and drop there by rule, which G6.6 covers.
- **Content** — prompts, completions, tool arguments, and vector-store results stay out of observations unless a property turns them on: `spring.ai.chat.client.observations.log-prompt`, `spring.ai.chat.observations.log-completion`, `spring.ai.tools.observations.include-content`, `spring.ai.vectorstore.observations.log-query-response`. All default to `false`, and the docs warn they expose private data. Keep them off in production; store content, if needed, in a separate access-controlled store (G6.7).
- **Cost per request** — the span carries `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` (plus cache read and write counts). Multiply by a price table keyed by `gen_ai.response.model` in the dashboard, not in the app, so a price change needs no deploy.

**Timeouts, retries, and rate limits.** The defaults suit a batch job, not a chat window:

- **Spring AI's own retry** applies to providers built on its `RetryTemplate` (Spring's helper that re-runs a failed call with waits between attempts), such as OpenAI and DeepSeek. The defaults are `spring.ai.retry.max-attempts=10`, a backoff starting at 2 s (`backoff.initial-interval`), multiplied by 5 (`backoff.multiplier`), capped at 3 minutes (`backoff.max-interval`). During a provider outage, one user request waits through about 2 + 10 + 50 + 180 × 6 s, roughly 20 minutes, while holding a thread and a connection. Set 2 or 3 attempts, a cap of a few seconds, and keep `on-client-errors=false`, so a 400 caused by a bad request is never retried.
- **Bedrock Converse** documents no `spring.ai.retry` properties; retries come from the AWS SDK client. Its timeouts are `spring.ai.bedrock.aws.timeout` (whole call, default 5 minutes), `connection-timeout` (5 s), and `async-read-timeout` (30 s, for streaming). Its `max-tokens` defaults to 500, which silently truncates longer answers: set it from the answer lengths you measure.
- **Anthropic direct** uses `spring.ai.anthropic.max-retries` (default 2) and `spring.ai.anthropic.timeout` (default 60 s), overridable per call.
- **One deadline for the whole request** — each layer's timeout must fit inside the user-facing one. With a 30 s deadline, a model call that may take 20 s leaves no room for a second attempt, so retry only when the remaining time allows it.
- **Rate limits** — the provider's quota is shared by every instance of the app. Cap concurrent model calls per instance, with Spring Framework 7's `@ConcurrencyLimit` (enabled by `@EnableResilientMethods`) or a bulkhead (a fixed number of slots for calls to one dependency, so a slow one cannot take every thread), so a burst queues inside the app, where it can be shed or prioritized, and does not turn into a storm of throttled calls.
- **Cost control** — the budget advisor above, `max-tokens` on every call, prompt caching for fixed prefixes (the Bedrock Converse model takes a `BedrockCacheOptions` strategy such as `SYSTEM_ONLY`), and model routing (G6.8). Spring AI 2.0.1 also ships a Redis-backed `SemanticCacheAdvisor`, with the risks of semantic caching covered in G6.8.

**The same pieces in Python frameworks.**

| Spring AI | LangChain (v1) | LlamaIndex |
|---|---|---|
| `ChatModel`, `ChatClient` | chat model from `init_chat_model`; `invoke` / `stream` | LLM classes; query and chat engines |
| Advisor (`CallAdvisor`, `StreamAdvisor`) | agent middleware: `AgentMiddleware` with `before_model`, `after_model`, `wrap_model_call`, `wrap_tool_call` | no single hook; instrumentation observes, custom query engines change behavior (unsourced) |
| `QuestionAnswerAdvisor`, `RetrievalAugmentationAdvisor` | a retriever used by a chain, or as a tool of `create_agent` | `index.as_query_engine()`; `QueryEngineTool` for agents |
| `VectorStore`, `PgVectorStore` | `VectorStore` integrations | `VectorStoreIndex` over a vector store |
| `ChatMemory` + `CONVERSATION_ID` | checkpointer (`PostgresSaver`) + `thread_id` | `Memory.from_defaults()`, SQL-backed |
| `@Tool` | `@tool`, `bind_tools` | `FunctionTool.from_defaults()` |
| `.entity(Record.class)` | `with_structured_output`; `response_format` with `ToolStrategy` or `ProviderStrategy` | structured output in LLM classes; Pydantic programs (Pydantic is Python's data-validation library) |
| ETL: `DocumentReader` → `TextSplitter` → `VectorStore` | document loaders → text splitters → vector store; `RecordManager` for incremental sync | readers → node parsers → `IngestionPipeline` with a docstore for deduplication |
| Micrometer observations, OTLP | LangSmith tracing | `instrumentation` module, OpenTelemetry |

Sources: [Spring AI getting started (Boot 4.0 / 4.1 support)](https://docs.spring.io/spring-ai/reference/getting-started.html) · [Advisors API](https://docs.spring.io/spring-ai/reference/api/advisors.html) · [ChatClient API](https://docs.spring.io/spring-ai/reference/api/chatclient.html) · [Spring AI source v2.0.1: `MessageChatMemoryAdvisor`, `QuestionAnswerAdvisor`, `BaseAdvisor`, `MessageAggregator`, `SemanticCacheAdvisor`](https://github.com/spring-projects/spring-ai/tree/v2.0.1) · [Spring AI observability](https://docs.spring.io/spring-ai/reference/observability/index.html) · [Spring Boot tracing](https://docs.spring.io/spring-boot/reference/actuator/tracing.html) · [Retry properties (DeepSeek page)](https://docs.spring.io/spring-ai/reference/api/chat/deepseek-chat.html) · [Bedrock Converse](https://docs.spring.io/spring-ai/reference/api/chat/bedrock-converse.html) · [Anthropic chat](https://docs.spring.io/spring-ai/reference/api/chat/anthropic-chat.html) · [Reactor `Flux.timeout`](https://github.com/reactor/reactor-core/blob/main/reactor-core/src/main/java/reactor/core/publisher/Flux.java) · [Spring MVC async and reactive types](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-async.html) · [Core Spring resilience features](https://spring.io/blog/2025/09/09/core-spring-resilience-features/) · [LangChain middleware](https://docs.langchain.com/oss/python/langchain/middleware/custom) · [LangChain models](https://docs.langchain.com/oss/python/langchain/models) · [LangChain short-term memory](https://docs.langchain.com/oss/python/langchain/short-term-memory) · [LangChain structured output](https://docs.langchain.com/oss/python/langchain/structured-output) · [LangChain indexing and RecordManager](https://www.langchain.com/blog/syncing-data-sources-to-vector-stores) · [LlamaIndex query engine](https://developers.llamaindex.ai/python/framework/module_guides/deploying/query_engine/) · [LlamaIndex memory](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/) · [LlamaIndex tools](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/tools/) · [LlamaIndex structured outputs](https://developers.llamaindex.ai/python/framework/module_guides/querying/structured_outputs/) · [LlamaIndex ingestion pipeline](https://developers.llamaindex.ai/python/framework/module_guides/loading/ingestion_pipeline/) · [LlamaIndex observability](https://developers.llamaindex.ai/python/framework/module_guides/observability/)

**In an interview**

- *During a provider outage, our chat requests hung for minutes and the service ran out of threads. What happened?* Spring AI's default retry is 10 attempts with a backoff that grows from 2 seconds to a 3-minute cap, which suits a batch job and ruins a chat. Each hung request held a thread and a connection. I would cut attempts to 2 or 3 with a cap of a few seconds, set one deadline for the whole request that every retry must fit inside, and cap concurrent model calls so excess load is shed with a clear error.
- *How would you stop one client team from spending the whole AI budget?* A custom advisor at the highest precedence: it checks the tenant's remaining tokens before the call and charges the reported usage after it, using the message aggregator for streams. Because it is an advisor, no code path that builds prompts can skip it. For a hard cap, it reserves input plus `max_tokens` before the call and settles afterwards, because a check-then-charge budget lets parallel calls overshoot.
