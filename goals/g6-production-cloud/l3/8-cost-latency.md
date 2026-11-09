---
title: Cost and latency
---

Caching, batching, and a smaller model (L2) each cut cost or latency by a fixed step. The expert moves are to choose per request which model answers, to size the capacity behind it, and to show the client the choice as a curve of cost against quality, not a single price.

**Routing and cascades.** Both send easy requests to a cheap model and hard ones to a strong model; they differ in when they decide.

- **Router** — a classifier reads the request and picks one model before any model runs. Each request pays for one model call plus the classifier. RouteLLM (Ong et al., 2024) trains such routers on human preference data and reports cost cut by over 2× in some settings without losing response quality.
- **Cascade** — the cheap model answers first; a **scorer** judges the answer, and if the score falls below a threshold, the request goes on to the strong model. FrugalGPT (Chen, Zaharia, Zou, 2023) reports matching the best single model with up to 98% less cost on its benchmarks. The cascade sees the actual answer, so it can judge quality directly, but every escalated request pays for both calls and waits for both.

The arithmetic decides whether a cascade pays. With c_s the small model's cost per request, c_l the large one's, and e the share of requests that escalate, the cascade costs c_s + e × c_l against c_l for always using the large model. It is cheaper only while e < 1 − c_s / c_l. At the Frankfurt prices, for a request of 3,500 input and 400 output tokens (G6.1):

| Model | Cost per request | Cascade from Haiku saves money while escalation is under |
|---|---|---|
| Claude Haiku 4.5 | $0.00605 | — |
| Claude Sonnet 5.5 | $0.0121 (2×) | 50% |
| Claude Opus 5.5 | $0.0242 (4×) | 75% |

Haiku to Sonnet is a 2× gap, so a cascade barely pays and doubles the latency of every escalated request; a router, or simply Sonnet with prompt caching, is usually the better design. Haiku to Opus leaves room. The walkthrough below moves the threshold on ten requests.

The **scorer** is the design's weak point, and it has several forms:

- **Rule checks** — the answer parses into the required structure, cites a retrieved chunk, stays within length. Free and reliable, but they catch only format failures.
- **Retrieval signals** — a low top similarity score says the question is outside the corpus, whichever model answers.
- **A verifier model** — a small model or a Guardrails contextual grounding check rates whether the answer is supported by the sources. It costs a call, which enters c_s.
- **The model's own confidence** — asking the model how sure it is. It is cheap but must be calibrated on the eval set (checked that its stated confidence matches how often it is right) before anyone trusts it: an overconfident model keeps its wrong answers, which the walkthrough's third example shows.

A managed option: **Bedrock Intelligent Prompt Routing** is a router behind one endpoint that predicts each model's response quality per request and picks between two models of the same family, using a fallback model and a **response quality difference** threshold. Its limits shape the decision: it is optimized for English prompts, it cannot learn from the application's own performance data, and its supported model list lags behind the newest models. A custom router trained on the client's eval set and traces avoids all three.

**Semantic caching.** A **semantic cache** returns a stored answer when a new question's embedding is close enough to a cached one, skipping the model entirely. Spring AI 2.0.1 ships a Redis-backed `SemanticCacheAdvisor`. Its risks set its limits:

- **False hits** — a lower similarity threshold raises the hit rate and admits unrelated matches: "cancel my policy" and "renew my policy" may sit close in embedding space (unsourced example). Tune the threshold on real question pairs and measure the false-hit rate before launch.
- **Permissions** — a cache shared across users serves answers built from documents the next user may not read. Key it by the permission set, or keep it per user (G6.7).
- **Staleness** — a cached answer outlives a document update. Key entries by index version and release, so a re-ingestion or a rollback drops them (G6.5).

**Speculative decoding.** A model writes one token per forward pass (one run of the input through all its layers; G2.4), and at low load each pass is limited by how fast the weights stream from GPU memory, not by arithmetic. **Speculative decoding** uses that idle compute: a small **draft** model (or a cheaper method) proposes the next k tokens, the large model checks all k in one forward pass, and a rejection-sampling rule (keep each drafted token with a probability set by how likely the large model finds it) accepts the longest correct prefix plus one token of its own. The accepted text has exactly the distribution the large model alone would produce. Leviathan et al. (2022) report 2–3× faster decoding on T5-XXL, an 11-billion-parameter Google model, with identical outputs.

- **When it helps** — vLLM recommends it for medium-to-low request rates on memory-bound workloads. At high load, the GPU is busy with large batches, and the draft's extra compute competes with real work, so the gain shrinks.
- **Acceptance rate is everything** — the speed-up depends on how often the drafts are right. vLLM offers several draft methods: a draft model, EAGLE (a small drafting layer that reads the large model's own internal states), multi-token prediction (MTP, extra output heads that guess several next tokens at once), and n-gram lookup, which proposes tokens copied from the prompt. RAG answers often quote their chunks, which favors n-gram drafts (unsourced).
- **Who controls it** — on a managed API, the provider decides. It is a lever only for self-hosted models (G6.4), and it cuts latency, not cost per token.

**Capacity planning.** On a managed API, capacity is quota: the peak TPM with output burndown and the `max_tokens` reservation (G6.1). For guaranteed capacity, Bedrock's **Reserved** tier sells tokens-per-minute capacity for 1 or 3 months (from 100,000 input and 10,000 output TPM) that overflows to Standard, and its **Priority** tier buys faster responses per request at a premium.

Self-hosted, capacity is GPU memory and concurrency. For the G6.1 load on an open-weight model of about 72B parameters:

1. **Concurrency** — Little's law: requests in the system = arrival rate × time each spends there. At the 190-per-minute peak (3.2 per second), with TTFT 1.1 s and 400 tokens at 30 tokens per second (14.4 s per request), about **46 sequences** run at once.
2. **KV cache** — the attention keys and values kept for every token of every running sequence: 2 × layers × KV heads × head dimension × bytes per value. Qwen2.5-72B has 80 layers, 8 KV heads, and a head dimension of 128 (8,192 / 64 heads), so in 16-bit it needs 2 × 80 × 8 × 128 × 2 B = 320 KiB per token. 46 sequences × 3,900 tokens × 320 KiB ≈ **59 GB**.
3. **Weights** — about 72 GB in 8-bit (G6.8 L2), 144 GB in 16-bit.
4. **Fit** — 8-bit weights plus the KV cache, about 131 GB, fit on one `g6e.12xlarge` (4 × 48 GB = 192 GB) with room for activations; 16-bit weights plus the cache, about 203 GB, do not. So the choice of quantization decides the instance, and the eval set decides whether 8-bit is good enough.
5. **Load test** — measure TTFT and tokens per second per replica at rising concurrency, find the concurrency where the TTFT SLO breaks (G6.6), and size replicas as peak concurrency divided by that, plus one for failure. Prefix caching (vLLM's automatic prefix caching) lets requests that share the system prompt reuse its KV cache, which lowers TTFT and memory per sequence.

**Cost against quality, for a client.** A client asking "how much will it cost?" is choosing a point on a curve. Build the curve:

1. List candidate configurations: model, top-k, prompt caching, a cascade threshold.
2. Score each on the eval set (G6.5), with its confidence interval.
3. Price each on the client's traffic profile, per 1,000 questions.
4. Keep the **Pareto frontier**: the configurations no other beats on both cost and quality. Everything off the frontier is waste.
5. Show the frontier with the client's quality floor and budget on it, and let them pick. Add latency as a column; a cascade's escalated requests are slower.

| Configuration | Cost per 1,000 questions | Eval pass rate (illustrative) | On the frontier? |
|---|---|---|---|
| Haiku 4.5, top-5 | $6.05 | 78% | yes |
| Sonnet 5.5, top-3 | $9.90 | 86% | yes |
| Sonnet 5.5, top-5, cached 600-token prefix | $10.91 | 88% | yes |
| Sonnet 5.5, top-5, no caching | $12.10 | 88% | no: same quality, costs more |
| Cascade Haiku → Opus, 40% escalated | $15.73 | 89% | yes, if 89% vs 88% is real |
| Opus 5.5, top-5 | $24.20 | 91% | yes |

What this tells the client: caching is a free saving; the last 3 points of quality cost 2.2× the price; and a 1-point difference is inside the eval's noise (G6.5), so the cascade is on the frontier only if a larger eval set confirms its gain. Quote the recommendation as **cost per correct answer** where wrong answers carry a business cost, such as a claims handler's time to catch them.

Sources: [RouteLLM (Ong et al.)](https://arxiv.org/abs/2406.18665) · [FrugalGPT (Chen, Zaharia, Zou)](https://arxiv.org/abs/2305.05176) · [Bedrock intelligent prompt routing](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-routing.html) · [AWS Price List (Bedrock foundation model offers, eu-central-1)](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html) · [Spring AI `SemanticCacheAdvisor` source](https://github.com/spring-projects/spring-ai/blob/v2.0.1/vector-stores/spring-ai-redis-semantic-cache/src/main/java/org/springframework/ai/chat/cache/semantic/SemanticCacheAdvisor.java) · [GPT Semantic Cache (thresholds and false hits)](https://arxiv.org/abs/2411.05276) · [Leviathan et al., speculative decoding](https://arxiv.org/abs/2211.17192) · [vLLM speculative decoding](https://docs.vllm.ai/en/latest/features/speculative_decoding/) · [Databricks — LLM inference performance (memory-bound decoding)](https://www.databricks.com/blog/llm-inference-performance-engineering-best-practices) · [Bedrock service tiers](https://docs.aws.amazon.com/bedrock/latest/userguide/service-tiers-inference.html) · [Little's law](https://en.wikipedia.org/wiki/Little%27s_law) · [Qwen2.5-72B-Instruct config](https://huggingface.co/Qwen/Qwen2.5-72B-Instruct/blob/main/config.json) · [PagedAttention (Kwon et al.)](https://arxiv.org/abs/2309.06180) · [vLLM automatic prefix caching](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/) · [EC2 `g6e` pricing via the AWS Price List](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html)

**In an interview**

- *Would you put a cascade in front of an expensive model to save money?* Only after two checks. The price gap must leave room: a cascade pays only while the escalation share stays below one minus the price ratio, so from Haiku to Sonnet at 2× it must escalate under half the requests, while doubling their latency. And the scorer must be calibrated on the eval set, because an overconfident small model keeps its wrong answers. If either fails, I would use a router that decides up front, or the strong model with prompt caching.
- *How many GPUs do we need to self-host a 70B model for 190 requests a minute?* I start from Little's law: 190 a minute at about 14 seconds each is roughly 46 concurrent sequences. The KV cache for those is about 59 GB for a Qwen2.5-72B-sized model, and 8-bit weights add about 72 GB, so one 4 × 48 GB node fits it, where 16-bit weights would not. Then I load-test that node to find the concurrency at which the TTFT target breaks, and size replicas from that, plus one for failure.
