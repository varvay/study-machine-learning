---
title: Hands-on fine-tune
---

L2 is the run itself: a QLoRA fine-tune of a 1B to 8B open model with TRL or Unsloth, logged to Weights & Biases. At L3 you walk an interviewer through it: why you ran it, what you set and why, what the curves showed, what broke, and what it bought against the baseline. Interviewers probe in roughly that order. Record each item while the run is live: failures are the first thing forgotten and the most convincing thing to tell.

**The run card.** One page per run, filled in as you go. The right column is what an interviewer listens for.

| Field | Record | A strong answer shows |
|---|---|---|
| **Task and metric** | the capstone task (e.g. structured extraction), its business metric, the pass bar | the metric was chosen before training |
| **Baseline** | the prompted model, its score, cost per 1,000 requests, p95 latency | the fine-tune had a number to beat (G4.1) |
| **Base model** | name, size, instruct or base, license | why this one: size fits the GPU and the latency budget, license fits the use (G4.4) |
| **Data** | train/eval sizes, sources, dedup and contamination checks, DVC version | the eval set was split first and checked for overlap (G4.4) |
| **Method and hyperparameters** | QLoRA or LoRA, rank, alpha, dropout, target modules, learning rate, scheduler, warmup, epochs, effective batch size, `max_length`, packing (joining short examples into full-length sequences so no compute goes to padding), seed | a reason for each, and which were swept |
| **Hardware, time, cost** | GPU, peak memory, wall-clock time, dollars | the memory matched the estimate (G4.2), or you know why not |
| **Curves** | link to the W&B run | you can explain every bump |
| **Results** | the results table below | the win is larger than the eval's noise (G4.5) |
| **Failures** | the failure log below | each failure has a cause and evidence for the fix |
| **Serving** | server, merged or adapter, latency, how the capstone calls it | it runs behind the same interface as the baseline |

**What to log.** With TRL, `SFTConfig(report_to="wandb", run_name=...)` sends the losses, learning rate, gradient norm, and the full config to W&B. Add what the defaults miss:

- the Git commit and the DVC dataset version, so the run can be reproduced (G4.4);
- library versions (`pip freeze`) and the seed;
- peak GPU memory and tokens per second;
- **sample generations** on a fixed set of 10 to 20 eval prompts every few hundred steps, logged as a W&B table. A falling loss says the model fits the tokens; the samples show whether it does the task.

**Hyperparameters, and the question behind each.**

- **Learning rate** — "why this value, and what happened above it?" TRL's `SFTConfig` defaults to 2e-5; LoRA usually runs higher. Try at least two rates and keep the loser's curve; it is the evidence.
- **Effective batch size** — per-device batch × gradient-accumulation steps × GPUs. Accumulation is how a 16 GB GPU reaches a batch of 16: batch 1, 16 steps accumulated.
- **Epochs** — "how did you know when to stop?" Best checkpoint by eval metric, not the last one (G4.5).
- **Rank, alpha, targets** — "why rank 16?" All-linear targets first, then a rank sweep judged on the eval (G4.2).
- **`max_length`** — "how many examples were truncated?" Count them before training; a cut-off answer teaches the model to stop mid-sentence.
- **What the loss is computed on** — "did the model learn from the prompts too?" For prompt-completion data TRL computes the loss on the completion only by default; for chat data set `assistant_only_loss=True`.

**Reading the curves.**

| Pattern | Likely cause | Action |
|---|---|---|
| Training and eval loss fall together, then flatten | healthy | stop near the flattening point |
| Eval loss reaches a minimum, then rises while training loss keeps falling | overfitting | take the checkpoint at the minimum; fewer epochs, more data |
| Training loss drops sharply at each epoch boundary | the model memorizes examples it sees again (unsourced) | fewer epochs; check duplicates |
| Loss near zero within a few steps | duplicates, leakage, or loss on trivial template tokens | check the loss mask and overlap (G4.4) |
| Spikes or `NaN` | learning rate too high, fp16 overflow, or a malformed row | warmup, lower rate, bf16, gradient clipping (`max_grad_norm`, default 1.0), find the row by step |
| Loss barely moves | rate too low, adapters on the wrong modules, or labels fully masked | print `model.print_trainable_parameters()`; inspect one batch's labels |

**The failure log.** Each entry: symptom, cause, fix, evidence the fix worked. Failures a first run commonly meets:

- **Out of memory** — step down in order: per-device batch 1 with gradient accumulation, gradient checkpointing (on by default in TRL's configs), a shorter `max_length`, QLoRA, a paged 8-bit optimizer (`optim="paged_adamw_8bit"`). Compare the peak with the G4.2 estimate.
- **Garbage output after training** — the chat template used in serving differs from the one used in training. Render one training example and one serving request and compare them token by token (unsourced as a frequency claim).
- **The model never stops** — end-of-sequence tokens were masked out of the loss, often because the pad token was set to the EOS token (unsourced). Check that labels keep the EOS token.
- **The format is right, the content worse** — overfitting to phrasing or forgetting; look at the regression suite (G4.5).

**The results table.** Fill it from the held-out set only; the interviewer will ask how many examples each number rests on.

| | Prompted large model | Prompted base model (same size, no fine-tune) | Fine-tuned |
|---|---|---|---|
| Task metric, with 95% interval | … | … | … |
| Valid output format | … | … | … |
| Regression suite, change from base | — | 0 | … |
| p50 (median) / p95 latency | … | … | … |
| Cost per 1,000 requests | … | … | … |

The middle column separates what fine-tuning did from what model size did. Close with three real outputs, one win, one loss, one tie, and the error analysis of the remaining failures (G2.5): the interviewer's next question is always "what would you fix next?"

**Serving it, and plugging it into the capstone.** Keep the adapter separate and serve it with vLLM's LoRA support (G4.2):

```bash
vllm serve meta-llama/Llama-3.1-8B-Instruct --enable-lora \
  --lora-modules extractor=./adapter --max-lora-rank 16
```

vLLM speaks the OpenAI API, so the capstone's Spring AI app (Spring AI is the Java framework for LLM calls; G6.2 L1) reaches it through the OpenAI starter (`spring-ai-starter-model-openai`, the dependency that adds an OpenAI client) with the base URL changed. The adapter name is the model name:

```yaml
spring:
  ai:
    openai:
      base-url: http://localhost:8000
      api-key: unused
      chat:
        model: extractor
```

For Ollama, merge the adapter into a 16-bit copy of the base first; Ollama's import guide builds a model from a directory of Safetensors weights, named by the `FROM` line of a Modelfile, Ollama's model recipe file:

```python
import torch
from peft import AutoPeftModelForCausalLM
from transformers import AutoTokenizer

model = AutoPeftModelForCausalLM.from_pretrained("./adapter", dtype=torch.bfloat16)
merged = model.merge_and_unload()
merged.save_pretrained("./merged")
AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B-Instruct").save_pretrained("./merged")
```

```bash
echo "FROM ./merged" > Modelfile
ollama create extractor -f Modelfile
```

Then run the capstone's eval against the served model, not the training notebook: serving changes the template, the sampling settings, and sometimes the precision.

**Questions interviewers ask about a run**, and what the answer must contain:

- *Why fine-tune instead of prompting?* The baseline's score and cost, and which failures prompting could not fix (G4.1).
- *Why this base model?* Size against GPU and latency, license, instruct or base.
- *How much data, and how did you check it?* Counts, audit, contamination check (G4.4).
- *Walk me through your hyperparameters.* A reason for each, and what you swept.
- *Show me the loss curve. What is this bump?* A cause from the table above, with evidence.
- *How do you know it didn't overfit or forget?* Best-checkpoint selection and the regression suite (G4.5).
- *What went wrong?* Two or three failure-log entries.
- *What did it cost, and how is it served?* GPU hours and dollars; merged or adapter, latency.
- *What would you do with ten times the data or budget?* Grounded in the error analysis: which failure class more data would fix, or whether full fine-tuning would now pay (G4.2).

**In an interview**

Fill the brackets from your own run card; never quote numbers you did not measure.

- *Tell me about a model you fine-tuned.* "I fine-tuned [base model] with QLoRA for [task] in the capstone, because the prompted [baseline model] scored [x] at [cost] per 1,000 requests. I trained on [n] audited examples, split before any synthesis and checked for overlap, at rank [r] on all linear layers, learning rate [lr], for [epochs] epochs, picking the checkpoint by eval. It reached [y] against [x] on [m] held-out examples, with the regression suite within [tolerance], and it serves from vLLM behind the same Spring AI interface as the baseline."
- *What went wrong, and what did you learn?* "The first run [symptom from the failure log], because [cause]. I confirmed it by [evidence] and fixed it with [fix]; the next run [result]. I now [habit, e.g. check the chat template token by token] before every run."

Sources: [TRL — SFT Trainer](https://huggingface.co/docs/trl/sft_trainer) · [TRL — `SFTConfig` source (defaults, `assistant_only_loss`)](https://github.com/huggingface/trl/blob/main/trl/trainer/sft_config.py) · [W&B — Hugging Face Transformers integration](https://docs.wandb.ai/guides/integrations/huggingface) · [Transformers — optimizer names (`paged_adamw_8bit`)](https://github.com/huggingface/transformers/blob/main/src/transformers/training_args.py) · [PEFT — LoRA developer guide (`merge_and_unload`)](https://huggingface.co/docs/peft/main/en/developer_guides/lora) · [vLLM — LoRA adapters](https://docs.vllm.ai/en/latest/features/lora.html) · [Spring AI — OpenAI Chat (vLLM configuration)](https://docs.spring.io/spring-ai/reference/api/chat/openai-chat.html) · [Ollama — Importing a model](https://github.com/ollama/ollama/blob/main/docs/import.mdx)
