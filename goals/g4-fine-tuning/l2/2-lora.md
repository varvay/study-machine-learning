---
title: PEFT and LoRA
---

Recap (G4.2 L1): full fine-tuning updates every weight, and PEFT trains a small added set instead. LoRA adds a pair of low-rank matrices beside each chosen weight matrix. QLoRA also stores the frozen base model in 4-bit.

**The LoRA formula.** LoRA keeps a layer's pretrained weight matrix W frozen and learns a change to it, ΔW = BA:

W′ = W + (α / r) · BA

- **W** ∈ ℝ^(d×k) — the pretrained weight, frozen. The layer turns an input of size k into an output of size d.
- **B** ∈ ℝ^(d×r) and **A** ∈ ℝ^(r×k) — the two trainable matrices, together called the **adapter**.
- **r** — the **rank**: the inner size that B and A share, with r ≪ min(d, k). BA is a full d×k matrix, but it can only change W along r independent directions. That limit is what "low-rank" means.
- **α** — `lora_alpha`, a constant that scales the update. Hugging Face's PEFT library, named after the method, multiplies BA by α/r, or by α/√r when `use_rslora=True` (rank-stabilized LoRA, a scaling that keeps training stable at high ranks). The LoRA paper divides by r so that changing r needs less re-tuning of the other settings.

The forward pass computes h = Wx + (α/r)·B(Ax), so the full d×k matrix ΔW is never built. PEFT's default initialization sets B to zero, so at step 0 the adapter adds nothing: training starts from the base model's exact behavior.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 300" role="img" aria-labelledby="lora-adapter-title">
<title id="lora-adapter-title">A LoRA layer: the input goes through the frozen weight W and, in parallel, through the small matrices A then B; the two results are added</title>
<rect class="fold-train" x="20" y="125" width="70" height="50" rx="8" />
<text class="table-name" x="55" y="155" text-anchor="middle">x</text>
<text class="note" x="55" y="195" text-anchor="middle">k inputs</text>
<path class="key-link" d="M90,150 C140,150 150,80 200,80" />
<path class="key-link" d="M90,150 C140,150 140,225 180,225" />
<rect class="table-body" x="200" y="30" width="320" height="100" rx="8" />
<rect class="table-outline" x="200" y="30" width="320" height="100" rx="8" />
<text class="table-name" x="360" y="72" text-anchor="middle">W  (d × k)</text>
<text class="note" x="360" y="96" text-anchor="middle">pretrained, frozen · 4-bit in QLoRA</text>
<rect class="fold-test" x="180" y="205" width="150" height="40" rx="8" />
<text class="table-name" x="255" y="230" text-anchor="middle">A  (r × k)</text>
<path class="key-link" d="M330,225 L370,225" />
<rect class="fold-test" x="370" y="205" width="150" height="40" rx="8" />
<text class="table-name" x="445" y="230" text-anchor="middle">B  (d × r)</text>
<text class="note" x="350" y="270" text-anchor="middle">trainable adapter · B starts at zero</text>
<path class="key-link" d="M520,80 C560,80 575,120 592,136" />
<path class="key-link" d="M520,225 C560,225 575,180 592,164" />
<text class="key-tag" x="560" y="210">× α/r</text>
<rect class="fold-train" x="580" y="130" width="40" height="40" rx="20" />
<text class="table-name" x="600" y="155" text-anchor="middle">+</text>
<path class="key-link" d="M620,150 L680,150" />
<text class="table-name" x="690" y="155">h</text>
<text class="note" x="690" y="175">d outputs</text>
</svg>
</div>
<figcaption>One LoRA layer: h = Wx + (α/r)·B(Ax). Only A and B receive gradients. PEFT wraps every layer named in <code>target_modules</code> this way.</figcaption>
</figure>

**Why it is cheap.** A full update trains d·k numbers per matrix; LoRA trains r(d + k).

- One 4096 × 4096 matrix: 16,777,216 weights. At r = 16, LoRA trains 16 × (4096 + 4096) = 131,072, which is 0.78%.
- Qwen3-4B, an open-weight model, with r = 16 on every linear layer (a layer that multiplies its input by one weight matrix; G2.4 L2): 917,504 adapter weights per layer × 36 layers = 33.0 million, about 0.8% of its 4.0 billion. The layer sizes come from its `config.json`.
- Gradients and optimizer state exist only for the adapter. AdamW, the usual optimizer (G2.4 L2), keeps two extra numbers per trainable weight, so that saving is large too.
- The saved adapter is two files, `adapter_config.json` and `adapter_model.safetensors` (safetensors is a file format for weights), weighing tens of MB. The 8 GB base model is untouched and shared.

**QLoRA** is LoRA on a base model stored in 4-bit by the `bitsandbytes` library. Only the frozen W is quantized. Each matmul (matrix multiplication) dequantizes a block of W, expanding it back to the compute dtype (the number type the arithmetic runs in), uses it, and discards it; A and B stay in 16- or 32-bit and take all the gradient. `BitsAndBytesConfig` holds the settings:

- `load_in_4bit=True` — store linear-layer weights in 4 bits, about 0.5 bytes per weight. A 4B model's linear layers shrink from about 8 GB in 16-bit to about 2 GB.
- `bnb_4bit_quant_type="nf4"` — **NormalFloat4**, a 4-bit type from the QLoRA paper. Its 16 levels are spaced for normally distributed values, which is how trained weights are distributed. The docs of TRL, Hugging Face's library of fine-tuning trainers (G4.3), recommend it over `"fp4"`, a plain 4-bit float.
- `bnb_4bit_use_double_quant=True` — also quantize the per-block scaling constants (each block of weights keeps one number that maps its 4-bit codes back to real values), saving about 0.4 bits per weight.
- `bnb_4bit_compute_dtype` — the dtype the matmuls run in: `torch.bfloat16` on Ampere or newer GPUs (Ampere is NVIDIA's 2020 GPU generation: A100, L4), and `torch.float16` on a T4, an older NVIDIA GPU common on free notebooks, which has no native bfloat16. Both are 16-bit floats; bfloat16 keeps float32's range with less precision, so it overflows less.

**The hyperparameters**, all fields of PEFT's `LoraConfig`:

| Argument | What it sets | Common values |
|---|---|---|
| `r` | rank of B and A: the adapter's capacity | 8–64 for a narrow task; TRL's docs list 8, 16, 32, 64. PEFT's default is 8. |
| `lora_alpha` | α; the update is scaled by α/r | often 2 × r (TRL docs). PEFT's default is 8. |
| `lora_dropout` | dropout on the adapter's input during training: a random share of the values is zeroed at each step, a regularizer (G2.1; dropout: G2.4 L2) | 0.05–0.1 |
| `target_modules` | which layers get an adapter | `"all-linear"`: every linear layer except the output head, the last layer, which turns each vector into next-token scores. The original paper adapted only `q_proj` and `v_proj`, two of attention's matrices, the ones that make the query and value vectors (G3.1 L2). |
| `bias` | whether bias vectors also train | `"none"` |
| `task_type` | which model wrapper PEFT builds | `"CAUSAL_LM"` for a decoder LLM, which predicts each token from the ones before it (G3.1 L1) |
| `modules_to_save` | layers trained in full and saved with the adapter | `["lm_head", "embed_tokens"]`, the output head and the embedding table, only when new tokens were added to the vocabulary |

Two findings from "LoRA Without Regret", a study by the AI lab Thinking Machines, reproduced in the TRL docs, set the defaults used in G4.6:

- **Target all linear layers.** Attention-only LoRA does worse, and a higher rank does not make up for it.
- **Use about 10× the full fine-tuning learning rate**: 2e-4 for SFT with LoRA against 2e-5 for full SFT. Keep the effective batch size, the number of examples behind each weight update (G4.6), below 32.

**Wrapping a model with PEFT directly.** `SFTTrainer`, TRL's training loop for SFT (G4.3), does all of this when you pass it `peft_config` and `quantization_config` (G4.6); the manual version shows each step:

```python
import torch
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import AutoModelForCausalLM, BitsAndBytesConfig

MODEL_ID = "Qwen/Qwen3-4B-Instruct-2507"

quantization = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_use_double_quant=True,
    bnb_4bit_compute_dtype=torch.bfloat16,
)
model = AutoModelForCausalLM.from_pretrained(MODEL_ID, quantization_config=quantization, device_map="auto")
model = prepare_model_for_kbit_training(model)

lora = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, target_modules="all-linear", bias="none", task_type="CAUSAL_LM")
model = get_peft_model(model, lora)
model.print_trainable_parameters()
```

- `prepare_model_for_kbit_training` freezes every base weight, casts the small non-quantized layers (such as layer norms, which rescale each vector to a steady range; G2.4 L2) to fp32 (32-bit floats) for stability, and turns on **gradient checkpointing**. That technique stores only some activations (each layer's outputs, needed to compute gradients) in the forward pass and recomputes the rest during backpropagation, which saves memory at the cost of some speed.
- `get_peft_model` inserts A and B into every targeted layer and marks only them trainable.

**Saving, loading, and merging.**

```python
model.save_pretrained("adapter")

from peft import PeftModel

base = AutoModelForCausalLM.from_pretrained(MODEL_ID, dtype=torch.bfloat16, device_map="auto")
model = PeftModel.from_pretrained(base, "adapter")
merged = model.merge_and_unload()
merged.save_pretrained("merged")
```

- **Keep the adapter separate** to serve several adapters on one base model, or to switch it off and get the base model back.
- **Merge it** (`merge_and_unload()` computes W + (α/r)·BA once and drops A and B) to get an ordinary model with no adapter overhead, which any serving tool can load. Merge into a 16-bit base: merging into 4-bit weights rounds the update, and PEFT warns that "Merge lora module to 4-bit linear may get different generations due to rounding errors."

Sources: [Hu et al., LoRA paper](https://arxiv.org/abs/2106.09685) · [Dettmers et al., QLoRA paper](https://arxiv.org/abs/2305.14314) · [PEFT — LoRA reference (`LoraConfig`)](https://huggingface.co/docs/peft/package_reference/lora) · [TRL — PEFT integration](https://huggingface.co/docs/trl/peft_integration) · [TRL — LoRA Without Regret](https://huggingface.co/docs/trl/lora_without_regret) · [PEFT source — 4-bit merge warning](https://github.com/huggingface/peft/blob/main/src/peft/tuners/lora/bnb.py) · [Qwen3-4B-Instruct-2507 `config.json`](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/blob/main/config.json) · [NVIDIA T4 specifications (Turing; FP16, no BF16 listed)](https://www.nvidia.com/en-us/data-center/tesla-t4/) · [TRL source — bf16 "Requires Ampere or higher"](https://github.com/huggingface/trl/blob/v1.14.1/trl/trainer/base_config.py)
