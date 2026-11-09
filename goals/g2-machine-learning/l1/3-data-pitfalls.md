---
title: Data pitfalls
---

A model can score well in testing and still fail in production when the data behind the score was set up wrong. Three setups decide whether a score can be trusted.

**Splitting the data.** The data is cut into three parts that share no rows:

- **Training set** — the examples the model learns its parameters from, often about 70% of the data.
- **Validation set** — the examples used to choose between models and to tune **hyperparameters**, the settings fixed before training rather than learned, such as a decision tree's depth (how many yes/no questions it may ask in a row; G2.1 L2) or a learning rate (the size of each training step; G2.4).
- **Test set** — the examples kept aside until the very end, scored once, for an honest estimate on unseen data.

A separate validation set exists because every choice made by looking at a score fits the model a little to that data. Choose by test score, and the test score stops being honest. Cross-validation (G2.1) can replace a single validation set when data is scarce.

The split must match how the model will be used:

- **Time-based data** — train on the past and test on the later period. A random split lets the model learn from the future it is supposed to predict.
- **Grouped data** — keep all rows of one customer or one patient in the same part. Otherwise the model recognizes the person instead of learning the pattern.

**Data leakage** — information in the training data that will not be available at prediction time. It makes the model look better in testing than it can ever be in use. Examples:

- predicting fraud with a `refund_issued` column, when refunds are only issued after fraud is confirmed;
- the same customer's rows in both the training and the test set;
- scaling **features** (the input columns a model reads), that is, putting each on a common range, with averages computed over all the data, test set included.

The usual symptom is a score that seems too good, then collapses in production.

**Class imbalance** — one class is far rarer than the others, such as 1 fraud per 1,000 payments. A model can then score 99.9% accuracy by never predicting fraud, and it has little incentive to learn the rare class. Common remedies:

- **class weights** — make each mistake on the rare class cost more during training;
- **resampling** — repeat rare examples or drop some common ones, so training sees a better balance;
- **stratified splits** — keep the same class ratio in the training, validation, and test sets;
- **better metrics** — judge by precision, recall, or F1 (G2.2) instead of accuracy.
