---
title: Evaluating a fine-tune
---

A fine-tune is judged by comparison: it must beat the cheaper option on the task, and it must not break what the model already did well.

- **Baseline** — the model the fine-tune must beat, scored the same way: usually the same base model with a good prompt, or whatever runs in production today. Without it, a score of 90% says nothing: prompting alone might have reached 92%, at no training cost.
- **Test set** — held-out examples, never used in training, that both models answer (G2.3). A model scored on its own training examples looks better than it is.
- **Task metric** — the score that fits the task: accuracy or F1 for a classifier, exact match of fields for extraction (G2.2), human or LLM-judge ratings for open-ended text (an LLM judge is a strong model asked to grade each answer against written criteria; in depth: G4.5 L2).

Two risks decide whether the gain is real:

- **Catastrophic forgetting** — a model losing what it learned before while it learns something new. A model fine-tuned only on extracting invoice fields may get worse at general questions, at following other instructions, or at refusing harmful requests. It is common when LLMs are fine-tuned on one narrow task after another, so a fine-tune is also tested on a sample of general tasks, not only the target task.
- **Overfitting** (G2.1) — the model memorizes the training examples instead of learning the task: near-perfect on them, worse on new inputs, sometimes repeating training answers word for word. Small datasets trained for many passes invite it. The gap between the training score and the test score reveals it.

An evaluation therefore reports at least two numbers for each model (illustrative figures):

| | target task | general tasks |
|---|---|---|
| baseline, prompted | 78% | 71% |
| fine-tuned | 93% | 52% |

Here the fine-tune wins its task by 15 points and loses 19 on everything else. Whether it ships depends on whether the application ever needs the lost abilities; a model that only ever extracts invoices may not.

Sources: [Luo et al., catastrophic forgetting in LLM fine-tuning](https://arxiv.org/abs/2308.08747) · [Qi et al., fine-tuning on harmless data weakens safety](https://arxiv.org/abs/2310.03693)
