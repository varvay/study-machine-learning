---
title: Transformer internals
---

L2 covered attention as softmax(QKᵀ / √dₖ) V over a whole sequence. At L3 the question is what that costs when a model serves real traffic: memory, bandwidth, and context length.

**Generation runs in two phases.**

- **Prefill** — one forward pass (input to output through every layer, G2.4 L1) over all prompt tokens at once. Every token's work is a row of one large matrix multiply, so the GPU's arithmetic units stay busy: prefill is **compute-bound**. Its duration is the **time to first token (TTFT)**.
- **Decode** — one forward pass per generated token, each producing the next token from the previous one. Its duration per token is the **time per output token (TPOT)**, also called inter-token latency. Decode is **memory-bound**, for the reasons below.

**The KV cache** is the store of the keys and values of every token processed so far, one set per layer and per key/value head, kept in GPU memory for the life of the request. A new token then computes only its own query, key, and value, and reads the rest from the cache. Reuse is safe because of the causal mask: a token attends only to earlier tokens, so an earlier token's keys and values never change once computed. Without the cache, each decode step would recompute keys and values for the whole sequence, and total work would grow with the square of the length. The walkthrough below steps through one request.

Its size per token is fixed by the architecture:

KV bytes per token = 2 (key and value) × layers × KV heads × head dimension × bytes per value

- **Llama 3 8B**: 32 layers, 8 KV heads, head dimension 4,096 / 32 = 128, 2 bytes in bf16. That is 2 × 32 × 8 × 128 × 2 = 131,072 bytes = **128 KiB per token**.
- One 8,192-token conversation holds 1 GiB of cache; one 128K-token conversation holds 16 GiB, as much as the model's own weights (8 billion parameters × 2 bytes ≈ 16 GB).
- Every concurrent conversation holds its own cache, so cache memory = tokens per sequence × concurrent sequences × 128 KiB. On one 80 GB GPU, at most about 64 GB remain after the weights: room for about 60 sequences of 8K tokens, or 3 of 128K.

**Why decode is memory-bound.** **Arithmetic intensity** is the number of arithmetic operations a computation performs per byte it reads from memory. A GPU is compute-bound above a threshold intensity and bandwidth-bound below it.

- An NVIDIA H100 SXM, a data-center GPU, reads memory at 3.35 TB/s and is listed at 1,979 BF16 teraFLOPS (trillion floating-point operations per second) with sparsity, a speed-up that applies only when the weights follow a pattern of zeros the hardware skips; dense math runs at about half that (unsourced). Its threshold is therefore roughly 990 × 10¹² / 3.35 × 10¹² ≈ 300 FLOPs per byte.
- One decode step for one sequence reads every weight once (16 GB for Llama 3 8B) and does about 2 FLOPs per weight (a multiply and an add): about 1 FLOP per byte. The GPU waits on memory more than 99% of the time.
- Upper bound at batch size 1: 3.35 TB/s ÷ 16 GB ≈ 210 decode steps per second, so about 210 tokens per second, whatever the compute.
- **Batching** fixes this: one read of the weights serves every sequence in the batch, so B sequences raise the intensity about B times at almost no extra time per step. Throughput climbs with batch size until compute saturates or the KV cache fills memory. The cache usually runs out first, and its reads are per sequence, so they are never shared. Serving engines, the servers such as vLLM that run a model behind an API and batch its requests, exist to pack that memory well (G3.2 L3).

Levers that shrink the cache, each with a cost:

- **Multi-query and grouped-query attention (MQA, GQA)** — many query heads share one key/value head (MQA) or a few (GQA). Llama 3 uses 8 KV heads for 32 query heads, a 4× smaller cache than one KV head per query head. MQA degrades quality somewhat; GQA recovers most of it at close to MQA's speed.
- **KV-cache quantization** — storing keys and values in 8 bits halves the cache. vLLM exposes it as `--kv-cache-dtype fp8`; accuracy needs checking per model.
- **Shorter contexts** — retrieving 5 good chunks costs less than pasting 100 (G3.2 on why it also answers better).

**Attention costs O(n²).** Self-attention scores every token against every other: an n × n matrix per head per layer. Compute grows as O(n² · d) and a naive implementation also stores the n × n matrix, so doubling the prompt quadruples attention's cost in prefill. During decode with a cache, one new token costs O(n · d), so generating n tokens still totals O(n²). Two techniques make long contexts practical:

- **FlashAttention** — an exact attention algorithm that never writes the n × n matrix to the GPU's main memory (HBM). It splits Q, K, and V into tiles that fit in the fast on-chip memory (SRAM), computes the softmax tile by tile with a running maximum and sum, and writes only the output. The arithmetic is still O(n²), but memory traffic falls sharply and memory use grows linearly in n. The paper reports 3× faster GPT-2 training at 1K tokens.
- **RoPE (rotary position embedding)** — a positional encoding that rotates each pair of dimensions of a query or key by an angle proportional to the token's position. The dot product of a query at position m and a key at position n then depends only on m − n, their distance: attention sees relative position without a learned position table. A model still degrades past the length it was trained on, because it never saw larger rotations. **Context extension** rescales the rotation so long positions map into the trained range (Position Interpolation, YaRN), followed by short training on long text. Llama 3 uses RoPE with base θ = 500,000 (the constant that sets how fast each dimension pair rotates; a larger base rotates more slowly); Amazon Bedrock's import of Llama 3 models applies `rope_scaling` with `factor=8` over `original_max_position_embeddings=8192`, the scaling that takes 8K to 128K.

Other long-context techniques trade exactness for cost: **sliding-window attention** lets each token attend only to the last W tokens (Mistral models use it), which bounds the cache at W tokens per layer.

**Mixture of experts (MoE)** is an architecture where each layer's feed-forward block is split into many parallel feed-forward networks, the **experts**, and a small learned **router** picks a few of them for each token. The token's output is the sum of the chosen experts' outputs, weighted by the router's scores. Attention layers stay shared. Mixtral 8x7B has 8 experts per layer and routes each token to 2, so a token touches 13B of the model's 47B parameters.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 270" role="img" aria-labelledby="transformer-moe-title">
<title id="transformer-moe-title">Mixture-of-experts layer: a router scores eight experts for one token, the top two run, and their outputs are summed with the router's weights</title>
<text class="note" x="20" y="22">one token, one layer</text>
<rect class="fold-train" x="20" y="115" width="110" height="40" rx="8" />
<text class="table-name" x="75" y="140" text-anchor="middle">token vector</text>
<path class="key-link" d="M130,135 L170,135" />
<rect class="fold-test" x="170" y="115" width="110" height="40" rx="8" />
<text class="table-name" x="225" y="133" text-anchor="middle">router</text>
<text class="key-tag" x="225" y="148" text-anchor="middle">scores 8 experts</text>
<rect class="fold-train" x="350" y="20" width="150" height="24" rx="6" /><text x="425" y="37" text-anchor="middle">expert 1</text>
<rect class="fold-test" x="350" y="50" width="150" height="24" rx="6" /><text x="425" y="67" text-anchor="middle">expert 2 · w = 0.7</text>
<rect class="fold-train" x="350" y="80" width="150" height="24" rx="6" /><text x="425" y="97" text-anchor="middle">expert 3</text>
<rect class="fold-train" x="350" y="110" width="150" height="24" rx="6" /><text x="425" y="127" text-anchor="middle">expert 4</text>
<rect class="fold-train" x="350" y="140" width="150" height="24" rx="6" /><text x="425" y="157" text-anchor="middle">expert 5</text>
<rect class="fold-test" x="350" y="170" width="150" height="24" rx="6" /><text x="425" y="187" text-anchor="middle">expert 6 · w = 0.3</text>
<rect class="fold-train" x="350" y="200" width="150" height="24" rx="6" /><text x="425" y="217" text-anchor="middle">expert 7</text>
<rect class="fold-train" x="350" y="230" width="150" height="24" rx="6" /><text x="425" y="247" text-anchor="middle">expert 8</text>
<path class="key-link" d="M280,135 C315,135 315,62 350,62" />
<path class="key-link" d="M280,135 C315,135 315,182 350,182" />
<path class="key-link" d="M500,62 C535,62 535,135 570,135" />
<path class="key-link" d="M500,182 C535,182 535,135 570,135" />
<rect class="fold-test" x="570" y="115" width="100" height="40" rx="20" />
<text class="table-name" x="620" y="140" text-anchor="middle">Σ w × output</text>
<path class="key-link" d="M670,135 L705,135" />
<text x="710" y="139">output</text>
<text class="note" x="20" y="200">the 6 unchosen experts</text>
<text class="note" x="20" y="216">do no work for this token</text>
</svg>
</div>
<figcaption>A top-2 MoE layer; w is the router's weight for each chosen expert. All 8 experts sit in GPU memory; only the 2 the router picks run for this token, and the next token may pick a different pair.</figcaption>
</figure>

MoE trades memory for compute:

- **Compute per token** follows the active parameters (13B for Mixtral), so each token is cheap for the quality of a large model.
- **Memory** follows the total parameters (47B): every expert must be loaded, because any token may pick any expert. Serving Mixtral needs the GPUs of a 47B dense model.
- **Batching benefit shrinks.** In a large batch, different tokens pick different experts, so a decode step still reads most expert weights, while each expert serves only part of the batch (a consequence of per-token routing; unsourced).
- **Load balancing** is the training difficulty: a router left alone sends most tokens to a few favourite experts. Training adds a loss term that rewards spreading tokens evenly (introduced with the sparsely-gated MoE layer).
- The name 8x7B is not 56B, because the attention layers are shared across experts.

**Scaling laws** are empirical formulas that predict a model's loss from its size and training budget.

- Kaplan et al. found that loss falls as a power law (each tenfold increase cuts the loss by the same fraction) in parameters (N), training tokens (D), and compute, over more than seven orders of magnitude, while width and depth matter little within a wide range.
- Hoffmann et al. (Chinchilla) found that for a fixed compute budget, N and D should grow equally: double the model, double the data. Their 70B Chinchilla, trained on 1.4T tokens (20 tokens per parameter), beat DeepMind's 280B Gopher trained with the same compute.
- Chinchilla-optimal minimizes training compute, not the total cost of a deployed model. Inference cost grows with N, so a smaller model trained far longer is cheaper to serve at the same quality. Llama 3 8B was trained on over 15T tokens, about 1,900 per parameter.
- Scaling laws predict loss, which falls smoothly. They do not predict when a specific skill appears, or accuracy on your task; that needs an eval (G3.3).

**In an interview**

- *Why is LLM inference memory-bound, and what do you do about it?* Each decode step reads all the weights to produce one token per sequence, about 1 FLOP per byte, while a GPU needs hundreds of FLOPs per byte to use its compute. Batching many sequences amortizes the weight reads, so a serving engine with continuous batching (new requests join the running batch at every step, G3.2 L3) and a well-packed KV cache is the first fix. Then shrink the bytes: GQA models, quantized weights and KV cache, shorter contexts.
- *Your feature with a 128K-token context runs out of GPU memory at 20 concurrent users. Why?* The KV cache grows linearly with context and concurrency: for Llama 3 8B it is 128 KiB per token, so 16 GiB per full 128K sequence and over 300 GiB for 20 users. Options are capping context and retrieving less, KV quantization, more GPUs with tensor parallelism (each layer's weight matrices split across GPUs, so their memory adds up), or a model with fewer KV heads.

Sources: [Vaswani et al., Attention Is All You Need](https://arxiv.org/abs/1706.03762) · [Llama 3 paper, Table 3 (architecture)](https://arxiv.org/abs/2407.21783) · [Meta, Introducing Llama 3 (15T tokens)](https://ai.meta.com/blog/meta-llama-3/) · [NVIDIA H100 specifications](https://www.nvidia.com/en-us/data-center/h100/) · [Shazeer, multi-query attention](https://arxiv.org/abs/1911.02150) · [Ainslie et al., GQA](https://arxiv.org/abs/2305.13245) · [vLLM engine arguments](https://docs.vllm.ai/en/latest/configuration/engine_args/) · [Dao et al., FlashAttention](https://arxiv.org/abs/2205.14135) · [FlashAttention-2](https://arxiv.org/abs/2307.08691) · [Su et al., RoFormer (RoPE)](https://arxiv.org/abs/2104.09864) · [Chen et al., Position Interpolation](https://arxiv.org/abs/2306.15595) · [Peng et al., YaRN](https://arxiv.org/abs/2309.00071) · [Amazon Bedrock Custom Model Import (Llama rope_scaling, Mistral sliding window)](https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-import-model.html) · [Shazeer et al., sparsely-gated MoE](https://arxiv.org/abs/1701.06538) · [Jiang et al., Mixtral of Experts](https://arxiv.org/abs/2401.04088) · [Kaplan et al., scaling laws](https://arxiv.org/abs/2001.08361) · [Hoffmann et al., Chinchilla](https://arxiv.org/abs/2203.15556)
