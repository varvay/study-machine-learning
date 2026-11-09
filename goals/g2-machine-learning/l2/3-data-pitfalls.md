---
title: Data pitfalls
---

Recap (G2.3 L1): data is split into training, validation, and test sets; time-based and grouped data need matching splits; leakage lets information from outside the training data inflate a score; class imbalance makes accuracy meaningless. Here are the scikit-learn and imbalanced-learn tools for each.

**Splitters.** scikit-learn has a splitter for each kind of data, in a one-split form and a cross-validation form:

| Data | One split | Cross-validation |
|---|---|---|
| Classes of different sizes | `train_test_split(X, y, stratify=y)` | `StratifiedKFold` |
| Ordered in time | sort by time, cut at a date | `TimeSeriesSplit` |
| Several rows per customer, patient, or document | `GroupShuffleSplit` | `GroupKFold`, `StratifiedGroupKFold` |

A **stratified** split keeps each class's share equal in every part. A three-way split is two calls of `train_test_split`: first 60% train against 40% rest, then the rest in half (G2.2 shows it).

```python
import numpy as np
from sklearn.model_selection import GroupKFold, StratifiedKFold, TimeSeriesSplit, train_test_split

y = np.array([0] * 90 + [1] * 10)
X = np.arange(100).reshape(-1, 1)

_, _, _, y_test_random = train_test_split(X, y, test_size=0.2, random_state=3)
_, _, _, y_test_stratified = train_test_split(X, y, test_size=0.2, stratify=y, random_state=3)
print("positives in test, random split:", y_test_random.sum(), " stratified:", y_test_stratified.sum())

for train_index, test_index in StratifiedKFold(n_splits=5, shuffle=True, random_state=0).split(X, y):
    print("fold positives:", y[test_index].sum(), end="  ")
print()

days = np.arange(12).reshape(-1, 1)
for train_index, test_index in TimeSeriesSplit(n_splits=4, test_size=2, gap=1).split(days):
    print("train days", train_index.min(), "-", train_index.max(), "  test days", test_index.min(), "-", test_index.max())

patient_ids = np.repeat(np.arange(10), 3)
rows = np.zeros((30, 1))
for train_index, test_index in GroupKFold(n_splits=5).split(rows, groups=patient_ids):
    shared = set(patient_ids[train_index]) & set(patient_ids[test_index])
    print("test patients", sorted(set(patient_ids[test_index].tolist())), " shared with train:", shared or "none")
```

```text
positives in test, random split: 4  stratified: 2
fold positives: 2  fold positives: 2  fold positives: 2  fold positives: 2  fold positives: 2
train days 0 - 2   test days 4 - 5
train days 0 - 4   test days 6 - 7
train days 0 - 6   test days 8 - 9
train days 0 - 8   test days 10 - 11
test patients [4, 9]  shared with train: none
test patients [3, 8]  shared with train: none
test patients [2, 7]  shared with train: none
test patients [1, 6]  shared with train: none
test patients [0, 5]  shared with train: none
```

- **Stratified.** With 10% positives, the random split happened to put 4 positives in a test set of 20 (20%); the stratified split puts 2, the true share. On a rare class, a lucky or unlucky split moves the score a lot.
- **`TimeSeriesSplit`** expects rows sorted by time. Each fold trains on everything before the test block and tests on the block after it, so the model never sees the future. `test_size` sets the block length. `gap` leaves out rows between the two, for features that look back in time: a 7-day average computed on the first test day still includes the last training days. `max_train_size` caps the training window, so it slides instead of growing.
- **`GroupKFold`** takes a `groups` array with one group id per row, here the patient. Every patient's rows land on one side, so the model is scored on people it has never seen. `StratifiedGroupKFold` also keeps class shares as equal as the groups allow.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 236" role="img" aria-labelledby="data-pitfalls-time-split-title">
<title id="data-pitfalls-time-split-title">TimeSeriesSplit with 4 folds over 12 days: each fold trains on all earlier days, skips a one-day gap, and tests on the next two days</title>
<text class="note" x="20" y="24">day</text><text class="note" x="144" y="24" text-anchor="middle">0</text><text class="note" x="196" y="24" text-anchor="middle">1</text><text class="note" x="248" y="24" text-anchor="middle">2</text><text class="note" x="300" y="24" text-anchor="middle">3</text><text class="note" x="352" y="24" text-anchor="middle">4</text><text class="note" x="404" y="24" text-anchor="middle">5</text><text class="note" x="456" y="24" text-anchor="middle">6</text><text class="note" x="508" y="24" text-anchor="middle">7</text><text class="note" x="560" y="24" text-anchor="middle">8</text><text class="note" x="612" y="24" text-anchor="middle">9</text><text class="note" x="664" y="24" text-anchor="middle">10</text><text class="note" x="716" y="24" text-anchor="middle">11</text>
<rect class="fold-train" x="120" y="40" width="48" height="30" rx="6" /><rect class="fold-train" x="172" y="40" width="48" height="30" rx="6" /><rect class="fold-train" x="224" y="40" width="48" height="30" rx="6" /><rect class="table-outline" x="276" y="40" width="48" height="30" rx="6" /><text class="key-tag" x="300" y="59" text-anchor="middle">gap</text><rect class="fold-test" x="328" y="40" width="48" height="30" rx="6" /><rect class="fold-test" x="380" y="40" width="48" height="30" rx="6" /><text x="20" y="60">fold 1</text><text class="note" x="378" y="60" text-anchor="middle">test</text>
<rect class="fold-train" x="120" y="82" width="48" height="30" rx="6" /><rect class="fold-train" x="172" y="82" width="48" height="30" rx="6" /><rect class="fold-train" x="224" y="82" width="48" height="30" rx="6" /><rect class="fold-train" x="276" y="82" width="48" height="30" rx="6" /><rect class="fold-train" x="328" y="82" width="48" height="30" rx="6" /><rect class="table-outline" x="380" y="82" width="48" height="30" rx="6" /><text class="key-tag" x="404" y="101" text-anchor="middle">gap</text><rect class="fold-test" x="432" y="82" width="48" height="30" rx="6" /><rect class="fold-test" x="484" y="82" width="48" height="30" rx="6" /><text x="20" y="102">fold 2</text><text class="note" x="482" y="102" text-anchor="middle">test</text>
<rect class="fold-train" x="120" y="124" width="48" height="30" rx="6" /><rect class="fold-train" x="172" y="124" width="48" height="30" rx="6" /><rect class="fold-train" x="224" y="124" width="48" height="30" rx="6" /><rect class="fold-train" x="276" y="124" width="48" height="30" rx="6" /><rect class="fold-train" x="328" y="124" width="48" height="30" rx="6" /><rect class="fold-train" x="380" y="124" width="48" height="30" rx="6" /><rect class="fold-train" x="432" y="124" width="48" height="30" rx="6" /><rect class="table-outline" x="484" y="124" width="48" height="30" rx="6" /><text class="key-tag" x="508" y="143" text-anchor="middle">gap</text><rect class="fold-test" x="536" y="124" width="48" height="30" rx="6" /><rect class="fold-test" x="588" y="124" width="48" height="30" rx="6" /><text x="20" y="144">fold 3</text><text class="note" x="586" y="144" text-anchor="middle">test</text>
<rect class="fold-train" x="120" y="166" width="48" height="30" rx="6" /><rect class="fold-train" x="172" y="166" width="48" height="30" rx="6" /><rect class="fold-train" x="224" y="166" width="48" height="30" rx="6" /><rect class="fold-train" x="276" y="166" width="48" height="30" rx="6" /><rect class="fold-train" x="328" y="166" width="48" height="30" rx="6" /><rect class="fold-train" x="380" y="166" width="48" height="30" rx="6" /><rect class="fold-train" x="432" y="166" width="48" height="30" rx="6" /><rect class="fold-train" x="484" y="166" width="48" height="30" rx="6" /><rect class="fold-train" x="536" y="166" width="48" height="30" rx="6" /><rect class="table-outline" x="588" y="166" width="48" height="30" rx="6" /><text class="key-tag" x="612" y="185" text-anchor="middle">gap</text><rect class="fold-test" x="640" y="166" width="48" height="30" rx="6" /><rect class="fold-test" x="692" y="166" width="48" height="30" rx="6" /><text x="20" y="186">fold 4</text><text class="note" x="690" y="186" text-anchor="middle">test</text>
<text class="note" x="20" y="224">Plain: training days. Shaded: test days. Days after the test block are unused in that fold.</text>
</svg>
</div>
<figcaption><code>TimeSeriesSplit(n_splits=4, test_size=2, gap=1)</code> on 12 days. The training window grows fold by fold, and the model is always tested on days after everything it trained on.</figcaption>
</figure>

**Fit preprocessing on training data only, with `Pipeline`.** Preprocessing steps also learn from data: a scaler learns means and standard deviations, a feature selector learns which columns matter, an imputer learns fill-in values for missing entries. Fit on all rows before splitting, and they carry knowledge of the test rows into training: leakage. A **`Pipeline`** chains the steps and the model into one estimator. Its `fit` fits every step on the rows it is given, and its `predict` only applies them. Handed to `cross_val_score`, the whole pipeline is refit inside each training fold, so the held-out fold stays unseen.

The demonstration below is pure noise: 100 rows of 10,000 random features and random labels, so no model can beat a coin flip.

```python
import numpy as np
from sklearn.feature_selection import SelectKBest
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score
from sklearn.pipeline import make_pipeline

rng = np.random.default_rng(0)
X = rng.normal(size=(100, 10_000))
y = rng.integers(0, 2, size=100)

X_selected_on_all_rows = SelectKBest(k=20).fit_transform(X, y)
leaky = cross_val_score(LogisticRegression(), X_selected_on_all_rows, y, cv=5).mean()

pipeline = make_pipeline(SelectKBest(k=20), LogisticRegression())
honest = cross_val_score(pipeline, X, y, cv=5).mean()

print(f"selection before the split: accuracy {leaky:.2f}")
print(f"selection inside a Pipeline: accuracy {honest:.2f}")
```

```text
selection before the split: accuracy 0.87
selection inside a Pipeline: accuracy 0.48
```

`SelectKBest(k=20)` keeps the 20 features most correlated with the label. Run on all 100 rows, it picks the 20 that match the labels by chance, including the test rows' labels, and the model scores 0.87 on noise. Inside the pipeline, each fold picks its features from its own training rows and the score falls to chance. `make_pipeline` names the steps automatically; `Pipeline([("select", SelectKBest(k=20)), ("model", LogisticRegression())])` names them yourself. When columns need different treatment, such as scaling numbers and one-hot encoding categories (turning a category column into one 0/1 column per category), a `ColumnTransformer` goes inside the pipeline as one step.

**Class imbalance.** Three remedies change what training sees:

- **Class weights** — each training example's loss is multiplied by its class's weight, so mistakes on the rare class cost more. `class_weight="balanced"` sets each weight to n_samples / (n_classes × count of that class). Most scikit-learn classifiers accept it.
- **Oversampling** — adding minority examples. **SMOTE** (Synthetic Minority Over-sampling Technique) creates new ones: it takes a minority example xᵢ, picks one of its k nearest minority neighbours x_z (`k_neighbors=5` by default), and places a new point at x_new = xᵢ + λ(x_z − xᵢ), with λ random between 0 and 1: somewhere on the line between the two.
- **Undersampling** — dropping majority examples, for example at random with `RandomUnderSampler`.

Resampling comes from **imbalanced-learn** (`pip install imbalanced-learn`, imported as `imblearn`). Resample the training data only: synthetic or dropped rows in a validation or test set would misstate the score on real data. imbalanced-learn's own `Pipeline` does this for you, because it applies samplers during `fit` only and skips them in `predict`.

```python
from imblearn.over_sampling import SMOTE
from imblearn.pipeline import make_pipeline
from imblearn.under_sampling import RandomUnderSampler
from sklearn.datasets import make_classification
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import FixedThresholdClassifier, StratifiedKFold, cross_validate
from sklearn.preprocessing import StandardScaler

X, y = make_classification(n_samples=5_000, n_features=20, n_informative=5, weights=[0.97], flip_y=0.01, random_state=0)
print(f"positives: {y.sum()} of {len(y)}")

models = {
    "plain": make_pipeline(StandardScaler(), LogisticRegression()),
    "class_weight='balanced'": make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced")),
    "SMOTE": make_pipeline(StandardScaler(), SMOTE(random_state=0), LogisticRegression()),
    "RandomUnderSampler": make_pipeline(StandardScaler(), RandomUnderSampler(random_state=0), LogisticRegression()),
    "plain, threshold 0.1": FixedThresholdClassifier(make_pipeline(StandardScaler(), LogisticRegression()), threshold=0.1),
}

cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=0)
for name, model in models.items():
    scores = cross_validate(model, X, y, cv=cv, scoring=["precision", "recall", "f1"])
    print(f"{name:24} precision {scores['test_precision'].mean():.2f}   recall {scores['test_recall'].mean():.2f}   F1 {scores['test_f1'].mean():.2f}")
```

```text
positives: 176 of 5000
plain                    precision 0.88   recall 0.44   F1 0.58
class_weight='balanced'  precision 0.18   recall 0.78   F1 0.30
SMOTE                    precision 0.20   recall 0.78   F1 0.32
RandomUnderSampler       precision 0.15   recall 0.78   F1 0.25
plain, threshold 0.1     precision 0.42   recall 0.71   F1 0.52
```

`make_classification` generates a synthetic dataset; `weights=[0.97]` makes 97% of it class 0, `n_informative=5` makes 5 of the 20 features carry signal, and `flip_y=0.01` gives 1% of rows a random label as noise. The plain model finds under half the positives. All three remedies lift recall to 0.78 and pay with most of the precision. On this data, simply lowering the plain model's threshold to 0.1 (G2.2) buys most of that recall at a far smaller cost. So compare every remedy against a threshold change, on the precision-recall trade-off the task needs, before adopting it. `FixedThresholdClassifier` (scikit-learn 1.5+) wraps a model with a fixed threshold.

Sources: [scikit-learn — Cross-validation](https://scikit-learn.org/stable/modules/cross_validation.html) · [scikit-learn — TimeSeriesSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html) · [scikit-learn — StratifiedGroupKFold](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.StratifiedGroupKFold.html) · [scikit-learn — Common pitfalls](https://scikit-learn.org/stable/common_pitfalls.html) · [scikit-learn — Pipelines](https://scikit-learn.org/stable/modules/compose.html) · [scikit-learn — LogisticRegression, class_weight](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html) · [imbalanced-learn — Over-sampling](https://imbalanced-learn.org/stable/over_sampling.html) · [imbalanced-learn — Common pitfalls](https://imbalanced-learn.org/stable/common_pitfalls.html)
