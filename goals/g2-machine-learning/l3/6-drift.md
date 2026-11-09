---
title: Drift and monitoring
---

At L3 the hard part of drift is deciding. In production some statistic drifts every day; the skill is telling which changes hurt the model, who must act, and whether retraining is the right action. Huyen notes that much of what looks like data shift on a monitoring dashboard is an internal error, such as a pipeline bug or a changed feature extraction, so the first question of every drift alert is "did we break something upstream?"

**Alert thresholds without alert fatigue.** **Alert fatigue** is the state where alerts fire so often, and so rarely matter, that people stop reading them, and then miss the real one. Google's Site Reliability Engineering (SRE) book gives the rule, and it applies to models unchanged: every **page**, an alert that calls someone in at once, should be actionable, and one that merits only a robotic response should not be a page. Naive drift alerts break it in four ways:

- **Significance is not size.** A statistical test's p-value measures how sure you can be that two distributions differ, not how much they differ. With a million rows, a KS test (G2.6 L2) flags a shift too small to change any prediction. Alert instead on an **effect size**, a number for how far apart the distributions are, such as PSI or Wasserstein distance, with a threshold. Evidently's defaults follow this: for numeric columns, a KS test at p ≤ 0.05 when the reference data has up to 1,000 rows, and above that a normalized Wasserstein distance ≥ 0.1.
- **Many tests, many false alarms.** Check 200 features daily at p < 0.05, and about 10 flag by chance every day with nothing wrong. Correct for it with a false-discovery-rate procedure, which caps the expected share of false alarms among the flagged features (Benjamini-Hochberg: `multipletests(pvals, method="fdr_bh")` in statsmodels), or alert on an aggregate such as the share of drifted features.
- **Unimportant features.** A shift in a feature the model barely uses changes nothing. Weight drift by feature importance, or monitor only the top features; Azure ML recommends watching the top N features to cut cost and noise.
- **Seasons and cycles.** Weekend traffic differs from weekday traffic every week. Compare against the same period last week or last year, or against a recent window of production data, rather than always against the training set.

Then give alerts tiers, each with an owner and a first runbook step (a runbook is the written procedure for answering an alert):

| Tier | Fires on | Example |
|---|---|---|
| Page (act now) | data broken, or quality clearly down and staying down | a feature 100% null; the model predicting one class for everything; a quality proxy below its floor for an hour |
| Ticket (next working day) | a persistent shift in something that matters | an important feature drifting for 3 days running; the predicted-fraud rate up 40% on the week |
| Dashboard only | everything else | drift in minor features, one-day blips |

Set each threshold from history, not from a library default: replay the metric over past months, see its normal range, and pick the level that would have fired on known incidents and rarely otherwise. Require the breach to persist; Google's SRE workbook pages only when a long window *and* a short window (one twelfth as long) both breach, so an alert fires on a sustained problem and clears soon after it ends. An alert rule is a classifier, so track its precision each month, the share of alerts that led to an action, and raise the thresholds of rules that never lead to one.

**Proxy metrics when labels arrive late.** In many systems the true answer arrives weeks or months after the prediction: a chargeback (the card issuer reversing a disputed payment) confirms fraud, a missed payment confirms a bad loan, a missed renewal confirms churn. Until then, quality is watched through faster signals, each less direct than the next slower one:

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 400" role="img" aria-labelledby="drift-signals-title">
<title id="drift-signals-title">Seven monitoring signals ordered from fastest and least direct to slowest and most direct, with the delay of each and what it catches</title>
<text class="note" x="20" y="20">delay</text><text class="note" x="150" y="20">signal</text><text class="note" x="500" y="20">catches</text>
<rect class="fold-train" x="150" y="32" width="330" height="40" rx="6" /><text x="20" y="57">seconds</text><text class="table-name" x="162" y="57">data quality: nulls, schema, ranges</text><text x="500" y="57">broken pipelines</text>
<rect class="fold-train" x="150" y="82" width="330" height="40" rx="6" /><text x="20" y="107">minutes</text><text class="table-name" x="162" y="107">input drift against a reference</text><text x="500" y="107">data drift</text>
<rect class="fold-train" x="150" y="132" width="330" height="40" rx="6" /><text x="20" y="157">minutes</text><text class="table-name" x="162" y="157">prediction drift: score distribution</text><text x="500" y="157">upstream changes, data drift</text>
<rect class="fold-train" x="150" y="182" width="330" height="40" rx="6" /><text x="20" y="207">hours</text><text class="table-name" x="162" y="207">estimated performance (CBPE)</text><text x="500" y="207">accuracy lost to data drift</text>
<rect class="fold-train" x="150" y="232" width="330" height="40" rx="6" /><text x="20" y="257">hours to days</text><text class="table-name" x="162" y="257">user behavior: overrides, thumbs down</text><text x="500" y="257">visible quality drops</text>
<rect class="fold-test" x="150" y="282" width="330" height="40" rx="6" /><text x="20" y="307">days</text><text class="table-name" x="162" y="307">a small random sample, labeled weekly</text><text x="500" y="307">concept drift, early</text>
<rect class="fold-test" x="150" y="332" width="330" height="40" rx="6" /><text x="20" y="357">weeks to months</text><text class="table-name" x="162" y="357">full ground truth</text><text x="500" y="357">everything, late</text>
<text class="note" x="150" y="392">the shaded rows need labels, and only they see concept drift directly</text>
</svg>
</div>
<figcaption>Monitoring signals, from fast and indirect at the top to slow and direct at the bottom. The unshaded rows see only inputs and outputs, so they can miss concept drift, where the inputs look the same but the right answers changed.</figcaption>
</figure>

- **Estimated performance** — **confidence-based performance estimation (CBPE)**, in NannyML (an open-source Python library for monitoring models without labels), estimates the confusion matrix without labels from the model's own probabilities: a prediction scored 0.9 is right 90% of the time if the scores are calibrated. It handles data drift but fails under concept drift, because when P(y | x), the chance of each answer given the inputs, changes, the model's confidence is as wrong as its predictions. NannyML's **direct loss estimation** does the same for regression by training a second model to predict the first one's error.
- **User behavior** — for classic models: overrides by the people who act on predictions, manual corrections, appeals. For LLM apps: thumbs down, regenerated answers, escalations to a human, "I don't know" rates, and an LLM judge scoring a sample of live traffic (G5.6 L3).
- **Sampled labels** — have people label a small random sample every week. 200 labels measure an 80% accuracy to within about ±5.5 points (95% interval), enough to see a large drop weeks before full ground truth arrives.

A proxy is worth watching only if it moves with the true metric. When labels do arrive, check on history that the proxy fell when quality fell, and drop proxies that did not.

Watch for **selective labels**: often labels exist only for cases the model let through. A blocked payment never gets a chargeback, and a refused loan never defaults, so the labeled data describes only what the model approved. Lakkaraju et al. describe how selective labels bias the evaluation of decisions made by people; a model's own decisions open the same gap. Sculley et al. list such **feedback loops** as hidden technical debt: a model trained on its own filtered outcomes learns less and less about what it filters. The fix is a small, deliberate random holdout: let a tiny share of cases through without the model's decision, or review a random sample of rejections, so their true outcomes can be observed.

**Retraining on triggers vs on a schedule.** Google's MLOps guide lists the ways to start the training pipeline: on demand, on a schedule, when new labeled data arrives, when performance degrades, and when the data distribution changes significantly.

| | On a schedule | On a trigger |
|---|---|---|
| Reacts to | slow, steady drift | sudden shifts |
| Strength | predictable cost and operations; simple to run and audit | retrains only when needed, and fast |
| Weakness | retrains when nothing changed; too slow for a sudden shift | inherits the noise of its alert; can fire on a pipeline bug |
| Needs | new labeled data arriving regularly | a trustworthy trigger signal |

The weakness of triggers is serious: if the "drift" is a broken feature, retraining teaches the model the bug. So retrain automatically only on triggers that passed data-quality checks, and treat drift-only triggers as a request for a person to look.

The common design is hybrid: retrain on a schedule, allow a trigger to retrain early, and send every new model through the same gate. The gate compares it with the current production model (the **champion**) on a recent holdout and on the regression set (G2.5 L3), and only a better model is promoted, through a shadow release (it answers live traffic, but its answers are only logged) or a canary release (it serves a small share of traffic first) (G6.5 L3).

Pick the schedule from data; Huyen observes that many companies still set it by gut feeling. Train a model on data up to a date, score it on each following week, and plot the decline; retrain before the decline crosses what the business tolerates. Choose the training window with the same experiment: concept drift favors recent data, while stable concepts favor more history.

Retraining is not always the fix. Concept drift from a product change needs new labels or new features. A new category of input needs data collection first. A pipeline bug needs the pipeline fixed.

On AWS, the chosen cloud, one detail changed recently: **SageMaker Model Monitor is closed to new customers**, and AWS now recommends its open-source SageMaker AI monitoring solutions (Evidently AI plus SageMaker AI MLflow Apps), CloudWatch alarms, and QuickSight dashboards. Those solutions run the drift analysis on an EventBridge schedule and alert through SNS. An EventBridge rule, on a schedule or on an event such as a drift alert or new data in S3, starts a SageMaker Pipelines run (AWS's service for multi-step ML workflows; `StartPipelineExecution`) that retrains, evaluates against the champion, and registers the model.

| | AWS | Azure | GCP |
|---|---|---|---|
| Drift and quality monitoring | open-source SageMaker AI monitoring solutions + CloudWatch (Model Monitor for existing customers) | Azure ML model monitoring: data drift, prediction drift, data quality, feature attribution drift, model performance | Vertex AI Model Monitoring |
| Event that starts retraining | EventBridge rule or schedule → SageMaker Pipelines | Azure Event Grid (Azure's event-routing service) event from the monitor → retraining job | Vertex AI Pipelines on a schedule or event (unsourced) |

**Stale documents in a RAG corpus.** In a RAG system (G1.7) the model stays fixed while the knowledge changes, so drift takes the form of a stale corpus. A **stale document** is one whose indexed version no longer matches the truth. It shows up in five ways:

- a source was updated but the index was not re-synced;
- old and new versions are both indexed, and retrieval returns the old one;
- a deleted source is still retrievable, which is also a compliance problem (G1.8 L3);
- new topics arrive with no documents, so questions fail as missing content (G2.5 L3);
- the embedding model changed, and old and new vectors no longer compare (G1.7 L3).

Prevention:

- **Sync incrementally** — detect changed sources by content hash or modified time, re-ingest those, and delete the chunks of removed sources. Bedrock Knowledge Bases, AWS's managed RAG service, do this on each sync: a `StartIngestionJob` re-processes only documents added, modified, or deleted since the last sync. A sync runs only when started, so schedule it or start it from source-change events.
- **Store version metadata on every chunk** — `source_id`, `version`, `effective_from`, `review_by`, `ingested_at` — and filter retrieval to current versions.
- **Show dates** — cite each source with its "as of" date, so users can spot stale answers.

Detection:

- **Freshness lag** — the time between a source's change and its re-index, with a target such as under 24 hours, measured from `modified_at` against `ingested_at`.
- **Stale retrievals** — the share of retrieved chunks past their `review_by` date, and of answers citing a superseded version.
- **Coverage gaps** — the rate of queries whose best retrieval score is low, clustered by embedding to name the missing topics.
- **Canary questions** — a regression set of questions whose answers changed recently, run daily, asserting the new answer (G2.5 L3).

**In an interview**

- *You monitor 300 features and the team ignores the drift alerts. What do you change?* I would stop paging on p-values: with large samples they flag harmless shifts, and 300 tests produce false alarms every day. I would page only on broken data or a sustained drop in quality or a validated proxy, send drift in important features to a ticket queue, and put the rest on a dashboard. Thresholds would come from replaying past incidents, and I would track each rule's precision and retire the ones that never lead to action.
- *Fraud labels arrive 60 days late. How do you know the model still works today?* I layer signals by delay: data quality and input drift within minutes, the predicted-fraud rate and score distribution within hours, and estimated performance from calibrated scores, which covers data drift but not concept drift. For concept drift I have analysts label a small random sample weekly, including some blocked payments, since blocked ones never produce chargebacks. Full chargeback data then confirms or corrects the proxies.

Sources: [Huyen, Data Distribution Shifts and Monitoring](https://huyenchip.com/2022/02/07/data-distribution-shifts-and-monitoring.html) · [Google SRE book — Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) · [Google SRE workbook — Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) · [Evidently — Data drift](https://docs.evidentlyai.com/metrics/explainer_drift) · [statsmodels — `multipletests`](https://www.statsmodels.org/stable/generated/statsmodels.stats.multitest.multipletests.html) · [Azure ML — Model monitoring](https://learn.microsoft.com/en-us/azure/machine-learning/concept-model-monitoring) · [NannyML — Performance estimation](https://nannyml.readthedocs.io/en/stable/how_it_works/performance_estimation.html) · [Lakkaraju et al., The Selective Labels Problem](https://dl.acm.org/doi/10.1145/3097983.3098066) · [Sculley et al., Hidden Technical Debt in ML Systems](https://papers.nips.cc/paper/5656-hidden-technical-debt-in-machine-learning-systems) · [Google Cloud — MLOps: continuous delivery and automation pipelines](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning) · [AWS — SageMaker Model Monitor availability change](https://docs.aws.amazon.com/sagemaker/latest/dg/model-monitor-availability-change.html) · [AWS — Schedule SageMaker Pipelines with EventBridge](https://docs.aws.amazon.com/sagemaker/latest/dg/pipeline-eventbridge.html) · [Vertex AI — Model Monitoring overview](https://docs.cloud.google.com/vertex-ai/docs/model-monitoring/overview) · [AWS — Sync a Bedrock knowledge base](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-data-source-sync-ingest.html)
