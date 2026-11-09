---
title: Evaluation metrics
---

Recap (G2.2 L1): the confusion matrix counts TP, FP, FN, TN; precision = TP / (TP + FP), recall = TP / (TP + FN), F1 combines them, ROC-AUC scores the ranking, and the threshold trades precision against recall. Here: computing them in scikit-learn, choosing the threshold, and the formulas for RMSE and perplexity.

**Classification metrics in scikit-learn.** Every function in `sklearn.metrics` takes the true labels first. What comes second depends on the metric:

- **labels**, from `model.predict(X)`: `confusion_matrix`, `precision_score`, `recall_score`, `f1_score`, `classification_report`. `predict` applies a fixed threshold of 0.5 to the probability.
- **scores**, from `model.predict_proba(X)[:, 1]` (column 1 is the probability of class 1): `roc_auc_score`, `precision_recall_curve`. They measure the ranking or sweep the threshold themselves, so labels would throw that information away.

scikit-learn treats label 1 as the positive class. In the breast-cancer set, 0 means malignant, so the code flips the labels to make malignant, the class to find, the positive one. The data is split 60 / 20 / 20 into train, validation, and test (G2.3).

```python
import numpy as np
from sklearn.datasets import load_breast_cancer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (classification_report, confusion_matrix, f1_score,
                             precision_recall_curve, precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

data = load_breast_cancer()
X, y = data.data, (data.target == 0).astype(int)

X_train, X_rest, y_train, y_rest = train_test_split(X, y, test_size=0.4, stratify=y, random_state=0)
X_val, X_test, y_val, y_test = train_test_split(X_rest, y_rest, test_size=0.5, stratify=y_rest, random_state=0)

model = make_pipeline(StandardScaler(), LogisticRegression()).fit(X_train, y_train)

scores_val = model.predict_proba(X_val)[:, 1]
predicted_val = model.predict(X_val)

print(confusion_matrix(y_val, predicted_val))
print("precision", round(precision_score(y_val, predicted_val), 3))
print("recall   ", round(recall_score(y_val, predicted_val), 3))
print("F1       ", round(f1_score(y_val, predicted_val), 3))
print("ROC-AUC  ", round(roc_auc_score(y_val, scores_val), 3))
print(classification_report(y_val, predicted_val, target_names=["benign", "malignant"]))
```

```text
[[70  1]
 [ 4 39]]
precision 0.975
recall    0.907
F1        0.94
ROC-AUC   0.988
              precision    recall  f1-score   support

      benign       0.95      0.99      0.97        71
   malignant       0.97      0.91      0.94        43

    accuracy                           0.96       114
   macro avg       0.96      0.95      0.95       114
weighted avg       0.96      0.96      0.96       114
```

- **`confusion_matrix`** puts the true class in rows and the predicted class in columns, both in label order 0, 1: `[[TN, FP], [FN, TP]]`. This is transposed from the L1 table, which put predictions in rows. Here TN = 70, FP = 1, FN = 4, TP = 39: four malignant tumours were missed.
- **`classification_report`** gives precision, recall, and F1 for each class in turn, treating it as the positive one. **Support** is the number of true examples of that class. **Macro avg** is the plain mean over classes, so a small class counts as much as a large one; **weighted avg** weights each class by its support.

**Choose the threshold from the precision-recall curve.** `precision_recall_curve(y_true, scores)` sweeps the threshold over every distinct score and returns three arrays: `precision`, `recall`, and `thresholds`. `precision[i]` and `recall[i]` are the values at `thresholds[i]`. The first two arrays have one extra, final entry, precision 1 and recall 0, with no threshold; it anchors the curve on the axis, and the code drops it.

The rule has two steps:

1. **State the need as a constraint**, from what each mistake costs. In cancer screening a miss costs far more than an extra biopsy, so: recall at least 0.95.
2. **Among the thresholds that meet it, take the one with the highest precision.**

Pick the threshold on the validation set, then score the test set once with it. Tuning on the test set would make its score optimistic (G2.3).

```python
precision, recall, thresholds = precision_recall_curve(y_val, scores_val)
precision, recall = precision[:-1], recall[:-1]
candidates = np.flatnonzero(recall >= 0.95)
best = candidates[np.argmax(precision[candidates])]
threshold = thresholds[best]
print(f"threshold {threshold:.3f}: precision {precision[best]:.3f}, recall {recall[best]:.3f}")

scores_test = model.predict_proba(X_test)[:, 1]
predicted_test = (scores_test >= threshold).astype(int)
print(f"test: precision {precision_score(y_test, predicted_test):.3f}, recall {recall_score(y_test, predicted_test):.3f}")
```

```text
threshold 0.098: precision 0.837, recall 0.953
test: precision 0.808, recall 1.000
```

A threshold of 0.098 means "call it malignant at 10% probability". On validation it misses 2 of 43 malignant tumours instead of 4, and pays with 8 false alarms instead of 1 (41 of the 49 flagged are malignant). The walkthrough below builds a precision-recall curve one threshold at a time and applies the same rule.

With 43 positive cases, one case moves recall by 0.023, so a threshold picked on one small validation set is noisy. `TunedThresholdClassifierCV` (scikit-learn 1.5+) picks it by cross-validation instead: it wraps a classifier and keeps the threshold that maximizes a chosen metric across the folds. A constraint such as "recall at least 0.95" needs a custom scorer (a function you write that turns predictions into the number to maximize), shown in the scikit-learn threshold guide. `FixedThresholdClassifier` wraps a model with a threshold you chose, so its `predict` uses it.

```python
from sklearn.model_selection import TunedThresholdClassifierCV

X_train_full, X_test, y_train_full, y_test = train_test_split(X, y, test_size=0.2, stratify=y, random_state=0)
tuned = TunedThresholdClassifierCV(make_pipeline(StandardScaler(), LogisticRegression()), scoring="f1", cv=5)
tuned.fit(X_train_full, y_train_full)
print(f"best threshold {tuned.best_threshold_:.3f}, cross-validated F1 {tuned.best_score_:.3f}")
```

```text
best threshold 0.505, cross-validated F1 0.982
```

Maximizing F1 lands near 0.5 here; a recall constraint would push the threshold far lower, as above.

**RMSE**, the root mean squared error:

RMSE = √( (1/n) Σᵢ (yᵢ − ŷᵢ)² )

- n — the number of examples;
- yᵢ — the true value of example i;
- ŷᵢ — the model's prediction for it.

Read it next to a baseline. A model that always predicts the training mean scores an RMSE close to the target's standard deviation; a useful model must beat that. The diabetes set that ships with scikit-learn has 442 patients, and its target is a measure of disease progression one year later.

```python
import numpy as np
from sklearn.datasets import load_diabetes
from sklearn.linear_model import LinearRegression
from sklearn.metrics import root_mean_squared_error
from sklearn.model_selection import train_test_split

X, y = load_diabetes(return_X_y=True)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=0)
predicted = LinearRegression().fit(X_train, y_train).predict(X_test)

print(f"RMSE {root_mean_squared_error(y_test, predicted):.1f}")
print(f"by hand {np.sqrt(np.mean((y_test - predicted) ** 2)):.1f}")
print(f"baseline, always the training mean: {root_mean_squared_error(y_test, np.full_like(y_test, y_train.mean())):.1f}")
print(f"target range {y.min():.0f}-{y.max():.0f}, std {y.std():.1f}")
```

```text
RMSE 58.5
by hand 58.5
baseline, always the training mean: 71.7
target range 25-346, std 77.0
```

The model is typically about 58 points off on a scale of 25 to 346, better than the baseline's 72 but far from exact. `root_mean_squared_error` arrived in scikit-learn 1.4; older code writes `mean_squared_error(..., squared=False)`, and that argument no longer exists.

**Perplexity** scores a language model on real text:

Perplexity = exp( −(1/N) Σᵢ log p(tᵢ | t₁ … tᵢ₋₁) )

- N — the number of tokens in the text;
- tᵢ — the i-th actual token;
- p(tᵢ | t₁ … tᵢ₋₁) — the probability the model gave that token, given the tokens before it;
- log — the natural logarithm.

The part inside exp( ) is the **mean negative log-likelihood**, and it is exactly the cross-entropy loss a language model trains on (G2.4). So perplexity = exp(cross-entropy loss). Worked example: a model gives the four actual tokens of a text probabilities 0.5, 0.25, 0.1, and 0.8. Their negative logs are 0.693, 1.386, 2.303, and 0.223; the mean is 1.151; exp(1.151) = 3.16. A model that spreads its probability evenly over a vocabulary of V tokens (the vocabulary is the set of all tokens it can output) has perplexity exactly V, which is the sense of "as unsure as choosing among V tokens".

The code below runs in PyTorch (`torch`), the neural-network library of G2.4. Its **logits** are a model's raw scores, one per token of the vocabulary, before they become probabilities (G2.4); all zeros make every token equally likely.

```python
import torch
import torch.nn.functional as F

probabilities_of_actual_tokens = torch.tensor([0.5, 0.25, 0.1, 0.8])
mean_negative_log_likelihood = -probabilities_of_actual_tokens.log().mean()
print(f"mean NLL {mean_negative_log_likelihood:.3f}, perplexity {mean_negative_log_likelihood.exp():.2f}")

logits = torch.zeros(4, 50_000)
next_token_ids = torch.tensor([17, 4_021, 9, 33_000])
loss = F.cross_entropy(logits, next_token_ids)
print(f"uniform model: cross-entropy {loss:.2f}, perplexity {loss.exp():.0f}")
```

```text
mean NLL 1.151, perplexity 3.16
uniform model: cross-entropy 10.82, perplexity 50000
```

With a Hugging Face causal language model (Hugging Face's `transformers` library loads open models; a causal model predicts each token from the ones before it), passing `labels=input_ids` (the text as token ids) returns the mean negative log-likelihood as `outputs.loss`, so `torch.exp(outputs.loss)` is the perplexity. Texts longer than the model's context (the most tokens it reads at once; G3.2) are scored with a sliding window of overlapping chunks. Perplexity depends on the tokenizer (the component that splits text into tokens; G3.1), so compare it only between models that share one.

Sources: [scikit-learn — Metrics and scoring](https://scikit-learn.org/stable/modules/model_evaluation.html) · [scikit-learn — precision_recall_curve](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.precision_recall_curve.html) · [scikit-learn — Tuning the decision threshold](https://scikit-learn.org/stable/modules/classification_threshold.html) · [scikit-learn — root_mean_squared_error](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.root_mean_squared_error.html) · [Hugging Face — Perplexity of fixed-length models](https://huggingface.co/docs/transformers/perplexity)
