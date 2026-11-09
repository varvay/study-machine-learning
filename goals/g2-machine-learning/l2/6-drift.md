---
title: Drift and monitoring
---

Recap (G2.6 L1): data drift changes the inputs, concept drift changes the relationship between inputs and answers, and monitoring watches inputs, predictions, and quality. Here are the statistics that measure a shift, Evidently to run them, the cloud services around them, and drift in LLM inputs.

Every drift statistic compares two samples of one feature. The **reference** is data the model is known to work on, usually its training data. The **current** sample is a recent window of production inputs, such as the last day.

**Population Stability Index (PSI)** — a score of how far a feature's distribution has moved, built from the shares of rows in bins:

PSI = Σᵢ (aᵢ − eᵢ) · ln(aᵢ / eᵢ)

- i — a bin; there are usually 10, cut at the reference's deciles, so each holds 10% of the reference;
- eᵢ — the expected share: the fraction of reference rows in bin i;
- aᵢ — the actual share: the fraction of current rows in bin i;
- an empty bin gets a tiny share in place of 0, because ln(0) is undefined.

In each term, (aᵢ − eᵢ) and ln(aᵢ / eᵢ) have the same sign, so every term is positive, and PSI is 0 only when all shares match. The common rule of thumb comes from credit scoring: below 0.1 little shift, 0.1 to 0.25 moderate, above 0.25 significant. Those cut-offs carry no error rates. Even with no drift at all, PSI averages about (B − 1)(1/M + 1/N) for B bins, M reference rows, and N current rows: with 10 bins and 285 rows on each side, about 0.063. On small samples, noise alone approaches the 0.1 line.

**Kolmogorov-Smirnov (KS) test** — a two-sample test of whether two sets of numbers come from the same distribution. Its statistic is the largest vertical gap between the two samples' cumulative distributions:

D = maxₓ |F_ref(x) − F_cur(x)|

where F(x) is the share of a sample's values at or below x. The **p-value** is the probability of a gap at least this large if both samples came from the same distribution; below 0.05 is the usual signal of drift. KS needs no bins, and works on numeric features only. On large samples it flags even tiny, harmless shifts: with over 100,000 rows, a 0.5% change already fires. At that scale, judge by D or by a distance instead of the p-value.

**Kullback-Leibler (KL) divergence** — a measure of how much one distribution differs from another, computed over the same bins:

D_KL(A ‖ E) = Σᵢ aᵢ ln(aᵢ / eᵢ)

It is asymmetric: D_KL(A ‖ E) and D_KL(E ‖ A) differ, and it is infinite when some eᵢ = 0 while aᵢ > 0. PSI is exactly the symmetric sum of the two directions: D_KL(A ‖ E) + D_KL(E ‖ A) = Σ aᵢ ln(aᵢ/eᵢ) + Σ eᵢ ln(eᵢ/aᵢ) = Σ (aᵢ − eᵢ) ln(aᵢ/eᵢ). **Jensen-Shannon distance** is another symmetric relative of KL, bounded between 0 and 1; Evidently, Azure, and Vertex AI (Google Cloud's machine-learning platform) use it.

The code splits the breast-cancer data in half, calls one half the reference and the other the current window, and shifts `mean radius` up by 10%, as a recalibrated scanner might.

```python
import numpy as np
from scipy.stats import entropy, ks_2samp
from sklearn.datasets import load_breast_cancer
from sklearn.model_selection import train_test_split

data = load_breast_cancer(as_frame=True)
reference, current = train_test_split(data.frame, test_size=0.5, random_state=0)
current = current.copy()
current["mean radius"] *= 1.10

def bin_shares(values, edges):
    counts = np.histogram(np.clip(values, edges[0], edges[-1]), bins=edges)[0]
    return np.clip(counts / counts.sum(), 1e-6, None)

def psi(reference_values, current_values, bins=10):
    edges = np.quantile(reference_values, np.linspace(0, 1, bins + 1))
    expected, actual = bin_shares(reference_values, edges), bin_shares(current_values, edges)
    return np.sum((actual - expected) * np.log(actual / expected))

def kl_divergence(reference_values, current_values, bins=10):
    edges = np.quantile(reference_values, np.linspace(0, 1, bins + 1))
    return entropy(bin_shares(current_values, edges), bin_shares(reference_values, edges))

for column in ["mean radius", "mean texture"]:
    ks = ks_2samp(reference[column], current[column])
    print(f"{column:13}  PSI {psi(reference[column], current[column]):.3f}   "
          f"KS D {ks.statistic:.3f} (p = {ks.pvalue:.3g})   KL {kl_divergence(reference[column], current[column]):.3f}")
```

```text
mean radius    PSI 0.160   KS D 0.163 (p = 0.000856)   KL 0.075
mean texture   PSI 0.079   KS D 0.063 (p = 0.59)   KL 0.038
```

- **`bin_shares`** clips current values into the reference's range, so values beyond it land in the end bins, and replaces empty shares with 10⁻⁶.
- **`scipy.stats.entropy(p, q)`** computes D_KL(p ‖ q); **`ks_2samp`** returns D and the p-value.
- **Reading it.** The shifted `mean radius` has PSI 0.16 (moderate) and p = 0.0009 (drift). The untouched `mean texture` has p = 0.59, and its PSI of 0.079 sits near the 0.063 that sampling noise alone produces.

**Evidently** is an open-source Python library (`pip install evidently`) for evaluating and monitoring ML and LLM systems. A **`Report`** runs a list of metrics or **presets**, ready-made metric bundles, on a current and a reference dataset. **`DataDriftPreset`** tests every column and picks the method by column type and size:

| Column | 1,000 rows or fewer | More than 1,000 rows |
|---|---|---|
| Numeric | KS test, drift if p < 0.05 | Wasserstein distance, drift if ≥ 0.1 |
| Categorical | chi-squared test (Z-test if binary) | Jensen-Shannon distance, drift if ≥ 0.1 |
| Text | domain classifier (below) | domain classifier |

The **Wasserstein distance** is how much of one distribution must move, and how far, to turn it into the other; the **chi-squared** and **Z-test** ask whether category shares differ between the two samples.

It declares the whole dataset drifted when at least half the columns drift (`drift_share=0.5`). `method="psi"` sets one method for all columns; `num_method`, `cat_method`, `per_column_method`, and `threshold` refine it.

```python
from evidently import DataDefinition, Dataset, Report
from evidently.presets import DataDriftPreset
from sklearn.datasets import load_breast_cancer
from sklearn.model_selection import train_test_split

features = load_breast_cancer(as_frame=True).frame.drop(columns="target")
reference, current = train_test_split(features, test_size=0.5, random_state=0)
current = current.copy()
current["mean radius"] *= 1.10

definition = DataDefinition(numerical_columns=list(features.columns))
reference_dataset = Dataset.from_pandas(reference, data_definition=definition)
current_dataset = Dataset.from_pandas(current, data_definition=definition)

for preset in [DataDriftPreset(), DataDriftPreset(method="psi", threshold=0.25)]:
    result = Report([preset]).run(current_dataset, reference_dataset)
    summary = result.dict()["metrics"][0]
    print(summary["metric_name"], summary["value"])

result.save_html("drift_report.html")
```

```text
DriftedColumnsCount(drift_share=0.5) {'count': 3.0, 'share': 0.1}
DriftedColumnsCount(drift_share=0.5,method=psi,threshold=0.25) {'count': 1.0, 'share': 0.03333333333333333}
```

- **`DataDefinition`** declares each column's type; **`Dataset.from_pandas`** wraps a DataFrame with it.
- **`report.run(current, reference)`** takes the current data first.
- **`result.dict()`** returns every metric; the first is the count and share of drifted columns, followed by one `ValueDrift` score per column. `save_html` writes the full visual report.
- **Reading it.** With 284 reference rows, the default runs a KS test on each of the 30 columns. It flags `mean radius` plus two untouched columns, `mean compactness` and `mean concavity`. At a 0.05 cut-off, 30 tests of unchanged columns produce about 1.5 false alarms on average. PSI with a 0.25 threshold flags `mean radius` alone. Evidently bins PSI over the range of both samples combined (in the evidently 0.7.23 source), so its PSI for `mean radius`, 0.40, differs from the decile version's 0.16. Compare PSI values only under the same binning.

**Cloud model monitoring on AWS.** **SageMaker Model Monitor** is AWS's managed service for this job. It has four monitor types: data quality, model quality, bias drift (a change in how predictions differ across groups, such as age groups), and feature attribution drift (a change in how much each feature drives the predictions). It works in four steps: **Data Capture** on the endpoint (the hosted model's web address that serves predictions) saves requests and predictions to S3 (AWS object storage, G1.4); a **baseline** job computes statistics and suggests constraints from the training data; a **monitoring schedule** runs a job that compares each captured window with the baseline and reports violations; the results reach CloudWatch (AWS's metrics and alarms service) for alarms. **Model Monitor is no longer open to new customers.** Existing customers keep it, and AWS adds no new features. AWS names as its replacement open-source monitoring solutions built on Evidently and MLflow on SageMaker AI, with CloudWatch, SNS (AWS's notification service), and QuickSight (AWS's dashboard service) dashboards. So on AWS the hands-on path is the Evidently code above, run on a schedule:

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 330" role="img" aria-labelledby="drift-aws-title">
<title id="drift-aws-title">Drift monitoring on AWS with Evidently: the endpoint captures traffic to S3, a scheduled job compares it with the training data, and results go to MLflow and to a CloudWatch alarm that notifies through SNS</title>
<path class="key-link" d="M220,45 L280,45" /><path class="key-link" d="M273,40 L280,45 L273,50" />
<path class="key-link" d="M380,70 L380,130" /><path class="key-link" d="M375,123 L380,130 L385,123" />
<path class="key-link" d="M640,70 L640,155 L480,155" /><path class="key-link" d="M487,150 L480,155 L487,160" />
<path class="key-link" d="M220,155 L280,155" /><path class="key-link" d="M273,150 L280,155 L273,160" />
<path class="key-link" d="M330,180 L330,210 L120,210 L120,240" /><path class="key-link" d="M115,233 L120,240 L125,233" />
<path class="key-link" d="M380,180 L380,240" /><path class="key-link" d="M375,233 L380,240 L385,233" />
<path class="key-link" d="M480,265 L540,265" /><path class="key-link" d="M533,260 L540,265 L533,270" />
<rect class="table-body" x="20" y="20" width="200" height="50" rx="8" /><rect class="table-outline" x="20" y="20" width="200" height="50" rx="8" /><text class="table-name" x="32" y="41">SageMaker endpoint</text><text class="key-tag" x="32" y="59">Data Capture on</text>
<rect class="table-body" x="280" y="20" width="200" height="50" rx="8" /><rect class="table-outline" x="280" y="20" width="200" height="50" rx="8" /><text class="table-name" x="292" y="41">S3: current</text><text class="key-tag" x="292" y="59">captured inputs + predictions</text>
<rect class="table-body" x="540" y="20" width="200" height="50" rx="8" /><rect class="table-outline" x="540" y="20" width="200" height="50" rx="8" /><text class="table-name" x="552" y="41">S3: reference</text><text class="key-tag" x="552" y="59">the training data</text>
<rect class="table-body" x="20" y="130" width="200" height="50" rx="8" /><rect class="table-outline" x="20" y="130" width="200" height="50" rx="8" /><text class="table-name" x="32" y="151">EventBridge</text><text class="key-tag" x="32" y="169">a schedule or a new capture file</text>
<rect class="table-body" x="280" y="130" width="200" height="50" rx="8" /><rect class="table-outline" x="280" y="130" width="200" height="50" rx="8" /><text class="table-name" x="292" y="151">Drift job (Lambda)</text><text class="key-tag" x="292" y="169">Evidently: current vs reference</text>
<rect class="table-body" x="20" y="240" width="200" height="50" rx="8" /><rect class="table-outline" x="20" y="240" width="200" height="50" rx="8" /><text class="table-name" x="32" y="261">MLflow on SageMaker AI</text><text class="key-tag" x="32" y="279">HTML report, drift scores</text>
<rect class="table-body" x="280" y="240" width="200" height="50" rx="8" /><rect class="table-outline" x="280" y="240" width="200" height="50" rx="8" /><text class="table-name" x="292" y="261">CloudWatch</text><text class="key-tag" x="292" y="279">metric + alarm</text>
<rect class="table-body" x="540" y="240" width="200" height="50" rx="8" /><rect class="table-outline" x="540" y="240" width="200" height="50" rx="8" /><text class="table-name" x="552" y="261">SNS</text><text class="key-tag" x="552" y="279">email, or start retraining</text>
<text class="note" x="20" y="318">Model Monitor ran the middle step as a managed service; it is closed to new customers.</text>
</svg>
</div>
<figcaption>One way to build drift monitoring from the pieces AWS names as Model Monitor's replacement: Evidently, MLflow on SageMaker AI, CloudWatch, and SNS. The job, a Lambda function (code AWS runs on demand) that EventBridge (AWS's scheduler and event router) starts, compares a window of captured traffic with the training data, logs the report, and publishes a drift score that a CloudWatch alarm watches.</figcaption>
</figure>

The job's last step hands the drift score to CloudWatch with boto3, the AWS SDK for Python, running under an AWS role (a set of permissions the job runs with) allowed to call CloudWatch. `put_metric_data` records a data point of a custom metric; `put_metric_alarm` fires an SNS notification when the metric crosses a threshold. Here the alarm fires when more than 30% of columns drift in a day:

```python
import boto3

cloudwatch = boto3.client("cloudwatch")
endpoint = [{"Name": "EndpointName", "Value": "breast-cancer-prod"}]
drifted_share = summary["value"]["share"]

cloudwatch.put_metric_data(
    Namespace="ModelMonitoring",
    MetricData=[{"MetricName": "DriftedColumnsShare", "Dimensions": endpoint, "Value": drifted_share, "Unit": "None"}],
)

cloudwatch.put_metric_alarm(
    AlarmName="breast-cancer-prod-drift",
    Namespace="ModelMonitoring",
    MetricName="DriftedColumnsShare",
    Dimensions=endpoint,
    Statistic="Maximum",
    Period=86_400,
    EvaluationPeriods=1,
    Threshold=0.3,
    ComparisonOperator="GreaterThanThreshold",
    AlarmActions=["arn:aws:sns:us-east-1:123456789012:ml-alerts"],
)
```

The alarm is created once, at deployment; the metric is published on every run. The SNS topic ARN (Amazon Resource Name, AWS's ID for a resource) is a placeholder for your own topic.

The other clouds:

| | AWS | Azure | GCP |
|---|---|---|---|
| Service | SageMaker Model Monitor (closed to new customers); Evidently + MLflow + CloudWatch | Azure Machine Learning model monitoring | Vertex AI Model Monitoring (v2) |
| What it watches | data quality, model quality, bias drift, feature attribution drift | data drift, prediction drift, data quality, feature attribution drift, model performance, generative-AI quality | input feature drift, output drift, feature attribution drift |
| Drift metrics | Evidently's (KS, Wasserstein, PSI, Jensen-Shannon, …) | Jensen-Shannon, PSI, normalized Wasserstein, KS, chi-squared | Jensen-Shannon (numeric), L-infinity, the largest gap in any category's share (categorical) |

Google's documentation now files Vertex AI Model Monitoring under the name Gemini Enterprise Agent Platform.

**Embedding drift for LLM inputs.** An LLM app's inputs are free text, where per-column tests have nothing to test. The usual approach is to embed each input with an embedding model (G1.7) and compare the reference and current sets of vectors. Evidently's comparison of methods:

- **Domain classifier** — train a classifier to tell reference vectors from current ones. Its cross-validated ROC-AUC (G2.2) is the drift score: 0.5 means the two sets cannot be told apart. Evidently's default flags drift above 0.55 on more than 1,000 rows, and its authors recommend this method as the default.
- **Distance between mean embeddings** — the Euclidean or cosine distance between the two average vectors. Cheap, but blind to any change that keeps the average.
- **Share of drifted components** — a per-column test on each embedding dimension, reporting the share of dimensions that drifted.
- **Maximum mean discrepancy (MMD)** — a kernel-based distance between the two distributions: a kernel is a similarity score for two vectors, and MMD compares the average similarity within each set with the average across the sets.

The code runs the first two. Any embedding matrix works, one row per input; here the 64 pixel values of scikit-learn's digit images stand in for embeddings so the code runs offline, and digits 0–6 play the known topics.

```python
import numpy as np
from sklearn.datasets import load_digits
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score

def domain_classifier_auc(reference, current):
    vectors = np.vstack([reference, current])
    is_current = np.r_[np.zeros(len(reference)), np.ones(len(current))]
    return cross_val_score(LogisticRegression(max_iter=2000), vectors, is_current, cv=5, scoring="roc_auc").mean()

def mean_cosine_distance(reference, current):
    a, b = reference.mean(axis=0), current.mean(axis=0)
    return 1 - a @ b / (np.linalg.norm(a) * np.linalg.norm(b))

vectors, digit = load_digits(return_X_y=True)
rng = np.random.default_rng(0)
known_topics = rng.permutation(np.flatnonzero(digit <= 6))
new_topics = np.flatnonzero(digit >= 7)

reference = vectors[known_topics[:600]]
same_mix = vectors[known_topics[600:1000]]
with_new_topics = np.vstack([vectors[known_topics[1000:1200]], vectors[new_topics[:200]]])

for name, current in [("same topics", same_mix), ("half new topics", with_new_topics)]:
    print(f"{name:16} domain-classifier ROC-AUC {domain_classifier_auc(reference, current):.2f}   "
          f"mean-vector cosine distance {mean_cosine_distance(reference, current):.3f}")
```

```text
same topics      domain-classifier ROC-AUC 0.50   mean-vector cosine distance 0.000
half new topics  domain-classifier ROC-AUC 0.68   mean-vector cosine distance 0.011
```

When half the inputs come from new topics, the classifier separates the sets clearly (0.68), while the mean vector barely moves (0.011). To see what changed, read the current inputs the classifier scores as most "current": they are the new topics. The evidently 0.7.23 package also ships an `EmbeddingsDrift` metric with these four methods, though its current documentation covers only text columns.

Sources: [Yurdakul, Statistical Properties of Population Stability Index](https://scholarworks.wmich.edu/dissertations/3208/) · [Yurdakul & Naranjo, Statistical properties of the population stability index](https://www.risk.net/journal-of-risk-model-validation/7725371/statistical-properties-of-the-population-stability-index) (the no-drift formula, as quoted in the [rpsi README](https://github.com/edpeyton/rpsi)) · [SciPy — ks_2samp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ks_2samp.html) · [SciPy — entropy](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.entropy.html) · [Evidently — Data drift preset](https://docs.evidentlyai.com/metrics/preset_data_drift) · [Evidently — Customize data drift](https://docs.evidentlyai.com/metrics/customize_data_drift) · [Evidently — How data drift detection works](https://docs.evidentlyai.com/metrics/explainer_drift) · [Evidently — Drift tests on large datasets](https://www.evidentlyai.com/blog/data-drift-detection-large-datasets) · [Evidently — Embedding drift methods](https://www.evidentlyai.com/blog/embedding-drift-detection) · [AWS — SageMaker Model Monitor](https://docs.aws.amazon.com/sagemaker/latest/dg/model-monitor.html) · [AWS — Model Monitor availability change](https://docs.aws.amazon.com/sagemaker/latest/dg/model-monitor-availability-change.html) · [boto3 — put_metric_data](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/cloudwatch/client/put_metric_data.html) · [boto3 — put_metric_alarm](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/cloudwatch/client/put_metric_alarm.html) · [Azure Machine Learning — Model monitoring](https://learn.microsoft.com/en-us/azure/machine-learning/concept-model-monitoring) · [Google Cloud — Vertex AI Model Monitoring](https://docs.cloud.google.com/vertex-ai/docs/model-monitoring/overview)
