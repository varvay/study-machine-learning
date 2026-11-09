---
title: PEFT and LoRA
---

**Full fine-tuning** is training every weight of the model on the new examples. It costs two things:

- **Memory** — training stores more than the weights. For each weight it also keeps a gradient (G2.4) and the optimizer's running statistics. The optimizer is the rule that turns gradients into weight updates; the usual one, Adam, keeps two running averages per weight (G2.4 L2). With Adam in mixed precision, which computes in 16-bit numbers while keeping a 32-bit master copy of the weights, that is about 18 bytes per weight, before activations (each layer's intermediate outputs, kept to compute the gradients). A 7-billion-weight model then needs about 126 GB just for those.
- **Storage** — every task produces a full new copy of the model.

**PEFT** (parameter-efficient fine-tuning) is freezing the pretrained weights and training only a small set of parameters, often new ones added for the purpose. Gradients and optimizer statistics are kept only for that small set, and each task saves only its small set. Quality is often comparable to full fine-tuning. Three common kinds:

- **Adapters** — small new layers inserted inside the model's existing layers; only they train. An LLM is a stack of identical **transformer layers**, each one round of self-attention followed by a feed-forward network, that every token's vector passes through in turn (G3.1 L1). An adapter is a tiny two-step network placed in that path: it squeezes the vector down to a few dozen numbers, then expands it back, and adds the result to the vector so it nudges what flows on to the next step. The original adapter paper put two in each transformer layer, one after attention and one after the feed-forward network, and came within 0.4% of full fine-tuning while adding 3.6% parameters per task.
- **Prompt tuning** — learning a few extra input vectors, a "soft prompt", placed before the real input. The model reads its input as one vector per token, its embedding (G3.1 L1); a soft prompt is a few such vectors that match no real word. They come from training: they start as random numbers or as copies of real words' vectors, the task's examples run through the frozen model, and backpropagation (G2.4 L1) carries each mistake back through every layer to the input, where only those vectors get nudged. Afterwards the same learned vectors are placed before every new input. Twenty of them in a model 4,096 numbers wide are 81,920 parameters to train.
- **LoRA** (low-rank adaptation) — learning the *change* to each weight matrix as the product of two thin matrices.

**How LoRA works.** A layer of the model holds a **weight matrix** W: a grid of numbers, such as 4,096 × 4,096, that turns the layer's input into its output. LoRA freezes W and adds two small trainable matrices next to it:

- **B** — tall and thin: 4,096 rows × r columns;
- **A** — short and wide: r rows × 4,096 columns.

Multiplied together, B × A is a full 4,096 × 4,096 grid, the same shape as W, so it can serve as a change to every weight of W. The layer computes with W + B × A. Training adjusts only B and A.

What B and A do is clearest on one input vector x, the same x that W reads. Each of A's r rows is a **pattern detector**, working like one neuron (G2.4 L1): it multiplies x number by number and adds up, scoring how strongly x contains its pattern. Each of B's r columns says **what to change in the output** when its pattern is found, scaled by that score. The layer's output becomes Wx plus those scaled columns. An input that contains none of the patterns gets no correction at all, so LoRA changes only how the layer treats inputs that look like what the task needs.

- **Rank** — the number of independent patterns in a matrix. In a rank-1 matrix, every row is a multiple of one row; a rank-r matrix mixes r such patterns. B × A has rank at most r, the **LoRA rank**, a setting chosen before training, such as 8.
- **Why a low rank is enough** — the LoRA paper's hypothesis: the change a model needs to adapt to one task has a low "intrinsic rank", so a few patterns can express it, though the model itself needs far more.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 330" role="img" aria-labelledby="lora-matrices-title">
<title id="lora-matrices-title">LoRA: a frozen 4,096 by 4,096 weight matrix W beside two thin trainable matrices B (4,096 by 8) and A (8 by 4,096), whose product has the same shape as W</title>
<text class="note" x="130" y="40" text-anchor="middle">pretrained weights, frozen</text>
<rect class="fold-train" x="30" y="70" width="200" height="200" rx="4" />
<text class="table-name" x="130" y="160" text-anchor="middle">W</text>
<text class="key-tag" x="130" y="180" text-anchor="middle">4,096 × 4,096</text>
<text class="table-name" x="262" y="175" text-anchor="middle">+</text>
<text class="note" x="415" y="30" text-anchor="middle">trainable (B and A drawn wider than scale)</text>
<rect class="fold-test" x="295" y="70" width="14" height="200" rx="3" />
<text class="table-name" x="302" y="292" text-anchor="middle">B</text>
<text class="key-tag" x="302" y="308" text-anchor="middle">4,096 × 8</text>
<rect class="fold-test" x="330" y="45" width="200" height="14" rx="3" />
<text class="table-name" x="548" y="57">A</text>
<text class="key-tag" x="566" y="57">8 × 4,096</text>
<rect class="table-outline" x="330" y="70" width="200" height="200" rx="4" />
<text class="table-name" x="430" y="160" text-anchor="middle">B × A</text>
<text class="key-tag" x="430" y="180" text-anchor="middle">4,096 × 4,096 change to W</text>
<text class="key-tag" x="430" y="196" text-anchor="middle">computed from B and A</text>
<text class="note" x="560" y="120">full fine-tuning trains</text>
<text class="table-name" x="560" y="142">16,777,216 weights</text>
<text class="key-tag" x="560" y="160">4,096 × 4,096</text>
<text class="note" x="560" y="200">LoRA at rank 8 trains</text>
<text class="table-name" x="560" y="222">65,536 weights</text>
<text class="key-tag" x="560" y="240">4,096 × 8 + 8 × 4,096 = 0.39%</text>
</svg>
</div>
<figcaption>One layer's weight matrix under LoRA. The layer computes with W + B × A; B and A together hold 0.39% as many numbers as W, yet their product changes every weight in it.</figcaption>
</figure>

After training, the B and A of every adapted layer are saved as a small file next to the unchanged base model. Hugging Face's PEFT library calls such a file an "adapter" too, for any method; it is not the adapters method above, which inserts new layers. The LoRA paper's adapter for GPT-3 175B was 35 MB against a 350 GB model. For serving, B × A can be added into W once, so the model runs as fast as before. LoRA is usually applied to the weight matrices of the attention layers, the part of each transformer layer that lets every token draw information from the other tokens (G3.1 L1). The walkthrough below runs one input through a small LoRA: A's rows detect patterns in x, B's columns write the corrections, and an input that matches no pattern passes through unchanged.

LoRA still keeps the frozen model in GPU memory, and at 16 bits per weight a 7-billion-weight model takes 14 GB. **QLoRA** shrinks that part:

- **Quantization** — storing each number in fewer bits, at some loss of precision. At 4 bits instead of 16, the same 7-billion-weight model takes about 3.5 GB.
- **QLoRA** — LoRA on a base model quantized to 4 bits. The base stays frozen in 4 bits; training passes gradients through it into the LoRA adapters. The QLoRA paper fine-tuned a 65-billion-weight model on one 48 GB GPU, where regular 16-bit fine-tuning needs more than 780 GB, and matched 16-bit fine-tuning's task performance.

Sources: [Hugging Face — GPU memory usage in training](https://huggingface.co/docs/transformers/model_memory_anatomy) · [Hugging Face PEFT](https://huggingface.co/docs/peft/index) · [PEFT — LoRA conceptual guide](https://huggingface.co/docs/peft/main/en/conceptual_guides/lora) · [Houlsby et al., adapters paper](https://arxiv.org/abs/1902.00751) · [Lester et al., prompt tuning paper](https://arxiv.org/abs/2104.08691) · [Hu et al., LoRA paper](https://arxiv.org/abs/2106.09685) · [Dettmers et al., QLoRA paper](https://arxiv.org/abs/2305.14314)
