---
title: Evaluating a fine-tune
---

Recap (G4.5 L1): a fine-tune is judged against a baseline on data it never saw, and checked for two failures. **Overfitting** means it memorized the training set. **Catastrophic forgetting** means it lost general skills it had before. In practice there are four checks: a held-out task score, the loss curves, a regression run on general benchmarks, and an LLM judge for free-text answers.

**1. Held-out task eval.** Score every candidate on the frozen test split (G4.4), with the same inputs, the same decoding (the rule for picking each next token; G3.2 L1), and the same parser:

- **the baseline**: the base model with the same system prompt, untrained;
- **the bar**: the strong prompted model from the decision procedure (G4.1);
- **the fine-tune**: the base model plus the adapter.

Decode **greedily** (`do_sample=False`: always take the most likely token), so a score changes only when the model does. For the routing task, three metrics matter: the share of valid JSON, accuracy, and **macro-F1**, the F1 of each class averaged with equal weight, so rare goals count as much as common ones (G2.2). The code takes both metrics from scikit-learn, a widely used Python ML library.

```python
import json

import torch
from sklearn.metrics import accuracy_score, f1_score

INVALID = "INVALID"


def predict(model, tokenizer, prompt_messages: list[dict]) -> str:
    text = tokenizer.apply_chat_template(prompt_messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(text, return_tensors="pt").to(model.device)
    with torch.no_grad():
        output = model.generate(**inputs, max_new_tokens=32, do_sample=False)
    return tokenizer.decode(output[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)


def parse_goal(answer: str) -> str:
    try:
        return json.loads(answer)["goal"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return INVALID


def score(model, tokenizer, test_examples: list[dict]) -> dict:
    expected = [json.loads(example["completion"][0]["content"])["goal"] for example in test_examples]
    predicted = [parse_goal(predict(model, tokenizer, example["prompt"])) for example in test_examples]
    return {
        "valid_json": sum(goal != INVALID for goal in predicted) / len(predicted),
        "accuracy": accuracy_score(expected, predicted),
        "macro_f1": f1_score(expected, predicted, average="macro"),
    }
```

Score the baseline and the fine-tune from one loaded model. The PEFT context manager `disable_adapter()` switches the adapter off:

```python
with tuned_model.disable_adapter():
    baseline_scores = score(tuned_model, tokenizer, test_examples)
tuned_scores = score(tuned_model, tokenizer, test_examples)
```

Then read the failures one by one and tag them (G2.5). A confusion between two goals often traces back to inconsistent labels in the training data.

**2. Loss curves.** A **loss curve** plots the loss against training progress. Two are needed:

- **train loss** — the loss on the batches being trained on, logged every `logging_steps`;
- **eval loss** — the loss on the validation split, computed every `eval_steps`.

Train loss alone always looks good, because the model is fitting exactly that data. Eval loss shows whether the fit carries over to new examples. Ask the trainer to evaluate and checkpoint (save a copy of the adapter weights) on the same schedule, and to keep the checkpoint with the lowest eval loss:

```python
from trl import SFTConfig

args = SFTConfig(
    output_dir="routing-out",
    eval_strategy="steps",
    eval_steps=20,
    save_strategy="steps",
    save_steps=20,
    logging_steps=5,
    load_best_model_at_end=True,
    metric_for_best_model="eval_loss",
    greater_is_better=False,
    save_total_limit=3,
)
```

`load_best_model_at_end` requires `save_steps` to be a multiple of `eval_steps`. `save_total_limit` keeps disk use bounded, and the best checkpoint is always kept. The walkthrough below plays the two curves epoch by epoch and marks the checkpoint the trainer would keep.

How to read the curves (common diagnostics; unsourced):

| What you see | Likely cause | What to try |
|---|---|---|
| both fall, then flatten, with a small gap | learning, and it transfers | keep; stop where eval loss flattens |
| train keeps falling, eval turns upward | overfitting | the best checkpoint, fewer epochs, more data, or a lower rank |
| train loss flat from the start | learning rate too low, or every label masked | check the learning rate; check that `mean_token_accuracy` moves |
| spikes, or `nan` | learning rate too high, or fp16 overflow (a value too large for a 16-bit float) | lower the learning rate, add warmup (a learning rate that ramps up from 0 over the first steps; G4.6), use bf16 if the GPU has it (G4.2) |
| train loss near 0 within one epoch | a tiny or duplicated dataset, memorized | dedupe, add data |

**3. Regression checks on general ability.** Catastrophic forgetting only shows on tasks other than the one trained. **lm-evaluation-harness** (EleutherAI, `pip install "lm_eval[hf]"`) runs standard benchmarks from the command line and takes a PEFT adapter through `peft=` in `--model_args`. Run the base model and the adapter with identical flags:

```bash
lm-eval run --model hf \
  --model_args pretrained=Qwen/Qwen3-4B-Instruct-2507,dtype=float16 \
  --tasks arc_easy,hellaswag,ifeval --apply_chat_template \
  --limit 300 --batch_size 8 --output_path results/base

lm-eval run --model hf \
  --model_args pretrained=Qwen/Qwen3-4B-Instruct-2507,peft=./routing-adapter,dtype=float16 \
  --tasks arc_easy,hellaswag,ifeval --apply_chat_template \
  --limit 300 --batch_size 8 --output_path results/tuned
```

- `arc_easy` (grade-school science questions) and `hellaswag` (choosing the sensible sentence ending) test general knowledge and common sense. `ifeval` tests instruction following, which a narrow fine-tune is most likely to damage. `lm-eval ls tasks` lists the rest.
- `--limit 300` scores 300 examples per task. The harness marks it as a testing option, so use the numbers to compare before and after, never as benchmark results.
- The harness prints a standard error beside each score. Treat a difference smaller than about two standard errors as noise.

A clear drop means the adapter is forgetting. The ways to limit that are the L3 part of this item.

**4. LLM-as-judge** means a strong model grades outputs against a rubric. It is used where no exact answer exists, such as summaries or explanations. A **pairwise** judge sees the same question answered by the baseline and by the fine-tune, and picks the better answer. Zheng et al. found strong judges agree with human preferences over 80% of the time, the same rate at which humans agree with each other. They also found position, verbosity, and self-enhancement biases: judges favor an answer for where it sits in the prompt, for being longer, or for being their own model's. So shuffle the order of the two answers:

```python
import json
import random

import boto3

bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
JUDGE_MODEL_ID = "<a strong model enabled in your Bedrock account>"
RUBRIC = "correct, complete, concise, and in the required format"


def judge_pair(question: str, baseline_answer: str, tuned_answer: str, shuffler: random.Random) -> str:
    tuned_first = shuffler.random() < 0.5
    first, second = (tuned_answer, baseline_answer) if tuned_first else (baseline_answer, tuned_answer)
    request = (
        f"Question:\n{question}\n\nAnswer A:\n{first}\n\nAnswer B:\n{second}\n\n"
        f"Which answer is better? Judge only by this rubric: {RUBRIC}. "
        'Reply with JSON only: {"winner": "A" | "B" | "tie", "reason": "<one sentence>"}'
    )
    response = bedrock.converse(
        modelId=JUDGE_MODEL_ID,
        messages=[{"role": "user", "content": [{"text": request}]}],
        inferenceConfig={"temperature": 0.0, "maxTokens": 200},
    )
    winner = json.loads(response["output"]["message"]["content"][0]["text"])["winner"]
    if winner == "tie":
        return "tie"
    return "tuned" if (winner == "A") == tuned_first else "baseline"
```

- Report the **win rate**: tuned wins ÷ (tuned wins + baseline wins), with the tie count beside it.
- **Check the judge** before trusting it: label 30 pairs yourself and measure how often it agrees with you.
- **Use a different model family as judge** from the one being tested, since judges favor their own style (self-enhancement bias).

Sources: [TRL — SFT Trainer (logged metrics, `SFTConfig`)](https://huggingface.co/docs/trl/sft_trainer) · [Transformers — `TrainingArguments`](https://huggingface.co/docs/transformers/main_classes/trainer) · [PEFT source — `disable_adapter`](https://github.com/huggingface/peft/blob/main/src/peft/peft_model.py) · [scikit-learn — Metrics](https://scikit-learn.org/stable/modules/model_evaluation.html) · [EleutherAI — lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) · [lm-evaluation-harness — CLI interface](https://github.com/EleutherAI/lm-evaluation-harness/blob/main/docs/interface.md) · [Zheng et al., Judging LLM-as-a-Judge](https://arxiv.org/abs/2306.05685) · [Amazon Bedrock — Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)
