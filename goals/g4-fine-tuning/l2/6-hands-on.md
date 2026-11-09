---
title: Hands-on fine-tune
---

Recap (G4.6 L1): a fine-tune runs data → base model → config → train → evaluate → serve. This is the runnable version: a QLoRA fine-tune of **Qwen3-4B-Instruct-2507** for the capstone's routing task (G4.1, G4.4) on a free Colab or Kaggle GPU (Google Colab and Kaggle host Python notebooks with free GPU time). It uses TRL's `SFTTrainer`, PEFT, and bitsandbytes, and logs to Weights & Biases (W&B), a hosted dashboard for training metrics.

**Versions followed:** TRL 1.14.1, PEFT 0.21.1, and Transformers 5.x (docs 5.17). These are current on 2026-10-01. Argument names move between releases (`max_seq_length` became `max_length`, `torch_dtype` became `dtype`, `tokenizer=` became `processing_class=`), so pin TRL and PEFT as shown.

**Why this base model:**

- 4.0B parameters, Apache-2.0 license, and not gated: it downloads with no license form.
- It is an instruct model that "supports only non-thinking mode", so its outputs carry no `<think>` blocks to strip. In thinking mode, a model writes out its reasoning inside `<think>` tags before the answer (reasoning models: G3.3 L1).
- TRL recognizes the Qwen3 family and its chat template.
- In 4-bit its weights take about 2–3 GB of GPU memory, which leaves room for training on a 16 GB T4. This is an estimate: 0.5 bytes per linear-layer weight, plus the embeddings, which stay 16-bit.

`Qwen/Qwen3-1.7B` trains faster with the same code, but defaults to thinking mode.

**The data**: `train.jsonl`, `val.jsonl`, and `test.jsonl` from the G4.4 pipeline, in TRL's conversational prompt-completion format. A few hundred training rows is enough to start. The first lines of `train.jsonl`:

```json
{"prompt": [{"role": "system", "content": "Route the question to a study goal. Reply with JSON only: {\"goal\": \"G1\"-\"G7\", \"type\": \"define\" | \"how-to\" | \"compare\" | \"debug\"}."}, {"role": "user", "content": "When should I pick IVF over HNSW?"}], "completion": [{"role": "assistant", "content": "{\"goal\": \"G1\", \"type\": \"compare\"}"}]}
{"prompt": [{"role": "system", "content": "Route the question to a study goal. Reply with JSON only: {\"goal\": \"G1\"-\"G7\", \"type\": \"define\" | \"how-to\" | \"compare\" | \"debug\"}."}, {"role": "user", "content": "What is LoRA's alpha for?"}], "completion": [{"role": "assistant", "content": "{\"goal\": \"G4\", \"type\": \"define\"}"}]}
{"prompt": [{"role": "system", "content": "Route the question to a study goal. Reply with JSON only: {\"goal\": \"G1\"-\"G7\", \"type\": \"define\" | \"how-to\" | \"compare\" | \"debug\"}."}, {"role": "user", "content": "My agent calls the same tool in a loop. Why?"}], "completion": [{"role": "assistant", "content": "{\"goal\": \"G5\", \"type\": \"debug\"}"}]}
```

With a prompt-completion dataset, `SFTTrainer` computes the loss on the completion only (G4.3). The model learns to write the JSON answer, not to predict the system prompt.

**Step 0 — a GPU runtime.**

- **Colab**: choose a GPU runtime. The free tier usually assigns a T4, but "the types of GPUs … available in Colab vary over time", and free notebooks "can run for at most 12 hours."
- **Kaggle**: turn on a GPU accelerator (T4 ×2 or P100; unsourced, check the notebook's Accelerator menu).

Upload the three JSONL files to the session, or to a Kaggle dataset. Session storage is wiped when the runtime ends, so step 7 pushes the adapter somewhere durable.

**Step 1 — install.** In a notebook cell, prefix the command with `%`. If Colab asks to restart the session after upgrading its preinstalled packages, restart, then continue.

```bash
pip install -U "trl==1.14.1" "peft==0.21.1" "transformers>=5.17" bitsandbytes datasets wandb
```

**Step 2 — configuration and W&B login.** `wandb.login()` asks once for the API key from your W&B account settings. The Trainer's W&B integration reads the project name from the `WANDB_PROJECT` environment variable.

```python
import os

os.environ["CUDA_VISIBLE_DEVICES"] = "0"
os.environ["WANDB_PROJECT"] = "g4-hands-on"

import torch
import wandb

wandb.login()

MODEL_ID = "Qwen/Qwen3-4B-Instruct-2507"
DATA_DIR = "."
OUTPUT_DIR = "routing-qlora"
ADAPTER_DIR = "routing-adapter"

SUPPORTS_BF16 = torch.cuda.get_device_capability(0)[0] >= 8
COMPUTE_DTYPE = torch.bfloat16 if SUPPORTS_BF16 else torch.float16
print(torch.cuda.get_device_name(0), "bf16" if SUPPORTS_BF16 else "fp16")
```

- `CUDA_VISIBLE_DEVICES="0"` keeps the run on one GPU when Kaggle provides two. It must be set before `torch` is imported.
- `SUPPORTS_BF16` is true on Ampere or newer GPUs (compute capability 8.x or higher: A100, L4). TRL's own help text says bf16 "Requires Ampere or higher", and a T4 (Turing) lists FP16 but no BF16. Test the capability directly: `torch.cuda.is_bf16_supported()` also counts software emulation, so it can return true on a T4.

**Step 3 — load the data.**

```python
from datasets import load_dataset

splits = load_dataset(
    "json",
    data_files={name: f"{DATA_DIR}/{name}.jsonl" for name in ["train", "val", "test"]},
)
print(splits)
```

**Step 4 — quantization, adapter, and training settings.**

```python
from peft import LoraConfig
from transformers import BitsAndBytesConfig
from trl import SFTConfig

quantization = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_use_double_quant=True,
    bnb_4bit_compute_dtype=COMPUTE_DTYPE,
)

lora = LoraConfig(
    r=16,
    lora_alpha=32,
    lora_dropout=0.05,
    target_modules="all-linear",
    bias="none",
    task_type="CAUSAL_LM",
)

training_args = SFTConfig(
    output_dir=OUTPUT_DIR,
    run_name="qwen3-4b-routing-r16",
    report_to="wandb",
    model_init_kwargs={"dtype": COMPUTE_DTYPE},
    max_length=512,
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    lr_scheduler_type="cosine",
    warmup_steps=0.05,
    bf16=SUPPORTS_BF16,
    fp16=not SUPPORTS_BF16,
    logging_steps=5,
    eval_strategy="steps",
    eval_steps=20,
    save_strategy="steps",
    save_steps=20,
    save_total_limit=3,
    load_best_model_at_end=True,
    metric_for_best_model="eval_loss",
    greater_is_better=False,
    seed=42,
)
```

What each value does, and why it was chosen:

| Setting | Value | Meaning and reason |
|---|---|---|
| `bnb_4bit_*` | NF4, double quant | store the frozen base in 4-bit (G4.2). This is what makes it QLoRA. |
| `r`, `lora_alpha` | 16, 32 | adapter capacity, and scale α/r = 2. Enough for one narrow task; α = 2r follows TRL's guide. |
| `lora_dropout` | 0.05 | light regularization for a small dataset |
| `target_modules` | `"all-linear"` | adapt every linear layer ("LoRA Without Regret") |
| `model_init_kwargs` | `{"dtype": COMPUTE_DTYPE}` | the dtype of the parts left unquantized (embeddings, norms, output head). `SFTTrainer` defaults to float32 when this is unset, which wastes memory. |
| `max_length` | 512 | the token limit per example; longer examples are truncated. Set it just above the longest example (G4.4). |
| `num_train_epochs` | 3 | passes over the data. Small datasets need several; the best-checkpoint settings guard against too many. |
| `per_device_train_batch_size` × `gradient_accumulation_steps` | 4 × 4 = 16 | **gradient accumulation** sums the gradients of 4 small batches before one update. Memory stays that of a batch of 4, while each update sees 16 examples. Keep the effective batch under 32 for LoRA. |
| `learning_rate` | 2e-4 | the step size; about 10× the full fine-tuning rate, as TRL recommends for LoRA |
| `lr_scheduler_type` | `"cosine"` | lowers the learning rate along a cosine curve to near 0 by the last step, for small, careful updates at the end |
| `warmup_steps` | 0.05 | a float below 1 is a ratio: the first 5% of steps raise the learning rate from 0, so the fresh adapter takes no large early steps |
| `bf16` / `fp16` | by GPU | mixed precision: bf16 on Ampere or newer, fp16 on a T4 |
| `eval_steps`, `save_steps` | 20 | score the validation split and save a checkpoint every 20 updates. This gives the eval-loss curve and the checkpoint to keep (G4.5). |
| `load_best_model_at_end` | with `eval_loss` | reload the lowest-eval-loss checkpoint when training ends |
| `seed` | 42 | makes shuffling and adapter initialization repeatable |

Other settings keep the `SFTConfig` defaults: gradient checkpointing on, the fused AdamW optimizer (AdamW with each update run as one GPU operation, which is faster), and completion-only loss. If memory runs short, set `optim="paged_adamw_8bit"`, a bitsandbytes optimizer from the QLoRA paper that stores its state in 8-bit and pages it to CPU memory under pressure.

**The step count**, worked through: 800 training rows ÷ an effective batch of 16 = 50 updates per epoch. Three epochs make 150 updates, with 7 evaluations (every 20 updates) and a warmup of about 8 updates (5% of 150, rounded up).

**Step 5 — build the trainer and train.**

```python
from trl import SFTTrainer

trainer = SFTTrainer(
    model=MODEL_ID,
    args=training_args,
    train_dataset=splits["train"],
    eval_dataset=splits["val"],
    peft_config=lora,
    quantization_config=quantization,
)


def keep_adapter_in_float32(model) -> None:
    for parameter in model.parameters():
        if parameter.requires_grad:
            parameter.data = parameter.data.float()


if not SUPPORTS_BF16:
    keep_adapter_in_float32(trainer.model)

trainer.model.print_trainable_parameters()
trainer.train()
```

- From the model name, `SFTTrainer` loads the model in 4-bit (`quantization_config`), wraps it with the LoRA adapter (`peft_config`), loads the tokenizer, applies the chat template, and masks the prompt tokens.
- **The T4 fix.** In TRL 1.14.1, `SFTTrainer` casts the adapter weights of a 4-bit model to bfloat16. fp16 mixed precision uses a gradient scaler, which multiplies the loss so that small gradients do not round to zero in fp16, then divides them back ("unscales") before the update. PyTorch's CUDA unscale kernel, the GPU function that does that division, only handles float32, float64, and float16 gradients. Without the fix, the first update fails with `"_amp_foreach_non_finite_check_and_unscale_cuda" not implemented for 'BFloat16'`. `keep_adapter_in_float32` moves the adapter back to float32, the usual QLoRA setup on fp16 GPUs. The optimizer is created inside `train()`, so it picks up the float32 weights.
- `print_trainable_parameters()` should report about 33 million trainable parameters, about 0.8% (G4.2).

**What to watch in W&B** while it runs. The integration prefixes each metric with `train/` or `eval/`.

- `train/loss` and `eval/loss` — both should fall. Read them with the G4.5 table.
- `train/mean_token_accuracy` — the share of answer tokens predicted exactly. For a short JSON answer it should climb near 1.
- `train/learning_rate` — the warmup ramp, then the cosine decay: a quick check that the schedule is what you meant.
- `train/grad_norm` — the size of the gradient before clipping, which shrinks any gradient larger than a limit (1.0 by default). Repeated large spikes mean the learning rate is too high.

**Step 6 — save the adapter.** With `load_best_model_at_end`, the model in memory is the best checkpoint.

```python
trainer.save_model(ADAPTER_DIR)
trainer.processing_class.save_pretrained(ADAPTER_DIR)
wandb.finish()
```

`ADAPTER_DIR` now holds `adapter_config.json`, `adapter_model.safetensors` (tens of MB), and the tokenizer files. The adapter config records the base model's name.

**Step 7 — keep it.** Push it to the Hugging Face Hub, the model-sharing site the base model was downloaded from, as a private repository. Log in first with `huggingface_hub.login()` and a write token.

```python
trainer.model.push_to_hub("<your-username>/qwen3-4b-routing-lora", private=True)
```

**Step 8 — load it and try it** in a fresh session (run steps 2 and 3 first):

```python
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

quantization = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=COMPUTE_DTYPE)
base = AutoModelForCausalLM.from_pretrained(MODEL_ID, quantization_config=quantization, dtype=COMPUTE_DTYPE, device_map="auto")
model = PeftModel.from_pretrained(base, ADAPTER_DIR)
model.eval()
tokenizer = AutoTokenizer.from_pretrained(ADAPTER_DIR)

question = [
    {"role": "system", "content": splits["test"][0]["prompt"][0]["content"]},
    {"role": "user", "content": "Why does my HNSW index miss neighbors when ef_search is low?"},
]
print(predict(model, tokenizer, question))
print(score(model, tokenizer, list(splits["test"])))
```

`predict` and `score` are the G4.5 functions. `score` on the test split, with `disable_adapter()` for the baseline, gives the before-and-after table for the capstone write-up. `AutoPeftModelForCausalLM.from_pretrained(ADAPTER_DIR)` is a one-line alternative: it reads the base model's name from the adapter config.

**Step 9 — merge for serving (optional).** Merge into a 16-bit copy of the base, never the 4-bit one (G4.2). The result is an ordinary model folder that vLLM or Ollama can load (G4.6 L3):

```python
base_16bit = AutoModelForCausalLM.from_pretrained(MODEL_ID, dtype=COMPUTE_DTYPE, device_map="auto")
merged = PeftModel.from_pretrained(base_16bit, ADAPTER_DIR).merge_and_unload()
merged.save_pretrained("routing-merged")
tokenizer.save_pretrained("routing-merged")
```

**When it breaks:**

| Symptom | Fix |
|---|---|
| `CUDA out of memory` | halve `per_device_train_batch_size` and double `gradient_accumulation_steps` (the effective batch stays the same); lower `max_length`; set `optim="paged_adamw_8bit"` |
| `Your setup doesn't support bf16/gpu` | `bf16=True` on a pre-Ampere GPU; use the `SUPPORTS_BF16` switch above |
| `… not implemented for 'BFloat16'` on the first step | the T4 fix was skipped |
| `--load_best_model_at_end requires the saving steps to be a multiple of the evaluation steps` | make `save_steps` a multiple of `eval_steps` |
| `loss` becomes `nan` in fp16 | lower the learning rate, or use a bf16 GPU |
| the output is not valid JSON | check that each training completion is valid JSON, and that inference uses the same system prompt |

**The same run with Unsloth.** **Unsloth** is a library with hand-written GPU kernels. It trains LoRA and QLoRA faster and with less memory, and plugs into `SFTTrainer`. Only the model loading changes (TRL's Unsloth guide):

```python
from unsloth import FastLanguageModel
from trl import SFTTrainer

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen3-4B-Instruct-2507",
    max_seq_length=512,
    dtype="auto",
    load_in_4bit=True,
)
model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    lora_alpha=32,
    lora_dropout=0,
    bias="none",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing=True,
    random_state=3407,
)
trainer = SFTTrainer(model=model, processing_class=tokenizer, args=training_args, train_dataset=splits["train"], eval_dataset=splits["val"])
trainer.train()
```

- Run it in a fresh session, importing `unsloth` before `trl` and `transformers`, since Unsloth patches them when imported (unsourced).
- Drop `model_init_kwargs` from `training_args`. The model is already loaded, so `SFTTrainer` ignores it and logs a warning.
- Unsloth's guide notes that `lora_dropout=0` and `bias="none"` take its optimized path.
- Whether Unsloth's patched trainer still needs the T4 fix is unverified. If the first step raises the BFloat16 error, apply `keep_adapter_in_float32(trainer.model)` before `train()`.

Sources: [TRL — SFT Trainer (v1.14.1)](https://huggingface.co/docs/trl/sft_trainer) · [Unsloth PR noting TRL 0.20 removed `max_seq_length` and `tokenizer`](https://github.com/unslothai/unsloth/pull/10740) · [PEFT issue — `torch_dtype` deprecated for `dtype`](https://github.com/huggingface/peft/issues/2835) · [TRL — PEFT integration (QLoRA)](https://huggingface.co/docs/trl/peft_integration) · [TRL — LoRA Without Regret](https://huggingface.co/docs/trl/lora_without_regret) · [TRL — Unsloth integration](https://huggingface.co/docs/trl/unsloth_integration) · [TRL source — adapter cast to bfloat16 for 4-bit models (`sft_trainer.py`, v1.14.1)](https://github.com/huggingface/trl/blob/v1.14.1/trl/trainer/sft_trainer.py) · [TRL source — bf16 "Requires Ampere or higher"](https://github.com/huggingface/trl/blob/v1.14.1/trl/trainer/base_config.py) · [PyTorch source — AMP unscale kernel dtypes](https://github.com/pytorch/pytorch/blob/main/aten/src/ATen/native/cuda/AmpKernels.cu) · [Transformers — `TrainingArguments` (v5.17)](https://huggingface.co/docs/transformers/main_classes/trainer) · [W&B — Hugging Face Transformers integration](https://docs.wandb.ai/models/integrations/huggingface_transformers) · [Qwen3-4B-Instruct-2507 model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) · [Qwen3-1.7B model card](https://huggingface.co/Qwen/Qwen3-1.7B) · [NVIDIA T4 specifications](https://www.nvidia.com/en-us/data-center/tesla-t4/) · [Google Colab FAQ](https://research.google.com/colaboratory/faq.html) · [Dettmers et al., QLoRA paper (paged optimizers)](https://arxiv.org/abs/2305.14314)
