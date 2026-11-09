---
title: Evaluation metrics
---

A **metric** is a number that scores a model's predictions against the true answers. The right one depends on the task and on what each kind of mistake costs.

**Classification.** Most classifiers output a **score** from 0 to 1, and a **threshold** turns it into a yes or no. A smoke detector is one: it scores the smoke it senses, and a reading of 0.8 against a threshold of 0.5 sounds the alarm. Every prediction then lands in one of four cells of the **confusion matrix**, a table counting predictions against the truth:

| | real fire | no fire (burnt toast, steam) |
|---|---|---|
| **alarm sounds** | true positive (TP) | false positive (FP): a **false alarm** — it beeps at toast |
| **stays silent** | false negative (FN): a **miss** — silent during a real fire | true negative (TN) |

A false alarm is noisy: someone notices it at once. A miss is silent: nothing happens at the moment it occurs, and it is found later, if ever. So misses are harder to notice and harder to count, since counting them needs the truth about the cases the model let pass.

- **Accuracy** — the share of all predictions that are right: (TP + TN) / all. It misleads when one class is rare: if 1 reading in 100 is a real fire, a detector that never sounds is 99% accurate, and useless.
- **Precision** — of the items predicted positive, the share that truly are: TP / (TP + FP). It answers "when the alarm sounds, how often is there a real fire?" It matters when false alarms are costly, such as evacuating a hospital for burnt toast.
- **Recall** — of the items truly positive, the share the model found: TP / (TP + FN). It answers "of the real fires, how many set off the alarm?"; 1 − recall is the miss rate. It matters when misses are costly, and for a fire, a miss is the worst outcome.
- **F1** — one number that is high only when both precision and recall are high: 2 × precision × recall / (precision + recall). It tells you how good the model is at the positive class, counting both misses and false alarms, and ignoring the easy true negatives. It drags toward the weaker of the two: precision 1.0 with recall 0.2 averages to 0.6, which looks fine, but F1 is 0.33, which shows one of them is bad. Use it to compare models with one number when misses and false alarms cost about the same.
- **ROC-AUC** (area under the ROC, receiver operating characteristic, curve, which plots recall against the share of negatives wrongly flagged at every threshold; the curve: G2.2 L3) — a score of the model's ranking that needs no threshold: the chance that a random positive item gets a higher score than a random negative one. It tells you how well the model's scores separate the classes before you choose any threshold: 0.9 means 90% of positive–negative pairs are ranked the right way round. 0.5 is a coin flip, scores with no signal; 1.0 ranks perfectly, so some threshold separates the classes completely. Use it to compare how well models rank. On very imbalanced data it can look good while precision is poor; PR-AUC is the better check there (G2.2 L3).

Precision and recall pull against each other through the threshold. Raising it calls fewer items positive, so false alarms drop (precision rises) and misses grow (recall falls). The walkthrough below moves the threshold.

**Regression.**

- **RMSE** (root mean squared error) — the typical size of a prediction's error, in the target's own units: square each error, average them, take the square root. Squaring makes large errors count more than small ones. An RMSE of 20,000 on house prices in dollars means predictions are typically about $20,000 off.

**Language models.**

- **Perplexity** — how surprised a language model (a model that writes text by predicting the next **token**, a word or a piece of a word; G3.1) is by real text, from the probabilities it gave each actual next token. Lower is better; a perplexity of 10 means the model is, on average, about as unsure as choosing among 10 equally likely tokens. It measures fluency, not whether an answer is true or useful.
- **BLEU** and **ROUGE** — scores of word overlap between generated text and a human-written reference. BLEU counts how much of the output appears in the reference (built for machine translation); ROUGE counts how much of the reference appears in the output (built for summarization). A correct answer phrased differently scores low, so LLM answers are usually judged by other means (G4, G5).

Source: [scikit-learn — Metrics and scoring](https://scikit-learn.org/stable/modules/model_evaluation.html)
