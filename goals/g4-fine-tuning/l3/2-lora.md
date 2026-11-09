---
title: PEFT and LoRA
---

L2 set up LoRA with `peft`: W′ = W + (α/r)·BA, configured by rank r, alpha α, dropout, and target modules. At L3 the questions are how to choose r and the targets, how much GPU memory a run needs, how to serve many adapters, and when full fine-tuning is worth its cost.

**Why a low-rank update is enough, and when it is not.** The **intrinsic rank** of a weight update is the number of independent directions it really uses, however large the matrix. The LoRA paper found rank 1 already competitive when adapting W_q and W_v of GPT-3 (attention's query and value matrices; G3.1 L2) on WikiSQL and MultiNLI (a text-to-SQL and a sentence-inference benchmark), and concluded that the update a task needs has a low intrinsic rank. That holds for tasks close to what pretraining taught. At the other end, Biderman et al. trained on code and math with large datasets: full fine-tuning learned updates of rank 10 to 100 times higher than typical LoRA settings, and LoRA substantially underperformed it. In return, LoRA forgot less of what the base model knew, more effectively than weight decay (a penalty that pulls weights toward zero; G2.4 L2) or dropout.

Two details of the paper's setup shape every run:

- **Initialization** — A starts random (Gaussian) and B starts at zero, so BA = 0 and training begins exactly at the base model. Both cannot start at zero: each matrix's gradient is multiplied by the other, so both would stay zero.
- **Scaling** — the update is multiplied by α/r. With Adam, tuning α is roughly the same as tuning the learning rate, so the paper set α to the first r it tried and never tuned it. The scaling is meant to let you sweep r with α fixed and no learning-rate retuning. **rsLoRA** shows that α/r shrinks high-rank updates too much, so large ranks learn slowly, and divides by √r instead; in `peft` that is `LoraConfig(use_rslora=True)`.

**Choosing target modules, then rank.**

- **Targets matter more than rank.** Under a fixed budget of 18 million parameters on GPT-3, the LoRA paper did better spreading rank 4 over W_q and W_v than putting rank 8 on W_q alone. QLoRA went further: LoRA on *all* linear layers of each transformer block was required to match full 16-bit fine-tuning, and once they were, the rank r did not affect performance. `LoraConfig(target_modules="all-linear")` selects every linear layer except the output layer.
- **Count what you add.** Each adapted d × k matrix adds r(d + k) parameters. Llama 3.1 8B has hidden size 4,096 (the length of each token's vector), MLP size 14,336 (the inner width of the feed-forward network, the part of each layer that transforms each token's vector on its own after attention has mixed information between tokens), 8 key-value heads of 128 dimensions (its 32 query heads share 8 sets of keys and values, so the k and v matrices are smaller; G3.1 L2), and 32 layers. At rank 16 on all seven linear layers of a block, the attention's q, k, v, and o and the feed-forward network's gate, up, and down: q and o add 16 × 8,192 each, k and v 16 × 5,120 each, gate, up, and down 16 × 18,432 each. That is 1,310,720 per layer and 41.9 million in total: 0.52% of the model's 8.03 billion.
- **Rank.** Start at 16 with all-linear targets, then sweep 8, 16, and 64 and judge by the task eval (G4.5), not the loss (unsourced rule of thumb). Low ranks suffice for format, style, and classification. Raise it when the task is far from pretraining: a new language, a new domain's notation, or a large dataset. If the eval keeps improving as rank grows, the task wants more capacity, which is the first sign that full fine-tuning may pay off.
- **Embeddings and the output layer** stay frozen unless you add new tokens, such as special tags. Then `modules_to_save` trains and saves full copies of those modules, which is expensive: Llama 3.1 8B's embedding alone is 525 million weights. `trainable_token_indices` trains only the new tokens' rows instead.
- **DoRA** (`use_dora=True`) splits each update into a magnitude and a direction and helps most at low ranks. It costs more than plain LoRA per step, so merge it before serving.

**GPU memory math.** Training memory has four parts: the weights, a gradient for each trained weight, the optimizer's state for each trained weight, and the **activations**, the values the forward pass saves for the backward pass. For Llama 3.1 8B with AdamW, one 2,048-token sequence per step, and **gradient checkpointing** (saving only each layer's input and recomputing the rest during the backward pass); GB here is 10⁹ bytes:

| | Full fine-tuning | LoRA (bf16 base) | QLoRA (4-bit base) |
|---|---|---|---|
| Weights | 8.03 B × 2 bytes = 16.1 GB | 16.1 GB, frozen | 6.98 B linear weights × 4.127 bits = 3.60 GB, plus 1.05 B embedding and output weights × 2 bytes = 2.10 GB: 5.70 GB |
| Gradients | 8.03 B × 2 bytes = 16.1 GB | adapters only | adapters only |
| Optimizer states | 8.03 B × 12 bytes = 96.4 GB | adapters only | adapters only |
| Adapters (weight, gradient, two Adam moments, its running averages of the gradient and the squared gradient: 16 bytes each) | — | 41.9 M × 16 = 0.67 GB | 0.67 GB |
| Activations | ≈ 1.9 GB | ≈ 1.9 GB | ≈ 1.9 GB |
| **Total** | **≈ 130 GB** | **≈ 18.6 GB** | **≈ 8.3 GB** |
| Fits on | no single GPU; shard (split the state) across two or more 80 GB GPUs | a 24 GB GPU, tightly | a 16 GB T4 (Colab, Kaggle) |

- **Full fine-tuning: 16 bytes per parameter.** The count of the ZeRO paper, Microsoft's method for splitting training state across GPUs, for mixed-precision Adam: a 2-byte bf16 weight, a 2-byte gradient, and 12 bytes of optimizer state (a 4-byte fp32 master copy of the weight plus two 4-byte moments). Hugging Face's guide counts 18: an fp32 and a 16-bit copy of each weight, and an fp32 gradient; L1 used that figure. An 8-bit Adam from bitsandbytes cuts the moments to 2 bytes per parameter. Past one GPU, **FSDP** (PyTorch's Fully Sharded Data Parallel) or **DeepSpeed ZeRO-3** (ZeRO's third stage, in Microsoft's DeepSpeed training library) shard the weights, gradients, and optimizer states across GPUs.
- **QLoRA: 4.127 bits per quantized weight.** NF4 stores 4 bits per weight, plus one quantization constant per block of 64 weights. At 32 bits, the constants add 0.5 bits per weight; **double quantization** stores them in 8 bits and quantizes those again, cutting the overhead to 0.127 bits. bitsandbytes converts linear layers only: the embedding is not one, and `transformers` keeps the output `lm_head` in its original dtype. Llama 3.1 8B's two 525-million-weight vocabulary matrices therefore stay at 2 bytes and hold over a third of the 5.70 GB.
- **Activations: estimated, not measured.** Checkpointing stores each layer's input: 2,048 × 4,096 × 2 bytes × 32 layers = 0.54 GB. The logits (the raw score the model gives every vocabulary token, at every position) over Llama 3's 128,256-token vocabulary, in fp32, take 2,048 × 128,256 × 4 bytes = 1.05 GB, the largest single part; TRL's `SFTTrainer` defaults to a chunked loss (`loss_type="chunked_nll"`) that avoids materializing them at once. The layer being recomputed needs roughly 34 × sequence × hidden bytes = 0.29 GB, from Korthikanti et al.'s per-layer formula for a GPT-style layer, an approximation for Llama. Without checkpointing that formula gives about 9.1 GB for 32 layers. Batch size multiplies all of it.
- **Overhead.** The CUDA context (the GPU runtime's own state and libraries) and memory fragmentation take roughly 1 to 2 GB more (unsourced estimate). QLoRA's **paged optimizers** move optimizer states to CPU memory when a spike would run the GPU out of memory, and page them back when needed.
- **At 70B**, QLoRA needs about 39.5 GB of weights, 3.3 GB of adapter state (207 million adapter weights at rank 16), and roughly 4.3 GB of activations: about 47 GB, one 80 GB GPU. The QLoRA paper fine-tuned a 65B model on one 48 GB GPU.

The walkthrough below fills a GPU with each method, one kind of memory per step.

**Merged adapters or many adapters on one base.** An adapter can be served two ways:

- **Merged** — compute W + (α/r)·BA once and save the result as an ordinary model. In `peft`, `merge_and_unload()` does it and returns the merged model, so assign its result. The merged model runs on any server at the base model's speed: the LoRA paper reports no added inference latency. Each task then costs a full copy, 16 GB for an 8B model, and switching tasks means switching models. Merge a QLoRA adapter into a 16-bit copy of the base; merging into the 4-bit weights would round much of the small update away (unsourced).
- **Multi-LoRA** — keep one base model in GPU memory and apply the adapter each request names. In vLLM, an open-source inference server, `vllm serve <base> --enable-lora --lora-modules support=/adapters/support sql=/adapters/sql` registers adapters, and a client picks one with the request's `model` field, as if it were a model. `max_loras` caps the adapters used in one batch, `max_cpu_loras` sizes the cache of adapters in CPU memory, and `max_lora_rank` should equal the largest rank served, since a larger value wastes memory. Adapters can also be loaded at runtime through `/v1/load_lora_adapter` with `VLLM_ALLOW_RUNTIME_LORA_UPDATING=True`; the vLLM docs warn to use that only in an isolated, fully trusted environment. S-LoRA, a research system built for this, serves thousands of adapters on one GPU with up to 4× the throughput of `peft` and of vLLM's naive LoRA support at the time.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 260" role="img" aria-labelledby="lora-multi-serving-title">
<title id="lora-multi-serving-title">Multi-LoRA serving: requests name an adapter; one base model in GPU memory serves all of them, with adapters loaded into a few GPU slots from a CPU cache and storage</title>
<text class="note" x="20" y="24">requests name an adapter</text>
<rect class="fold-train" x="20" y="44" width="180" height="34" rx="6" /><text x="32" y="66">model: "support"</text>
<rect class="fold-train" x="20" y="104" width="180" height="34" rx="6" /><text x="32" y="126">model: "sql"</text>
<rect class="fold-train" x="20" y="164" width="180" height="34" rx="6" /><text x="32" y="186">model: base name</text>
<path class="key-link" d="M200,61 L262,120 M254,118 L262,120 L258,112" />
<path class="key-link" d="M200,121 L262,121 M256,117 L262,121 L256,125" />
<path class="key-link" d="M200,181 L262,124 M256,126 L262,124 L260,132" />
<rect class="table-body" x="262" y="34" width="296" height="206" rx="10" />
<rect class="table-outline" x="262" y="34" width="296" height="206" rx="10" />
<text class="note" x="274" y="26">one GPU running vLLM with --enable-lora</text>
<rect class="fold-train" x="276" y="48" width="268" height="52" rx="6" />
<text class="table-name" x="410" y="70" text-anchor="middle">base weights, loaded once</text>
<text class="key-tag" x="410" y="88" text-anchor="middle">Llama 3.1 8B in bf16 · 16 GB</text>
<rect class="fold-test" x="276" y="112" width="84" height="40" rx="6" /><text class="table-name" x="318" y="137" text-anchor="middle">support</text>
<rect class="fold-test" x="368" y="112" width="84" height="40" rx="6" /><text class="table-name" x="410" y="137" text-anchor="middle">sql</text>
<rect class="table-outline" x="460" y="112" width="84" height="40" rx="6" /><text class="key-tag" x="502" y="136" text-anchor="middle">free slot</text>
<text class="key-tag" x="410" y="170" text-anchor="middle">max_loras adapter slots · 84 MB each at rank 16</text>
<rect class="fold-train" x="276" y="182" width="268" height="44" rx="6" />
<text class="table-name" x="410" y="202" text-anchor="middle">KV cache</text>
<text class="key-tag" x="410" y="218" text-anchor="middle">shared by all running requests (G3.1)</text>
<rect class="table-body" x="598" y="48" width="142" height="74" rx="8" />
<rect class="table-outline" x="598" y="48" width="142" height="74" rx="8" />
<text class="table-name" x="669" y="72" text-anchor="middle">CPU memory</text>
<text class="key-tag" x="669" y="92" text-anchor="middle">max_cpu_loras cache</text>
<text class="key-tag" x="669" y="108" text-anchor="middle">recently used adapters</text>
<rect class="table-body" x="598" y="160" width="142" height="66" rx="8" />
<rect class="table-outline" x="598" y="160" width="142" height="66" rx="8" />
<text class="table-name" x="669" y="186" text-anchor="middle">disk or S3</text>
<text class="key-tag" x="669" y="206" text-anchor="middle">every adapter</text>
<path class="key-link" d="M669,160 L669,122 M665,128 L669,122 L673,128" />
<path class="key-link" d="M598,90 L544,130 M548,123 L544,130 L552,129" />
</svg>
</div>
<figcaption>Multi-LoRA serving. Each request carries an adapter name; the base weights and the KV cache (the attention keys and values of every token processed so far, kept so they are not recomputed; G3.1 L3) are shared, and only the small adapters move between storage, CPU memory, and a few GPU slots.</figcaption>
</figure>

The numbers behind the choice, for Llama 3.1 8B: a rank-16 all-linear adapter holds 41.9 million weights, 84 MB in bf16. Fifty customer adapters take 4.2 GB of storage; fifty merged models take 803 GB, and each would need its own GPU memory to serve. The LoRA paper made the same point for GPT-3: 100 tasks as adapters take 354 GB, as full copies 35 TB. The price of multi-LoRA is compute per token: the unmerged path multiplies each adapted layer's input by A and then B on every token, and a batch that mixes adapters needs special kernels (GPU routines) to stay efficient.

| | Merged | Multi-LoRA on one base |
|---|---|---|
| Latency | the base model's | somewhat higher: extra matrix products per adapted layer |
| Memory per extra task | a full model copy | one adapter, MBs |
| Serving stack | any server (vLLM, Ollama, Bedrock Custom Model Import) | a server with LoRA support, such as vLLM |
| Best for | one or a few high-volume tasks | many tasks or tenants on the same base |

**When full fine-tuning is worth its cost.** It costs about 16 bytes per parameter, GPUs sharded together, a full checkpoint per run (16 GB against 84 MB for an 8B model), and more forgetting (Biderman et al.). It pays when:

- **The update is large** — continued pretraining (more next-token training on raw text) on a new domain or language, or a large dataset of hard tasks such as code and math, where Biderman et al. found LoRA well behind.
- **The quality ceiling decides** — one flagship model served at high volume, where a few points of accuracy are worth the GPUs and the team already runs multi-GPU training.
- **Nothing is shared** — a single task served alone gains nothing from adapter swapping, so LoRA's serving advantage disappears.

Before paying for it, try the cheaper steps: all-linear targets, a higher rank with rsLoRA, and DoRA. If the eval still climbs with rank, move to full fine-tuning.

**In an interview**

- *How much GPU memory does fine-tuning an 8B model take?* It depends on what trains. Full fine-tuning with mixed-precision Adam needs about 16 bytes per parameter, roughly 128 GB before activations, so it needs several GPUs sharded with FSDP or ZeRO-3. LoRA keeps the 16 GB of bf16 weights frozen and adds well under 1 GB of adapter state, so it fits a 24 GB GPU; QLoRA stores the base in 4-bit, about 5.7 GB, so it fits a 16 GB T4. On top of that come activations, which scale with batch size and sequence length and are controlled with gradient checkpointing.
- *A SaaS client wants a fine-tuned model for each of 200 customers. How do you serve that?* One shared base model with a LoRA adapter per customer, served by vLLM's multi-LoRA: the request's model name selects the adapter. At rank 16 an 8B adapter is about 84 MB, so 200 adapters take about 17 GB of storage where 200 merged models would take over 3 TB and a GPU each. I would merge only the few highest-volume customers if the adapter overhead shows up in their latency.

Sources: [Hu et al., LoRA paper](https://arxiv.org/abs/2106.09685) · [Biderman et al., LoRA Learns Less and Forgets Less](https://arxiv.org/abs/2405.09673) · [Kalajdzievski, rsLoRA](https://arxiv.org/abs/2312.03732) · [Dettmers et al., QLoRA paper](https://arxiv.org/abs/2305.14314) · [PEFT — LoRA developer guide](https://huggingface.co/docs/peft/main/en/developer_guides/lora) · [PEFT — `LoraConfig` source (`modules_to_save`, `trainable_token_indices`)](https://github.com/huggingface/peft/blob/main/src/peft/tuners/lora/config.py) · [Llama 3.1 8B config](https://huggingface.co/unsloth/Meta-Llama-3.1-8B/blob/main/config.json) · [Rajbhandari et al., ZeRO paper](https://arxiv.org/abs/1910.02054) · [Hugging Face — GPU memory usage in training](https://huggingface.co/docs/transformers/main/en/model_memory_anatomy) · [Transformers — `BitsAndBytesConfig`](https://huggingface.co/docs/transformers/main/en/main_classes/quantization#transformers.BitsAndBytesConfig) · [Korthikanti et al., Reducing Activation Recomputation](https://arxiv.org/abs/2205.05198) · [TRL — `SFTConfig` source (`loss_type`)](https://github.com/huggingface/trl/blob/main/trl/trainer/sft_config.py) · [vLLM — LoRA adapters](https://docs.vllm.ai/en/latest/features/lora.html) · [Sheng et al., S-LoRA](https://arxiv.org/abs/2311.03285)
