---
title: Error analysis
---

Recap (G2.5 L1): collect failures, tag each with its cause, count the tags, fix the largest group first; slicing computes a metric per segment to show where to look. Here are the tools: slices in pandas (Python's library for data tables, called DataFrames), per-class confusion matrices, a failure taxonomy sheet for LLM output, and experiment tracking to compare runs.

**Slice metrics in pandas.** Build one table with a row per example: the segment columns, the truth, and the prediction. Then `groupby` the segment and aggregate. The predictions must come from a model that never trained on the row, or every slice looks perfect: `cross_val_predict` returns, for each row, the prediction of the fold model that held it out.

```python
import pandas as pd
from sklearn.datasets import load_breast_cancer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

data = load_breast_cancer(as_frame=True)
features = data.frame.drop(columns="target")
malignant = (data.target == 0).astype(int)

predicted = cross_val_predict(make_pipeline(StandardScaler(), LogisticRegression()), features, malignant, cv=5)

results = pd.DataFrame({
    "tumour_size": pd.qcut(features["mean radius"], q=3, labels=["small", "medium", "large"]),
    "malignant": malignant,
    "predicted": predicted,
})
results["correct"] = results["malignant"] == results["predicted"]
results["missed"] = (results["malignant"] == 1) & (results["predicted"] == 0)

by_slice = results.groupby("tumour_size", observed=True).agg(
    rows=("correct", "size"),
    accuracy=("correct", "mean"),
    malignant_cases=("malignant", "sum"),
    missed=("missed", "sum"),
)
by_slice["recall"] = 1 - by_slice["missed"] / by_slice["malignant_cases"]
print(by_slice.round(3))
print("overall accuracy", round(results["correct"].mean(), 3), "overall recall", round(1 - results["missed"].sum() / results["malignant"].sum(), 3))
```

```text
             rows  accuracy  malignant_cases  missed  recall
tumour_size                                                 
small         191     0.990                6       1   0.833
medium        188     0.968               39       5   0.872
large         190     0.984              167       2   0.988
overall accuracy 0.981 overall recall 0.962
```

- **`pd.qcut(…, q=3)`** cuts a number into three bins with equal row counts. A slice can be any column: country, device, document type, or a bin of a numeric feature.
- **`agg(name=(column, function))`** computes one named result per slice; `"size"` counts rows. `observed=True` lists only the bins that occur.
- **Reading it.** Overall recall is 0.962, but medium tumours are at 0.872 and hold 5 of the 8 misses. That is where to read failures next. The small slice has only 6 malignant cases, so one miss moves its recall by 0.17: always print the counts beside a slice metric, and distrust slices too small to measure.

**Per-class confusion matrices.** With K classes, `confusion_matrix` is a K × K table: row = true class, column = predicted class, and every off-diagonal cell counts one kind of confusion. `normalize="true"` divides each row by its total, so the diagonal becomes each class's recall. `multilabel_confusion_matrix` returns each class's own 2 × 2 one-vs-rest matrix (that class positive, all others negative), `[[TN, FP], [FN, TP]]`. The digits set that ships with scikit-learn has 1,797 images of handwritten digits, 8 × 8 pixels each.

```python
import numpy as np
from sklearn.datasets import load_digits
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, multilabel_confusion_matrix
from sklearn.model_selection import cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

X, y = load_digits(return_X_y=True)
predicted = cross_val_predict(make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)), X, y, cv=5)

matrix = confusion_matrix(y, predicted)
print(matrix)

recall_per_class = confusion_matrix(y, predicted, normalize="true").diagonal()
print("recall per digit:", np.round(recall_per_class, 2))

errors = matrix.copy()
np.fill_diagonal(errors, 0)
for flat_index in np.argsort(errors, axis=None)[::-1][:3]:
    true_digit, predicted_digit = np.unravel_index(flat_index, errors.shape)
    print(f"true {true_digit} predicted as {predicted_digit}: {errors[true_digit, predicted_digit]} times")

true_negatives, false_positives, false_negatives, true_positives = multilabel_confusion_matrix(y, predicted)[8].ravel()
print(f"digit 8 one-vs-rest: TP {true_positives}  FP {false_positives}  FN {false_negatives}  TN {true_negatives}")
```

```text
[[174   0   1   0   1   1   1   0   0   0]
 [  0 164   1   1   1   0   3   0   5   7]
 [  0   8 164   2   0   0   0   0   3   0]
 [  0   0   2 159   0   4   0   3  12   3]
 [  0   2   0   0 171   0   3   1   0   4]
 [  0   1   0   1   1 169   1   1   0   8]
 [  0   2   0   0   1   1 175   0   2   0]
 [  0   0   0   1   2   0   0 163   1  12]
 [  0  13   2   0   0   2   2   0 153   2]
 [  0   4   0   2   0   1   0   5   6 162]]
recall per digit: [0.98 0.9  0.93 0.87 0.94 0.93 0.97 0.91 0.88 0.9 ]
true 8 predicted as 1: 13 times
true 7 predicted as 9: 12 times
true 3 predicted as 8: 12 times
digit 8 one-vs-rest: TP 153  FP 29  FN 21  TN 1594
```

Three confusions stand out: 8 read as 1, 7 as 9, and 3 as 8. Looking at those images tells whether the fix is more training examples of those shapes, better features, or a stronger model such as a CNN (convolutional neural network, a network built for images; G3.4). `max_iter=1000` lets the solver run up to 1,000 iterations, against a default of 100. The zeroed diagonal leaves only mistakes, and `argsort` over the flattened table ranks them. `ConfusionMatrixDisplay.from_predictions(y, predicted)` draws the same table as a heat map.

**A failure taxonomy sheet for LLM outputs.** An LLM's answer has no single correct label to compare against, so its failures are categorized by reading them. A **failure taxonomy** is a short list of distinct, named failure categories, built from the failures themselves. A **trace** is the full record of one request: the input, the retrieved context, the prompt, the tool calls (requests the model makes to run outside functions, such as a search; G5), and the output. The routine, as practitioner Hamel Husain describes it:

1. **Sample** about 100 diverse traces.
2. **Open coding** — a domain expert reads each trace and writes a short free-text note on what went wrong.
3. **Axial coding** — group similar notes into categories. The categories are the taxonomy.
4. **Count** the failures per category. Keep reading new traces until they stop revealing new categories.

The sheet is one row per trace, in a spreadsheet or a DataFrame:

| Column | Holds |
|---|---|
| `trace_id` | a link back to the full trace |
| `input`, `output` | the question and the answer, or a summary |
| `passed` | the expert's pass or fail |
| `note` | the open-coding note, in the expert's words |
| `category` | the taxonomy category, from axial coding |
| `severity` | how much the failure hurts the user |
| `prompt_version` | which version of the system produced it, to compare versions |

Counting is then two lines of pandas. The rows below are made up for illustration:

```python
import pandas as pd

sheet = pd.DataFrame([
    {"trace_id": "t-001", "prompt_version": "v1", "passed": False, "category": "retrieval_miss", "severity": "high"},
    {"trace_id": "t-002", "prompt_version": "v1", "passed": True, "category": None, "severity": None},
    {"trace_id": "t-003", "prompt_version": "v1", "passed": False, "category": "ignored_context", "severity": "high"},
    {"trace_id": "t-004", "prompt_version": "v1", "passed": False, "category": "wrong_format", "severity": "low"},
    {"trace_id": "t-005", "prompt_version": "v2", "passed": False, "category": "retrieval_miss", "severity": "high"},
    {"trace_id": "t-006", "prompt_version": "v2", "passed": True, "category": None, "severity": None},
    {"trace_id": "t-007", "prompt_version": "v2", "passed": False, "category": "retrieval_miss", "severity": "medium"},
    {"trace_id": "t-008", "prompt_version": "v2", "passed": True, "category": None, "severity": None},
])

failures = sheet[~sheet["passed"]]
print(failures["category"].value_counts())
print(pd.crosstab(failures["category"], failures["prompt_version"]))
```

```text
category
retrieval_miss     3
ignored_context    1
wrong_format       1
Name: count, dtype: int64
prompt_version   v1  v2
category               
ignored_context   1   0
retrieval_miss    1   2
wrong_format      1   0
```

`value_counts` ranks the categories; `crosstab` counts them per prompt version, showing which failures a change removed (formatting and ignored context) and which it left (retrieval misses). In practice the sheet is read from a CSV export or a trace store, with `pd.read_csv`.

**Compare runs with experiment tracking.** **Experiment tracking** records each training or evaluation run's settings (**parameters**), results (**metrics**), and output files (**artifacts**, such as models, plots, and reports) in one store, so runs can be compared side by side and reproduced later. The two common tools:

- **MLflow** — open source; runs are stored locally or on a shared tracking server. On AWS, SageMaker AI (AWS's machine-learning platform; G6) hosts managed MLflow.
- **Weights & Biases (W&B)** — a hosted service with a web dashboard; it needs an account and an API key (`wandb login`).

```python
import mlflow
from sklearn.datasets import load_breast_cancer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

data = load_breast_cancer()
X, y = data.data, (data.target == 0).astype(int)
X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.25, stratify=y, random_state=0)

mlflow.set_experiment("breast-cancer")
for C in [0.01, 0.1, 1.0]:
    with mlflow.start_run(run_name=f"logreg-C{C}"):
        model = make_pipeline(StandardScaler(), LogisticRegression(C=C)).fit(X_train, y_train)
        predicted = model.predict(X_val)
        mlflow.log_params({"model": "logistic_regression", "C": C})
        mlflow.log_metrics({"val_recall": recall_score(y_val, predicted), "val_f1": f1_score(y_val, predicted)})

runs = mlflow.search_runs(experiment_names=["breast-cancer"], order_by=["metrics.val_f1 DESC"])
print(runs[["tags.mlflow.runName", "params.C", "metrics.val_recall", "metrics.val_f1"]])
```

```text
  tags.mlflow.runName params.C  metrics.val_recall  metrics.val_f1
0         logreg-C1.0      1.0            0.962264        0.980769
1         logreg-C0.1      0.1            0.962264        0.971429
2        logreg-C0.01     0.01            0.905660        0.950495
```

- **`set_experiment`** groups related runs under one name; **`start_run`** opens one run, and the `with` block closes it.
- **`log_params`** and **`log_metrics`** record settings and results; `log_artifact(path)` would attach a file, such as the slice table above saved as CSV.
- **`search_runs`** returns the runs as a pandas DataFrame, here sorted by F1. `mlflow server --port 5000` serves the same runs as a web page at `http://127.0.0.1:5000`, with charts.

The same loop in W&B:

```python
import wandb

for C in [0.01, 0.1, 1.0]:
    run = wandb.init(project="breast-cancer", name=f"logreg-C{C}", config={"model": "logistic_regression", "C": C})
    run.log({"val_recall": 0.96, "val_f1": 0.98})
    run.finish()
```

`config` holds the parameters, `run.log` the metrics (the numbers here are placeholders for the scores computed as above), and the project page on wandb.ai charts and compares the runs. `mode="offline"` in `wandb.init` records runs locally without an account.

Sources: [pandas — Group by](https://pandas.pydata.org/docs/user_guide/groupby.html) · [pandas — qcut](https://pandas.pydata.org/docs/reference/api/pandas.qcut.html) · [scikit-learn — Cross-validation, cross_val_predict](https://scikit-learn.org/stable/modules/cross_validation.html) · [scikit-learn — confusion_matrix](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.confusion_matrix.html) · [scikit-learn — multilabel_confusion_matrix](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.multilabel_confusion_matrix.html) · [Hamel Husain — LLM evals FAQ](https://hamel.dev/blog/posts/evals-faq/) · [MLflow — Tracking](https://mlflow.org/docs/latest/ml/tracking/) · [AWS — Managed MLflow on SageMaker AI](https://docs.aws.amazon.com/sagemaker/latest/dg/mlflow.html) · [W&B — Track experiments](https://docs.coreweave.com/products/wandb/track) · [W&B — wandb.init](https://docs.coreweave.com/products/wandb/ref/python/functions/init)
