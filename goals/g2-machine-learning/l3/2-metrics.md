---
title: Evaluation metrics
---

**PR-AUC over ROC-AUC on imbalanced data.** The ROC curve plots recall (the true positive rate) against the **false positive rate**, FP / (FP + TN): the share of negatives wrongly flagged. When negatives vastly outnumber positives, TN is huge, so thousands of false alarms barely move that rate.

Take 100,000 payments with 100 frauds. A model catches 80 of them and raises 1,000 false alarms:

- false positive rate = 1,000 / 99,900 = 1%, recall = 80% — a point near the top-left corner of the ROC plot, which looks excellent;
- precision = 80 / 1,080 = 7.4% — 13 of every 14 alerts are wrong, which the fraud team sees at once.

The **precision-recall (PR) curve** plots precision against recall, and precision divides by what the model flagged, so false alarms show in full. Its area, **PR-AUC**, is usually computed as **average precision** (AP): the precision at each threshold weighted by the recall gained there (`average_precision_score`). scikit-learn computes it without interpolation, because the trapezoid rule (joining the points with straight lines) overstates the area. Saito and Rehmsmeier showed PR plots reveal what ROC plots hide on imbalanced data.

Two properties decide when to use which:

- **Baseline.** A random ranking scores ROC-AUC 0.5 on any data, but PR-AUC equal to the positive rate: 0.001 in the example. A PR-AUC of 0.3 there is 300 times better than chance, so always report the positive rate next to it.
- **Dependence on the positive rate.** ROC-AUC ignores the class ratio; precision, and so PR-AUC, moves with it. A test set whose negatives were downsampled inflates PR-AUC against production. Compute PR-AUC on data with the production ratio; use ROC-AUC to compare a model across populations whose base rates differ.

When the business runs at one operating point ("review the top 500 alerts a day"), neither area matters: report precision at that cut-off, or recall at a fixed precision.

**Metrics weighted by business cost.** Precision and recall count errors; a business pays for them, and a missed fraud costs far more than a false alarm. A **cost matrix** assigns each cell of the confusion matrix (G2.2 L1) a price; the model is judged by expected cost = c_FP × FP + c_FN × FN, with correct predictions costing 0.

When the model's scores are **calibrated** probabilities (of the items scored 0.2, about 20% are truly positive), the cost-minimizing threshold follows directly (Elkan):

p* = c_FP / (c_FP + c_FN)

Flag an item when its probability is at least p*. If a missed fraud costs $500 and reviewing a false alarm costs $5, p* = 5 / 505 ≈ 0.01: flag anything with at least a 1% chance of fraud. Scores are often not calibrated, and training with class weights or resampling (G2.3 L2) shifts them away from true probabilities by design. So either calibrate first (`CalibratedClassifierCV` learns a mapping from scores to true probabilities on held-out folds), or search for the threshold that minimizes cost on validation data:

```python
from sklearn.metrics import make_scorer
from sklearn.model_selection import TunedThresholdClassifierCV

def business_gain(y_true, y_pred):
    false_alarms = ((y_pred == 1) & (y_true == 0)).sum()
    missed_frauds = ((y_pred == 0) & (y_true == 1)).sum()
    return -(5 * false_alarms + 500 * missed_frauds)

tuned = TunedThresholdClassifierCV(model, scoring=make_scorer(business_gain), store_cv_results=True)
tuned.fit(X_train, y_train)
print(tuned.best_threshold_)
```

`make_scorer` turns the function into a scorer the search maximizes; `store_cv_results=True` keeps the score at every threshold tried.

When the cost differs per item (missing a $5,000 fraud against a $5 one), weight each error by its own amount rather than a flat price. Report the result in money: "$41,000 of fraud missed per month" reaches a client in a way F1 = 0.62 does not.

**Why BLEU and ROUGE fail on LLM output.** Both count overlapping n-grams (runs of n words) between the output and a human reference answer (G2.2 L1). That breaks on LLM answers in four ways:

- **Many right answers, one reference.** A correct answer in other words scores low.
- **Overlap is not correctness.** "The refund window is 30 days" and "The refund window is not 30 days" share almost every n-gram.
- **No reference exists** for open tasks: an email draft, a chat reply, an agent's plan.
- **Weak agreement with people.** Novikova et al. found word-overlap metrics only weakly reflect human judgments of individual outputs; they are more reliable for ranking whole systems.

What replaces them, in order of preference:

1. **Task-specific checks** — code that tests a property of the output: the JSON parses against its schema, extracted fields equal the gold values (the known correct ones), generated code passes unit tests, the answer contains the required figure, every cited document exists and was retrieved. They are cheap, fast, and never drift.
2. **LLM-as-judge** — a strong model grades the output against a rubric, for qualities code cannot test (helpfulness, tone, faithfulness to the context). Zheng et al. found GPT-4 as a judge agreed with human preferences over 80% of the time, the same level at which humans agree with each other, and documented three biases: **position** (favouring the first of two answers), **verbosity** (favouring longer answers), and **self-enhancement** (favouring its own outputs). Counter them by swapping the order and keeping only consistent verdicts, asking pass / fail questions about one criterion each, and judging with a different model family. Calibrating the judge against human labels is G5.6 L3.
3. **Human review** — for the slice where the judge and the checks disagree, and to label the calibration set.

**Significance testing between two models.** Prompt B scores 84% and prompt A 82% on the same 500 questions. A score measured on 500 items has a standard error of √(p(1 − p) / n) = √(0.83 × 0.17 / 500) ≈ 1.7 points, so each score alone is uncertain by about ±3.3 points (95% interval), wider than the gap.

A **paired** test uses the fact that both models answered the same questions, so difficulty cancels out:

- **McNemar's test** — keeps only the questions where the two disagree. If A is right and B wrong on b = 15 questions, and the reverse on c = 25, then under "no real difference" each disagreement is a coin flip. The exact binomial test on 15 of 40 (the chance of a split at least this lopsided from 40 fair coin flips) gives p ≈ 0.15: a 2-point gain this size arises by chance often. Dietterich recommends McNemar when each model can be trained and tested only once. The code takes it from statsmodels, a Python statistics library.
- **Paired bootstrap** — draw 500 questions with replacement from the 500, compute B's score minus A's on that draw, repeat 10,000 times, and take the 2.5th and 97.5th percentiles as a 95% interval for the difference. It works for any metric: F1, AUC, judge scores (Koehn).

```python
import numpy as np
from statsmodels.stats.contingency_tables import mcnemar

def paired_bootstrap_interval(correct_a, correct_b, draws=10_000, seed=0):
    rng = np.random.default_rng(seed)
    n = len(correct_a)
    samples = rng.integers(0, n, size=(draws, n))
    differences = correct_b[samples].mean(axis=1) - correct_a[samples].mean(axis=1)
    return np.percentile(differences, [2.5, 97.5])

only_a_right = int((correct_a & ~correct_b).sum())
only_b_right = int((~correct_a & correct_b).sum())
print(mcnemar([[0, only_a_right], [only_b_right, 0]], exact=True).pvalue)
print(paired_bootstrap_interval(correct_a, correct_b))
```

Three traps:

- **Clustered questions.** When questions come in groups (ten questions per document), they are not independent, and the interval comes out too narrow. Resample whole groups, or use clustered standard errors, which count each group as one unit of evidence (Miller).
- **Many comparisons.** Test 20 prompt variants at p < 0.05 and one "wins" by chance. Confirm the winner on fresh questions, or correct the threshold (Benjamini-Hochberg, a procedure that tightens it as the number of tests grows; G2.6 L3).
- **Significant is not important.** In an A/B test (live traffic split between the two versions) over a million requests, a 0.2-point gain can be significant and still worthless. Decide the smallest gain worth shipping first, then size the eval set to detect it.

**In an interview**

- *The fraud model has ROC-AUC 0.97, yet the operations team calls it useless. How?* ROC-AUC barely feels false positives when fraud is rare, because the false positive rate divides by the huge number of legitimate payments. At the threshold they use, precision may be 5%, so reviewers see 19 false alarms per fraud. I would report PR-AUC with the fraud rate beside it, and pick the threshold from the cost of a miss against the cost of a review.
- *Prompt v2 beats v1 by 2 points on 300 questions. Do you ship it?* Not on that number alone: with 300 questions each score is uncertain by about ±4 points. I would run a paired test, McNemar or a paired bootstrap, on the questions where the two disagree, and look at which failure categories changed. If the interval still includes zero, I either add questions or ship v2 only if it is better on other grounds, such as cost.

Sources: [Saito & Rehmsmeier, PR vs ROC on imbalanced data](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0118432) · [scikit-learn — `average_precision_score`](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.average_precision_score.html) · [Elkan, The Foundations of Cost-Sensitive Learning](https://cseweb.ucsd.edu/~elkan/rescale.pdf) · [scikit-learn — Tuning the decision threshold](https://scikit-learn.org/stable/modules/classification_threshold.html) · [scikit-learn — Cost-sensitive threshold example](https://scikit-learn.org/stable/auto_examples/model_selection/plot_cost_sensitive_learning.html) · [Novikova et al., Why We Need New Evaluation Metrics for NLG](https://arxiv.org/abs/1707.06875) · [Zheng et al., Judging LLM-as-a-Judge](https://arxiv.org/abs/2306.05685) · [Dietterich, Approximate Statistical Tests for Comparing Classifiers](https://doi.org/10.1162/089976698300017197) · [Koehn, Statistical Significance Tests for MT Evaluation](https://aclanthology.org/W04-3250/) · [Dror et al., Testing Statistical Significance in NLP](https://aclanthology.org/P18-1128/) · [Miller, Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640) · [statsmodels — `mcnemar`](https://www.statsmodels.org/stable/generated/statsmodels.stats.contingency_tables.mcnemar.html)
