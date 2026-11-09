---
title: Cost and latency
---

Recap (G6.8 L1): tokens drive most of an LLM request's cost and much of its latency; input and output tokens are billed separately, and output costs more. Here you work the cost formula with real prices, then apply the levers that cut it: caching, batching, streaming, smaller models, and quantization.

## The cost formula

**Cost per request = T_in × p_in + T_out × p_out**

- T_in — input tokens: the system prompt, tool definitions, conversation history, retrieved chunks, and the question. `usage.inputTokens` in the Converse response (G6.1), `gen_ai.usage.input_tokens` in a trace (G6.6).
- T_out — output tokens: the answer, plus any tool-call requests the model writes.
- p_in, p_out — the price per input and per output token. Price lists quote dollars per million tokens, so divide by 1,000,000.

With prompt caching (below), the input splits three ways, each at its own price:

**Cost = T_uncached × p_in + T_write × p_write + T_read × p_read + T_out × p_out**

- T_write — tokens written to the cache on a miss, billed at p_write, above the normal input price.
- T_read — tokens read from the cache on a hit, billed at p_read, far below it.
- T_uncached — the rest of the input.

A tool loop (G6.2) makes several model calls for one question, and each call pays for its whole prompt again. So the cost of a question is the sum over its model calls.

**Prices.** From the Amazon Bedrock pricing page, read 2026-10-01, Region US East (N. Virginia), Standard tier, in dollars per million tokens:

| Model | Route | Input | Output | Batch input / output | Cache write (5 min) | Cache read |
|---|---|---|---|---|---|---|
| Claude Haiku 4.5 | global | 1.00 | 5.00 | 0.50 / 2.50 | 1.25 | 0.10 |
| Claude Haiku 4.5 | geo (`us.`) | 1.10 | 5.50 | 0.55 / 2.75 | 1.375 | 0.11 |
| Claude Sonnet 5.5 | global | 2.00 | 10.00 | not offered | 2.50 | 0.20 |
| Titan Text Embeddings V2 | in-Region | 0.02 | — | 0.01 / — | — | — |

The geo route costs 10% more than the global one: that premium is the price of keeping requests inside the US (G6.1). Prices change; re-read the page before quoting them.

**Worked example.** One capstone chat request on Claude Haiku 4.5 through the `us.` profile:

| Part of the prompt | Tokens |
|---|---|
| system prompt and tool definitions (the same on every request) | 4,500 |
| 5 retrieved chunks × 500 tokens | 2,500 |
| conversation history | 600 |
| question | 50 |
| **input total** | **7,650** |
| answer (output) | 350 |

- Input: 7,650 × $1.10 / 1,000,000 = $0.008415
- Output: 350 × $5.50 / 1,000,000 = $0.001925
- **Per request: $0.010340**, about one cent. At 100,000 requests a month: **$1,034**.
- Embedding the question: 50 × $0.02 / 1,000,000 = $0.000001, negligible. Embedding 10,000 chunks of 500 tokens once costs $0.10.

The input is 81% of this bill, and the retrieved chunks are a third of the input, which is why top-k and chunk size (G6.2) are cost settings. The same request on Claude Sonnet 5.5 (global) costs 7,650 × $2 + 350 × $10 per million = $0.0188, 1.8 times as much.

## Prompt caching

**Prompt caching** stores the model's processed state for the start of a prompt, the **prefix**, so the next request with the same prefix skips reprocessing it: it pays the cache-read price for those tokens and gets its first token sooner. On Bedrock:

- A **cache checkpoint** (`cachePoint` in the Converse API) marks where the cached prefix ends. Everything before it, including tool definitions and the system prompt, must be byte-for-byte identical across requests to hit.
- The prefix must reach a minimum length, which varies by model: 4,096 tokens for Claude Haiku 4.5, 1,024 for Claude Sonnet 5, 512 for Claude Sonnet 5.5. Below it, the request still succeeds, uncached.
- A cache entry lives for a **TTL** (time to live) of 5 minutes by default, reset by every hit; Claude models also offer a 1-hour TTL at a higher write price. Up to 4 checkpoints per request.

In the worked example, the 4,500-token system prompt and tool definitions form the prefix:

- **Miss** (first request, or after 5 idle minutes): 4,500 × $1.375 + 3,150 × $1.10 + 350 × $5.50, per million = **$0.011578**, 12% more than uncached.
- **Hit**: 4,500 × $0.11 + 3,150 × $1.10 + 350 × $5.50, per million = **$0.005885**, 43% less than uncached.

Each write costs $0.275 per million prefix tokens above the normal price, and each hit saves $0.99, so one hit within the TTL repays more than three writes. Caching pays whenever requests share the prefix at least every few minutes. The walkthrough below plays a stream of requests against the cache.

In Spring AI, the Bedrock starter places the checkpoints from a strategy. `SYSTEM_AND_TOOLS` caches the tool definitions and the system prompt; `CONVERSATION_HISTORY` also caches the history for long chats. In G6.2's `assistantClient` bean, add:

```java
.defaultOptions(BedrockChatOptions.builder()
        .cacheOptions(BedrockCacheOptions.builder()
                .strategy(BedrockCacheStrategy.SYSTEM_AND_TOOLS)
                .build()))
```

`defaultOptions` takes the options *builder* in Spring AI 2.0, so there is no final `.build()` on `BedrockChatOptions`. The response's `usage.cacheReadInputTokens` and `cacheWriteInputTokens` (G6.1), and the `gen_ai.usage.cache_read.input_tokens` span attribute (G6.6), show whether it hits.

## Semantic caching

A **semantic cache** stores past answers keyed by the question's embedding, and returns a stored answer when a new question is close enough, such as "how do I factory-reset the router" after "how to reset router to factory settings". A hit skips the model call entirely, so it saves the whole cost and nearly all the latency.

Spring AI 2.0.1 ships one: `SemanticCacheAdvisor` in the `spring-ai-redis-semantic-cache` module, backed by Redis vector search, with a default similarity threshold of 0.8. It has no reference-docs page yet; its source is the documentation.

The risks decide where it fits. A threshold set too low returns the answer to a different question ("reset router X" for "reset router Y"). And an answer that depends on the user, such as the status of *their* ticket, must never be served to another user. Cache only questions whose answer is the same for everyone, and keep the threshold high.

## Batching

**Batch inference** sends many prompts as one job and returns the results later, in exchange for a lower price. On Bedrock:

- The input is a JSONL file in S3, one record per line: `{"recordId": "T-1042", "modelInput": {…}}`, where `modelInput` is a Converse or InvokeModel (Bedrock's older API, with each model's own request format) request body.
- A batch job (`CreateModelInvocationJob`) processes it asynchronously and writes the outputs to S3, in any order.
- Batch prices are half the on-demand prices in the table above. Batch jobs support neither tool calling nor structured output.

Use it for offline work where nobody waits: triaging a backlog of 100,000 old tickets, generating summaries for every manual, or re-running a large evaluation set. For the triage prompt of G6.2 that halves the bill; the capstone's live chat stays on demand.

On a self-hosted server, batching means something else: vLLM batches concurrent requests on the GPU automatically (**continuous batching**: new requests join the running batch as soon as others finish; G6.4), which raises throughput per GPU at no extra effort.

## Streaming

**Streaming** returns the answer token by token as it is generated. It does not change the cost, since the same tokens are generated; it changes what the user waits for, from the full answer to the **time to first token**. A 350-token answer that takes several seconds in total starts appearing well under a second after the model begins writing (unsourced; measure your own).

In Spring AI, `stream()` replaces `call()` and returns a Reactor `Flux`, a stream of values delivered as they arrive:

```java
@GetMapping(value = "/api/chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
Flux<String> chatStream(@RequestHeader("X-Customer-Id") long customerId,
        @RequestParam String conversationId, @RequestParam String question) {
    return assistantClient.prompt()
            .user(question)
            .advisors(advisor -> advisor.param(ChatMemory.CONVERSATION_ID, customerId + ":" + conversationId))
            .toolContext(Map.of("customerId", customerId))
            .stream()
            .content();
}
```

The endpoint sends **server-sent events**, one per chunk of text, over an open HTTP response. Spring AI's docs require the reactive stack (Spring WebFlux, Spring's non-blocking web framework) for streaming even in a Spring MVC app, so add `spring-boot-starter-webflux` next to `spring-boot-starter-webmvc`. The Bedrock call behind it is `ConverseStream`, which needs `bedrock:InvokeModelWithResponseStream` (G6.1).

## Smaller models

The largest lever is the model itself: on the global route, Claude Sonnet 5.5 costs twice as much per token as Claude Haiku 4.5, and larger models are also slower per token (G6.8 L1). Match the model to each call's job:

- **Triage** (G6.2's `/api/triage`): a classification into four categories; the small model, or even a fine-tuned open model on SageMaker (G4, G6.1).
- **Chat answers**: the small model while the evaluation set says quality holds (G6.5); a larger one only for the questions it fails.
- **Query rewriting, summaries of history**: the small model.

In Spring AI a second `ChatClient` with other default options switches the model per call site; per request, `.options(BedrockChatOptions.builder().model("global.anthropic.claude-sonnet-5-5"))` overrides it. Choosing the model automatically per request, such as by how hard the question looks, is routing, covered at L3.

## Quantization

**Quantization** stores a model's weights with fewer bits: 8-bit integers (**int8**) or 4-bit (**int4**) instead of 16-bit floats. Weight memory shrinks by 2× or 4× (G6.4), so the model fits a smaller, cheaper GPU or leaves room for more concurrent requests, and decoding often gets faster because each token reads fewer bytes from memory (unsourced as a general rule; it depends on the kernels, the GPU programs that do the math). The cost is some accuracy, usually small at 8 bits and more noticeable at 4 bits. It applies only to models you host; a managed API chooses its own serving format.

For Qwen3-8B (8.19 billion parameters): BF16 weights take 16.4 GB, int8 about 8.2 GB, int4 about 4.1 GB plus a little for the scale factors.

The formats you meet:

| Format | What it is | Runs on | Use it with |
|---|---|---|---|
| **GGUF** | the file format of llama.cpp (an open-source engine that runs LLMs on CPU and GPU), with quantization types such as `Q8_0` (8-bit) and `Q4_K_M` (4-bit, mixed precision: some tensors keep more bits) | CPU and GPU | llama.cpp, Ollama |
| **AWQ** | Activation-aware Weight Quantization: 4-bit weights, protecting the weights that matter most for typical activations | GPU | vLLM, Transformers (Hugging Face's Python library for loading and running models) |
| **GPTQ** | 4-bit post-training quantization (applied to a finished model, with no retraining) that corrects errors layer by layer | GPU | vLLM, Transformers |
| **bitsandbytes** | int8 (LLM.int8()) and 4-bit loading at model-load time, with no pre-quantized file | GPU | Transformers, QLoRA fine-tuning (LoRA on a 4-bit base model; G4.2) |
| **FP8** | 8-bit floating point for weights and optionally the KV cache | recent NVIDIA GPUs | vLLM |

In practice:

```bash
vllm serve Qwen/Qwen3-8B-AWQ                      # vLLM reads the AWQ settings from the model's config
llama-quantize model-bf16.gguf model-Q4_K_M.gguf Q4_K_M   # make a 4-bit GGUF with llama.cpp
ollama pull qwen3:8b                              # Ollama's default tag is already Q4_K_M
```

```python
from transformers import AutoModelForCausalLM, BitsAndBytesConfig

model = AutoModelForCausalLM.from_pretrained(
    "Qwen/Qwen3-8B",
    quantization_config=BitsAndBytesConfig(load_in_8bit=True),
)
```

Always compare the quantized model with the original on your evaluation set (G6.5) before switching: the memory saving is certain, the quality loss must be measured.

Sources: [Amazon Bedrock pricing (read 2026-10-01; US East N. Virginia)](https://aws.amazon.com/bedrock/pricing/) · [Converse API usage fields](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) · [Bedrock prompt caching (minimums, TTL, checkpoints)](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html) · [Spring AI — Bedrock Converse prompt caching](https://docs.spring.io/spring-ai/reference/api/chat/bedrock-converse.html) · [`ChatClient.defaultOptions(ChatOptions.Builder)` in 2.0.1](https://github.com/spring-projects/spring-ai/blob/v2.0.1/spring-ai-client-chat/src/main/java/org/springframework/ai/chat/client/ChatClient.java) · [`SemanticCacheAdvisor` source](https://github.com/spring-projects/spring-ai/blob/v2.0.1/vector-stores/spring-ai-redis-semantic-cache/src/main/java/org/springframework/ai/chat/cache/semantic/SemanticCacheAdvisor.java) · [`DefaultSemanticCache` (threshold 0.8)](https://github.com/spring-projects/spring-ai/blob/v2.0.1/vector-stores/spring-ai-redis-semantic-cache/src/main/java/org/springframework/ai/vectorstore/redis/cache/semantic/DefaultSemanticCache.java) · [Bedrock batch inference](https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference.html) · [Batch input format](https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference-data.html) · [Spring AI — ChatClient streaming and the reactive stack](https://docs.spring.io/spring-ai/reference/api/chatclient.html) · [vLLM — quantization](https://docs.vllm.ai/en/latest/features/quantization/) · [llama.cpp — quantize](https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md) · [Transformers — bitsandbytes](https://huggingface.co/docs/transformers/main/en/quantization/bitsandbytes) · [Transformers — quantization overview](https://huggingface.co/docs/transformers/main/en/quantization/overview) · [AWQ paper (Lin et al.)](https://arxiv.org/abs/2306.00978) · [GPTQ paper (Frantar et al.)](https://arxiv.org/abs/2210.17323) · [LLM.int8() paper (Dettmers et al.)](https://arxiv.org/abs/2208.07339) · [Qwen3-8B](https://huggingface.co/Qwen/Qwen3-8B) · [Qwen3-8B-AWQ](https://huggingface.co/Qwen/Qwen3-8B-AWQ)
