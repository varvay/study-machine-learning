---
title: SFT and preference tuning
---

Recap (G4.3 L1): supervised fine-tuning (SFT) trains on example answers, and preference tuning trains on pairs of a better and a worse answer. DPO does preference tuning directly on the pairs, with no separate reward model. In practice both run through Hugging Face **TRL** (Transformer Reinforcement Learning), a library of trainers built on `Trainer`, the generic training loop of Hugging Face's Transformers library (which loads and runs models): `SFTTrainer` and `DPOTrainer`.

**SFT** trains the model to predict the example answer one token at a time. Its loss is token-level cross-entropy:

L_SFT(θ) = −Σₜ log p_θ(yₜ | y<ₜ)

- θ — the trainable parameters: the LoRA adapter, when you use PEFT (G4.2).
- yₜ — the token at position t of the target text; y<ₜ — every token before it.
- p_θ(yₜ | y<ₜ) — the probability the model gives the correct next token. The loss is low when the model puts high probability on the example's own tokens.

The sum runs only over tokens that are not **masked**. Masked tokens (label `-100`) still go through the model as context, but they add nothing to the loss. TRL always masks padding (filler tokens that bring every example in a batch to the same length), and it can also mask the prompt:

- **Prompt-completion datasets**: the loss counts only the completion by default (`completion_only_loss`).
- **Conversational `messages` datasets**: set `assistant_only_loss=True` to count only the assistant turns.

Masking the prompt keeps training on the text the model must write, and off the user's questions.

**Dataset formats `SFTTrainer` accepts**, one JSON object per example:

| Format | Example | Loss on |
|---|---|---|
| Language modeling | `{"text": "The sky is blue."}` | all text |
| Conversational | `{"messages": [{"role": "user", "content": "What color is the sky?"}, {"role": "assistant", "content": "It is blue."}]}` | all text, or assistant turns with `assistant_only_loss=True` |
| Prompt-completion | `{"prompt": "The sky is", "completion": " blue."}` | completion |
| Conversational prompt-completion | `{"prompt": [{"role": "user", "content": "What color is the sky?"}], "completion": [{"role": "assistant", "content": "It is blue."}]}` | completion |

The hands-on run (G4.6) uses the last format: it gets chat formatting and completion-only loss with no extra settings.

**Chat templates.** A **chat template** is a Jinja snippet (Jinja is a text-templating language), shipped with the tokenizer, that turns a list of messages into the exact string the model was trained on, special tokens included: reserved tokens that mark structure, such as the start and end of each turn. The TRL docs show Qwen2's template at work:

```python
>>> tokenizer.apply_chat_template([{"role": "user", "content": "Hi!"}], tokenize=False)
'<|im_start|>system\nYou are a helpful assistant.<|im_end|>\n<|im_start|>user\nHi!<|im_end|>\n'
```

- **Train and serve with the same template.** Given conversational data, `SFTTrainer` applies the model's template itself. An inference server, the program that hosts a model and answers requests, such as vLLM or Ollama (G4.6 L3), applies the same template at inference. A model trained on one layout and prompted with another sees text it never learned.
- **The end-of-turn token must be in the target.** Here that is `<|im_end|>`. The model learns to stop by predicting it; without it, generation runs on.
- **A base model with no template** gets one through `SFTConfig(chat_template_path=...)`, which copies a template from another model. Set `eos_token`, the end-of-sequence token that stops generation, to match it.
- `assistant_only_loss=True` needs `{% generation %}` markers in the template, Jinja tags around the text the assistant writes, so TRL knows which tokens to count. TRL patches the template automatically for known families (Qwen, Llama 3, Gemma, and others).

**Minimal SFT with LoRA** (the full QLoRA recipe with every setting explained is G4.6):

```python
from datasets import load_dataset
from peft import LoraConfig
from trl import SFTConfig, SFTTrainer

dataset = load_dataset("json", data_files={"train": "train.jsonl", "validation": "val.jsonl"})

trainer = SFTTrainer(
    model="Qwen/Qwen3-4B-Instruct-2507",
    args=SFTConfig(output_dir="sft-out", learning_rate=2e-4, num_train_epochs=3, max_length=512, eval_strategy="epoch"),
    train_dataset=dataset["train"],
    eval_dataset=dataset["validation"],
    peft_config=LoraConfig(r=16, lora_alpha=32, target_modules="all-linear", task_type="CAUSAL_LM"),
)
trainer.train()
trainer.save_model("sft-adapter")
```

`SFTTrainer` loads the model and tokenizer from the name, applies the chat template, tokenizes, truncates to `max_length` (default 1024), masks, pads, and trains; `eval_strategy="epoch"` scores the validation split after each epoch. It logs `loss`, `mean_token_accuracy` (the share of target tokens the model predicts exactly), and `entropy` (how spread out the model's next-token probabilities are). `SFTConfig` defaults differ from plain `TrainingArguments`, the settings class of the Transformers `Trainer`: learning rate 2e-5 (full fine-tuning; use about 2e-4 with LoRA), bf16 on, gradient checkpointing on.

**DPO** (Direct Preference Optimization) raises the probability of the chosen answer relative to the rejected one, measured against a frozen **reference model**. The reference is the model before DPO. Its loss:

L_DPO(θ) = −E[ log σ( β · ( log π_θ(y⁺|x)/π_ref(y⁺|x) − log π_θ(y⁻|x)/π_ref(y⁻|x) ) ) ]

- x — the prompt; y⁺ — the chosen answer; y⁻ — the rejected answer.
- π_θ — the model being trained (the policy, reinforcement learning's name for the model that chooses outputs); π_ref — the frozen reference.
- π(y|x) — the probability that the model writes the whole answer y after prompt x: the product of the probabilities it gives each of y's tokens in turn, the same per-token probabilities the SFT loss above uses. Its log is the sum of the tokens' log-probabilities, a negative number such as −42.
- log π_θ(y|x)/π_ref(y|x) — how much more likely the trained model makes an answer than the reference does. β times this is DPO's **implicit reward** for that answer.
- σ — the sigmoid function, σ(z) = 1 / (1 + e^(−z)), which maps any number into the range 0 to 1: σ(0) = 0.5, large positive z gives nearly 1.
- E — the average over all pairs.
- β — `beta` (default 0.1). It sets how far the model may drift from the reference: a higher β keeps it closer.

**How to read it, inside out.**

1. For each answer, compute **how far training has moved its log-probability** from the reference's: log π_θ(y|x) − log π_ref(y|x), which equals log π_θ(y|x)/π_ref(y|x).
2. Subtract the rejected answer's move from the chosen answer's move. This is the **margin**: positive when training raised the chosen answer more than the rejected one.
3. Multiply by β and pass it through σ: a score between 0 and 1 for "chosen beats rejected".
4. The loss is −log of that score. It is high when the margin is small or negative, and it falls toward 0 as the margin grows.

**A worked pair.** The prompt is "My order is late." The chosen answer is short and apologetic; the rejected one is long and cold. β = 0.1.

| | log π_ref | log π_θ | move |
|---|---|---|---|
| chosen y⁺ | −40 | −40 | 0 |
| rejected y⁻ | −38 | −38 | 0 |
| **at the start** | | | margin 0, σ(0) = 0.5, loss = −log 0.5 = **0.69** |
| chosen y⁺ | −40 | −35 | +5 |
| rejected y⁻ | −38 | −48 | −10 |
| **after training** | | | margin 5 − (−10) = 15, σ(1.5) = 0.82, loss = **0.20** |

At the start the trained model equals the reference, so every pair begins at a loss of 0.69 and a steep gradient. Training raises the chosen answer and lowers the rejected one until the margin is wide; then σ is near 1, the loss is near 0, and that pair stops pushing. Because the margin is measured against the reference, the model is rewarded for changing its preference between the two answers, not for drifting far from where it started. The absolute log-probabilities do not matter, only the moves: the rejected answer here was more likely at the start (−38 against −40), and DPO reversed that.

The loss is low when the chosen answer's implicit reward clearly beats the rejected one's.

**DPO data** gives each prompt two answers:

```json
{"prompt": [{"role": "user", "content": "Explain HNSW in one sentence."}], "chosen": [{"role": "assistant", "content": "HNSW is a layered graph index that finds approximate nearest neighbors by greedy hops from sparse upper layers down to a dense bottom layer."}], "rejected": [{"role": "assistant", "content": "HNSW is a very popular and important algorithm used in many modern vector databases for search."}]}
```

The pairs come from three common sources:

- **Human choice**: sample two answers from the SFT model and ask a person to pick the better one.
- **Human edits**: a person corrects a bad answer; the corrected text is `chosen`, the original is `rejected`.
- **AI feedback**: a stronger model ranks the two answers against a rubric (LLM-as-judge, G4.5).

**Running DPO after SFT.** DPO usually starts from the SFT model. With PEFT, `DPOTrainer` needs no separate reference: it turns the adapter off, and the model underneath serves as π_ref. So first merge the SFT adapter into its base (G4.2), then train a new DPO adapter on the merged model. That way the reference is the SFT model.

```python
from datasets import load_dataset
from peft import LoraConfig
from trl import DPOConfig, DPOTrainer

pairs = load_dataset("json", data_files="preferences.jsonl", split="train")

trainer = DPOTrainer(
    model="sft-merged",
    args=DPOConfig(output_dir="dpo-out", beta=0.1, learning_rate=5e-6, num_train_epochs=1, max_length=1024),
    train_dataset=pairs,
    peft_config=LoraConfig(r=16, lora_alpha=32, target_modules="all-linear", task_type="CAUSAL_LM"),
)
trainer.train()
```

- **Learning rate**: `DPOConfig`'s default of 1e-6 is for full fine-tuning. TRL's PEFT guide recommends 5e-6 with LoRA.
- **What to watch** in the logs:
  - `rewards/chosen` and `rewards/rejected` — the average implicit rewards;
  - `rewards/margins` — chosen minus rejected, which should grow;
  - `rewards/accuracies` — the share of pairs where the chosen reward is higher, which should rise toward 1.
- **Warning sign**: both rewards falling fast. The TRL docs note that DPO in practice mostly works by lowering the rejected answer's likelihood. If the chosen one sinks too, the model is drifting from the reference, so raise β or lower the learning rate.

Sources: [TRL — SFT Trainer (v1.14.1)](https://huggingface.co/docs/trl/sft_trainer) · [TRL — DPO Trainer (v1.14.1)](https://huggingface.co/docs/trl/dpo_trainer) · [TRL — Chat templates](https://huggingface.co/docs/trl/chat_templates) · [TRL — PEFT integration](https://huggingface.co/docs/trl/peft_integration) · [Rafailov et al., DPO paper](https://arxiv.org/abs/2305.18290)
