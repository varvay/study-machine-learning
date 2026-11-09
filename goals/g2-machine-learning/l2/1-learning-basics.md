---
title: Learning basics
---

Recap (G2.1 L1): a supervised model learns from labelled examples; too simple a model underfits (high bias), too flexible a model overfits (high variance); regularization and cross-validation guard against overfitting. Here the same ideas run in scikit-learn.

**scikit-learn** is the standard Python library for classical machine learning: the models in the table below, outside neural networks (G2.4). Every model in it is an **estimator**: an object with `fit(X, y)`, which learns the parameters from data, and `predict(X)`, which returns answers. Classifiers also have `predict_proba(X)`, which returns a score per class (G2.2). `X` is a 2-D array with one row per example and one column per feature; `y` holds the labels. Because every model shares these methods, swapping one model for another changes one line.

**The common models:**

| Model | scikit-learn class | What it is | Main settings |
|---|---|---|---|
| Linear regression | `LinearRegression`, `Ridge`, `Lasso` | Predicts a number as a weighted sum of the features plus a constant: ŷ = w₁x₁ + … + wₙxₙ + b. | `alpha`, the penalty strength (below) |
| Logistic regression | `LogisticRegression` | A classifier despite its name: the weighted sum z is squeezed into a probability by the sigmoid, 1 / (1 + e⁻ᶻ). | `C`, the inverse of the penalty strength |
| Decision tree | `DecisionTreeClassifier`, `DecisionTreeRegressor` | A chain of yes/no questions on single features ("mean radius > 15?"), learned from the data, ending in a leaf that holds the answer. | `max_depth` (most questions in a row), `min_samples_leaf` (fewest training rows a leaf may hold) |
| Random forest | `RandomForestClassifier`, `RandomForestRegressor` | Many trees, each trained on a random resample of the rows and choosing each split from a random subset of features; the forest averages their answers. | `n_estimators` (trees), `max_features` (features tried per split) |
| Gradient boosting | `HistGradientBoostingClassifier`; XGBoost `XGBClassifier`; LightGBM `LGBMClassifier` | Small trees built one after another, each one fitted to the errors the trees before it still make. | `n_estimators`, `learning_rate` (how much each new tree's correction counts), `max_depth` or `num_leaves` (tree size) |

XGBoost and LightGBM are separate libraries (`pip install xgboost lightgbm`). Both ship classes that follow the scikit-learn estimator interface, so they drop into the same code. Why ensembles (models that combine many models, such as the forest and boosting) beat a single tree, and which model suits a client's data, is G2.1 L3.

**Compare models with k-fold cross-validation.** `cross_val_score(model, X, y, cv=...)` trains and scores the model once per fold and returns the k scores (the k-fold picture is in G2.1 L1). The dataset is the breast-cancer set that ships with scikit-learn: 569 tumours, 30 measurements each, labelled malignant or benign.

```python
from lightgbm import LGBMClassifier
from sklearn.datasets import load_breast_cancer
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier
from xgboost import XGBClassifier

X, y = load_breast_cancer(return_X_y=True)

models = {
    "logistic regression": make_pipeline(StandardScaler(), LogisticRegression(C=1.0)),
    "decision tree": DecisionTreeClassifier(max_depth=4, random_state=0),
    "random forest": RandomForestClassifier(n_estimators=300, random_state=0),
    "hist gradient boosting": HistGradientBoostingClassifier(random_state=0),
    "XGBoost": XGBClassifier(n_estimators=300, learning_rate=0.05, max_depth=3),
    "LightGBM": LGBMClassifier(n_estimators=300, learning_rate=0.05, num_leaves=15, verbose=-1),
}

cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=0)
for name, model in models.items():
    scores = cross_val_score(model, X, y, cv=cv, scoring="roc_auc")
    print(f"{name:24} ROC-AUC {scores.mean():.3f} ± {scores.std():.3f}")
```

```text
logistic regression      ROC-AUC 0.995 ± 0.006
decision tree            ROC-AUC 0.921 ± 0.025
random forest            ROC-AUC 0.992 ± 0.007
hist gradient boosting   ROC-AUC 0.994 ± 0.005
XGBoost                  ROC-AUC 0.994 ± 0.005
LightGBM                 ROC-AUC 0.993 ± 0.006
```

- **`make_pipeline(StandardScaler(), …)`** rescales every feature to mean 0 and standard deviation 1 before logistic regression. A penalty treats all weights alike, so features must share a scale; trees split on one feature at a time and need no scaling. Inside the pipeline, the scaler learns its means from the training folds only (G2.3).
- **`StratifiedKFold`** keeps the class ratio equal in every fold (G2.3). Passing `cv=5` to a classifier does the same, without shuffling.
- **`± std`** is the spread of the score across the 5 folds. A difference smaller than that spread is no evidence that one model is better: the five strong models tie here, and the single tree is clearly behind.
- **`random_state`** fixes the randomness, so a rerun gives the same numbers. `verbose=-1` silences LightGBM's log messages.

**L1 and L2 penalties.** Regularization adds a penalty on the weights to the training loss, and training minimizes the sum:

- **L2 (ridge):** loss + λ Σⱼ wⱼ²
- **L1 (lasso):** loss + λ Σⱼ |wⱼ|

Here wⱼ is the weight of feature j, the sum runs over all features, and λ ≥ 0 sets the strength: λ = 0 is no penalty, and a larger λ pushes the weights harder toward zero. The two differ in effect. L2 shrinks every weight but rarely to exactly zero. L1 sets some weights to exactly zero, which drops those features from the model. **Elastic net** mixes the two.

In scikit-learn:

- `Ridge(alpha=λ)` and `Lasso(alpha=λ)` for regression. `Lasso` divides the squared error by 2n, so its `alpha` is on a different scale from `Ridge`'s.
- `LogisticRegression(C=…)` takes the inverse, C = 1/λ: a smaller `C` means a stronger penalty. The default is L2 with `C=1.0`. For L1, set `l1_ratio=1` (the L1 share of the penalty) with `solver="liblinear"` or `"saga"`; the solver is the algorithm that fits the weights, and these two support L1. The `penalty="l1"` argument in older tutorials was deprecated in scikit-learn 1.8 and is removed in 1.10.
- Trees take no weight penalty; they are held back by `max_depth` and `min_samples_leaf`, and boosting also by a small `learning_rate`.
- The strength is itself chosen by cross-validation: `RidgeCV`, `LassoCV`, and `LogisticRegressionCV` try a range of values and keep the best.

```python
import numpy as np
from sklearn.datasets import load_diabetes
from sklearn.linear_model import Lasso, LinearRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

X, y = load_diabetes(return_X_y=True)

for name, regressor in [
    ("no penalty", LinearRegression()),
    ("L2, Ridge(alpha=10)", Ridge(alpha=10)),
    ("L1, Lasso(alpha=1)", Lasso(alpha=1)),
]:
    model = make_pipeline(StandardScaler(), regressor).fit(X, y)
    weights = model[-1].coef_
    print(f"{name:22} sum|w| = {np.abs(weights).sum():6.1f}   zero weights: {np.sum(weights == 0)} of {weights.size}")
```

```text
no penalty             sum|w| =  164.6   zero weights: 0 of 10
L2, Ridge(alpha=10)    sum|w| =  105.0   zero weights: 0 of 10
L1, Lasso(alpha=1)     sum|w| =   90.7   zero weights: 3 of 10
```

Both penalties shrink the weights; only L1 zeroes some, here 3 of the 10 features. `model[-1]` is the last step of the pipeline, the regressor, and `coef_` holds its learned weights.

**Learning curves.** A **learning curve** plots a model's training score and validation score against the number of training examples. It tells bias from variance, and so whether more data would help:

- **Both scores low and close together** — high bias. The model cannot use more data; a more flexible model or better features will help.
- **Training score high, validation score well below it** — high variance. The gap usually narrows as data grows, so more data helps, and so does regularization.

`learning_curve` refits the model on growing subsets and cross-validates each one:

```python
import numpy as np
from sklearn.datasets import load_breast_cancer
from sklearn.model_selection import StratifiedKFold, learning_curve
from sklearn.tree import DecisionTreeClassifier

X, y = load_breast_cancer(return_X_y=True)

for depth in [1, None]:
    sizes, train_scores, validation_scores = learning_curve(
        DecisionTreeClassifier(max_depth=depth, random_state=0),
        X, y,
        train_sizes=np.linspace(0.1, 1.0, 5),
        cv=StratifiedKFold(n_splits=5, shuffle=True, random_state=0),
        scoring="accuracy",
    )
    print(f"max_depth={depth}")
    for size, train, validation in zip(sizes, train_scores.mean(axis=1), validation_scores.mean(axis=1)):
        print(f"  {size:3d} rows   train {train:.3f}   validation {validation:.3f}")
```

```text
max_depth=1
   45 rows   train 0.951   validation 0.865
  147 rows   train 0.918   validation 0.893
  250 rows   train 0.925   validation 0.902
  352 rows   train 0.927   validation 0.905
  455 rows   train 0.927   validation 0.896
max_depth=None
   45 rows   train 1.000   validation 0.810
  147 rows   train 1.000   validation 0.895
  250 rows   train 1.000   validation 0.914
  352 rows   train 1.000   validation 0.921
  455 rows   train 1.000   validation 0.926
```

A tree of depth 1 asks a single question. Both of its scores settle near 0.90 and stop improving: high bias. The unlimited tree memorizes every training set (train 1.000) while its validation score is still climbing at the full dataset: high variance, and more data would still help. To draw the chart instead of printing it, `LearningCurveDisplay.from_estimator(model, X, y, cv=5)` plots both curves with matplotlib, Python's standard plotting library.

The same name is used for a plot of loss against training epochs (G2.4); that one tracks a single training run, and this one compares runs on different amounts of data.

Sources: [scikit-learn — Cross-validation](https://scikit-learn.org/stable/modules/cross_validation.html) · [scikit-learn — Linear models](https://scikit-learn.org/stable/modules/linear_model.html) · [scikit-learn — LogisticRegression (1.9)](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html) · [scikit-learn — Decision trees](https://scikit-learn.org/stable/modules/tree.html) · [scikit-learn — Ensembles](https://scikit-learn.org/stable/modules/ensemble.html) · [scikit-learn — Learning curves](https://scikit-learn.org/stable/modules/learning_curve.html) · [XGBoost — scikit-learn interface](https://xgboost.readthedocs.io/en/stable/python/sklearn_estimator.html) · [LightGBM — LGBMClassifier](https://lightgbm.readthedocs.io/en/stable/pythonapi/lightgbm.LGBMClassifier.html)
