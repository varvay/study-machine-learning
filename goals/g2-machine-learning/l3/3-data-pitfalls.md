---
title: Data pitfalls
---

Leakage (G2.3 L1) rarely arrives as an obvious `refund_issued` column. Kapoor and Narayanan found it in at least 294 published papers across 17 fields, and sorted it into eight types. Three kinds cause most of the trouble in practice.

**Target leakage** — a feature that is a consequence or a proxy of the label, so it exists only because the outcome already happened. It hides in columns that look like ordinary inputs:

- a churn model (predicting which customers will cancel) using `support_calls_last_30d`, where the cancellation process itself logs a support call;
- a pneumonia model using "received antibiotic X", which doctors give after they diagnose pneumonia;
- a loan model using `collections_flag`, set once a payment is missed.

The test for each feature is one question: **at the moment the model will predict, is this value already written?** Kaufman et al. formalize leakage exactly this way, as information not legitimately available at prediction time. Symptoms: one feature dominates the importance ranking (how much each feature drives the model's predictions), or that feature alone scores an AUC near 1.

**Duplicates across splits** — the same or nearly the same example in both training and test data: a product listing reposted, an image resized, a templated email, one patient's repeated scans. The model recalls the copy, and the test score measures memory. Lee et al. found train-test overlap in over 4% of the validation sets of standard language datasets. Exact copies are found by hashing a normalized form (computing a short fingerprint that equal inputs share); near-copies of text by **MinHash** with locality-sensitive hashing (the `datasketch` library), which estimates the word overlap of every pair without comparing all pairs; near-copies of images or text by embedding similarity (G1.7). Put each cluster of duplicates into a single split, as a group split does for customers (G2.3 L2).

**Future information in features** — a feature computed with data from after the prediction moment:

- an aggregate over the whole table, such as a customer's lifetime spend, used to predict a purchase in the middle of that lifetime;
- a snapshot joined to past events, such as today's `account_status` joined to a transaction from last year;
- target encoding (replacing a category with its average label) computed over all rows, so each row's own label leaks into its feature. Compute it out-of-fold: each row's encoding from the other folds only.

The fix is a **point-in-time join**: for each training example, take each feature's value as it was at that example's timestamp. Feature stores (databases that serve the same feature values to training and to serving; G1.8) do this; Feast, an open-source feature store, has `get_historical_features`, which joins each row to the latest feature value at or before its event time, and `filter_by_created_timestamp=True` also excludes values that were backfilled later (written afterwards for past times).

Two cheap checks catch much of the rest. Compare a random split with a time-based split: if the random split scores far higher, the model is using the future or the data is drifting (G2.6). And ask of any surprisingly good score which feature it depends on, then trace when that column is written.

**Shift between training and production data** — the data a model is trained on differs from the data it meets in production. Google's *Rules of ML* call the result **training-serving skew**, a gap between performance in training and in serving, and name three causes:

- **The pipelines differ.** Training features come from a Spark batch job (Apache Spark processes large datasets in bulk), serving features from Java code in the request path, and they disagree on details: time zones, how missing values are filled, text normalization. Nothing errors; predictions just degrade.
- **The data changes** between training and serving: drift (G2.6).
- **A feedback loop:** the model's own decisions change the data it later learns from (G2.6 L3).

The rules give the fixes: save the features used at serving time and train on those logs (Rule #29); reuse the same feature code in training and serving (Rule #32), which a feature store enforces; and measure performance on training data, holdout data, next-day data, and live data, since each gap points at a different cause (Rule #37).

To test whether production data looks like training data before deploying, use **adversarial validation**: label training rows 0 and recent production rows 1, and train a classifier to tell them apart. An AUC near 0.5 means the two are indistinguishable. A high AUC means they differ, and the classifier's most important features name the columns that shifted.

**Benchmark contamination** — public test items that appear in an LLM's pretraining data, which is scraped from the web where benchmarks are published. The model then recalls answers instead of solving the task, and its score overstates its skill. Sainz et al. argue it must be measured for each benchmark and model, because it silently overstates results. Zhang et al. wrote GSM1k, new problems matching the style and difficulty of the GSM8k math benchmark, and saw accuracy drop by up to 8% for some models, with several model families overfit across almost all sizes; the strongest frontier models (the most capable models of the day) showed little sign of it.

Detecting it is hard because most training corpora are private:

- **n-gram overlap** between benchmark items and the training corpus, when the corpus is available;
- **guided instruction** (Golchin and Surdeanu): give the model the dataset name, the split, and the first part of a test item, and ask it to continue; a near-exact continuation means it saw the item;
- **fresh or perturbed items**: compare scores on the original items with newly written or reworded ones, as GSM1k does.

For client work, the defense is to not choose models by public leaderboards alone (G3.3). Build a private evaluation set from the client's own data, never published and refreshed over time, and prefer benchmarks built to limit contamination: LiveBench adds new questions monthly from recent sources and scores them against objective answers. Keeping your own eval data out of your fine-tuning data is G4.4 L3.

**In an interview**

- *The churn model scored AUC 0.98 offline and 0.70 in production. What happened?* A drop that large usually means leakage or skew, not drift. I would check which features drive the score and when each is written, since a column logged during cancellation leaks the label. Then I would compare a time-based split with the random one, look for customers present in both training and test, and compare the features logged in production against the training features for the same customers.
- *A model tops a public benchmark. Does that tell you it will work for this client?* Only weakly: public benchmarks may be in its pretraining data, and they rarely match the client's task. GSM1k showed some models losing up to 8% on fresh problems in the style of a benchmark they had seen. I would decide on a private eval built from the client's own examples and failure cases, which cannot have leaked into any pretraining set.

Sources: [Kapoor & Narayanan, Leakage and the reproducibility crisis](https://www.cell.com/patterns/fulltext/S2666-3899(23)00159-9) · [Kaufman et al., Leakage in Data Mining](https://dl.acm.org/doi/10.1145/2382577.2382579) · [Lee et al., Deduplicating Training Data](https://arxiv.org/abs/2107.06499) · [datasketch — MinHash LSH](https://ekzhu.com/datasketch/lsh.html) · [Feast — Point-in-time joins](https://docs.feast.dev/getting-started/concepts/point-in-time-joins) · [Google — Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml) · [Qian et al., adversarial validation for dataset shift](https://arxiv.org/abs/2112.10078) · [Sainz et al., NLP Evaluation in Trouble](https://arxiv.org/abs/2310.18018) · [Zhang et al., GSM1k](https://arxiv.org/abs/2405.00332) · [Golchin & Surdeanu, Time Travel in LLMs](https://arxiv.org/abs/2308.08493) · [White et al., LiveBench](https://arxiv.org/abs/2406.19314)
