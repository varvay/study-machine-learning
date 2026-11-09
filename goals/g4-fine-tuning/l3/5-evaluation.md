---
title: Evaluating a fine-tune
---

L2 compared the fine-tune with its baseline on a held-out set, read the training and eval loss curves, and checked general ability with lm-evaluation-harness and an LLM judge. At L3 the questions are how to build an eval whose score predicts production value, how to limit forgetting, and how to confirm the gain with real users.

**An eval that predicts production value.** An offline score is worth trusting when it agrees with what happens after release. Six properties get it there:

- **Production inputs** — sample eval inputs from real traffic, stratified by the slices that matter (customer segment, language, input length), not from the same source as the training data.
- **The business metric** — score what the product is paid for: fields extracted exactly, tickets routed correctly, answers a reviewer accepts, valid JSON. Loss and word-overlap scores are proxies; report them, but decide on the task metric. Add cost and latency per request, since a win that doubles either may not ship.
- **Enough examples** — a score on n examples is uncertain. At 80% accuracy on 500 examples the standard error is √(0.8 × 0.2 / 500) = 1.8 points, so the 95% interval is about ±3.5 points. Telling two models 2 points apart, each scored on its own sample, needs about 2 × 0.16 × (1.96 / 0.02)² ≈ 3,100 examples each. Scoring both on the same examples and testing only where they disagree (McNemar's test, which counts the examples only one model got right, or a paired bootstrap, which resamples the examples many times to see how often the gap holds; G2.2 L3) needs far fewer.
- **Slices reported separately** — an average hides a slice that got worse (G2.5).
- **A regression suite** — general skills and safety behaviors the fine-tune must not lose, checked next to the task metric.
- **Validated against production** — score past model versions offline and compare with how they did online. If the offline ranking matches the online one, the eval predicts; if not, fix the eval before trusting it.

When an LLM judges open-ended answers, it brings its own biases: it favors the first answer shown, longer answers, and answers from its own model family (Zheng et al.). Swap the answer order and average, give it a rubric and a reference answer, use a judge from a different model family than the one being tested, and check its agreement with about 100 human labels before relying on it (G3.2).

**A release gate**, written down before the results are in: ship only if the task metric beats the baseline by at least the chosen margin with the interval excluding zero, no slice drops by more than an agreed amount, the regression suite holds within tolerance, and cost and latency stay within budget. A gate set after seeing the numbers bends to them (G6.5).

**Catastrophic forgetting** is a model losing abilities it had before fine-tuning while it learns the new task. Luo et al. observed it in models from 1B to 7B parameters during continued instruction tuning, and within that range it grew worse with model size. Five levers limit it, each with its cost:

| Lever | Why it limits forgetting | Cost |
|---|---|---|
| **Lower learning rate** | smaller steps move the weights less from where pretraining left them | slower learning of the new task; LoRA usually needs a higher rate than full fine-tuning, as TRL's docs note |
| **Fewer epochs** | forgetting and overfitting both grow with repeated passes over a small dataset | may stop before the task is learned; pick the checkpoint by eval, not by the last step |
| **LoRA** | the base weights stay frozen and the update is low-rank; Biderman et al. found LoRA forgets less than full fine-tuning, and better than weight decay or dropout do | a lower ceiling on hard, far-from-pretraining tasks (G4.2) |
| **Mix in general data** | a share of general instruction examples keeps rehearsing old skills; InstructGPT's PPO-ptx mixed pretraining data into RLHF for the same reason (G4.3) | more tokens to train on; the right share is found by experiment (unsourced) |
| **A KL anchor** | in preference tuning, β penalizes drifting from the reference model (G4.3) | a larger β also limits how much the model improves |

To see forgetting, run the same regression suite on the base and the fine-tuned model. lm-evaluation-harness loads a LoRA adapter directly:

```bash
lm_eval --model hf \
  --model_args pretrained=meta-llama/Llama-3.1-8B-Instruct,peft=./adapter \
  --tasks mmlu,hellaswag,gsm8k,ifeval \
  --batch_size auto
```

`mmlu` (multiple-choice knowledge questions across 57 subjects) and `gsm8k` (grade-school math word problems) join the L2 tasks. Pair it with your own set of 50 to 100 prompts for behaviors the product relies on, such as refusing out-of-scope requests or answering in the user's language; public benchmarks rarely cover them.

**Overfitting** shows in the curves as eval loss rising while training loss keeps falling, and in outputs as phrasing copied from training examples. Stop at the best checkpoint by eval: in `transformers` training arguments, `load_best_model_at_end=True` with `metric_for_best_model` set, plus an `EarlyStoppingCallback(early_stopping_patience=...)`, which stops training after that many evaluations without improvement. Eval loss and the task metric can disagree, since loss rewards confident probabilities on the exact reference tokens while the metric may only check the final label (unsourced); when they disagree, the task metric decides.

**A/B tests in production.** An A/B test sends a random share of real traffic to the new model and compares outcomes with the current one. Offline evals cannot measure how users react, how the model handles inputs nobody sampled, or what happens in the rest of the product. Stages, each a gate for the next:

1. **Shadow** — the new model runs on copies of live requests and its outputs are logged, not shown. It catches crashes, latency, and format failures on real inputs at no user risk.
2. **Canary** — a small share of users, such as 1% then 5%, with automatic rollback when a guardrail metric (below) crosses its limit.
3. **A/B** — a fixed split, run to a sample size decided in advance.

- **Randomize by user**, not by request: one person switching between models muddies both arms and their experience.
- **One primary metric** decided in advance, such as ticket resolution rate, thumbs-up rate, or the share of answers a user edits; **guardrail metrics** alongside it: p95 latency (the time within which 95% of requests finish), cost per request, complaint and safety-flag rates.
- **Size it first.** To detect a rise in thumbs-up rate from 60% to 63% at 5% significance (the accepted false-positive rate) with 80% power (the chance of detecting a real rise of that size): n = (1.96 + 0.84)² × (0.60 × 0.40 + 0.63 × 0.37) / 0.03² ≈ 4,100 users per arm. Checking the result every day and stopping at the first significant value inflates false positives; fix the duration, or use a sequential test designed for repeated looks.
- **Cover a full weekly cycle**, and discount the first days: users behave differently with something new.

**In an interview**

- *Your fine-tuned model beats the baseline offline, but the A/B test shows no gain. Why?* The offline eval did not predict production: its inputs came from the training distribution rather than live traffic, it scored a proxy the users do not care about, or the difference was within its noise. It could also be the test: too few users for the effect size, or a primary metric that the model's improvement does not move. I would compare the eval's inputs and slices with live traffic, recompute the offline confidence interval, and check whether the metric responds to model quality at all, for example with a deliberately worse model.
- *How do you limit catastrophic forgetting?* Measure it first: the same regression suite on the base and the fine-tuned model. Then use the levers: LoRA rather than full fine-tuning, a lower learning rate, fewer epochs with the best checkpoint chosen by eval, and some general instruction data mixed into the training set. For preference tuning, the KL coefficient β keeps the model near its reference.

Sources: [Zheng et al., Judging LLM-as-a-Judge](https://arxiv.org/abs/2306.05685) · [Luo et al., catastrophic forgetting in continual instruction tuning](https://arxiv.org/abs/2308.08747) · [Biderman et al., LoRA Learns Less and Forgets Less](https://arxiv.org/abs/2405.09673) · [Ouyang et al., InstructGPT paper (PPO-ptx)](https://arxiv.org/abs/2203.02155) · [TRL — DPO Trainer (learning rate for adapters)](https://huggingface.co/docs/trl/dpo_trainer) · [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) · [Transformers — `EarlyStoppingCallback` source](https://github.com/huggingface/transformers/blob/main/src/transformers/trainer_callback.py) · [Kohavi et al., Controlled experiments on the web: survey and practical guide](https://doi.org/10.1007/s10618-008-0114-1)
