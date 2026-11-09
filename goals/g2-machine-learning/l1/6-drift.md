---
title: Drift and monitoring
---

A model's quality often falls after deployment, though the model itself never changes. The world it predicts changes, and the model still reflects its training data. That change is **drift**, and it comes in two kinds:

- **Data drift** — the inputs change: new kinds of values arrive, or familiar ones in different proportions. A loan model trained on salaried applicants starts seeing many freelancers, a group it saw little of. The rule it learned may still hold, but it now applies it where it has little experience.
- **Concept drift** — the relationship between inputs and the answer changes: the same input now deserves a different answer. Spammers adapt, so emails that looked harmless last year are spam this year.

Drift is caught by **monitoring** three things in production:

- **Inputs** — compare the live distribution of each input (how often each value occurs) with its distribution in training. This catches data drift.
- **Predictions** — watch the share of each predicted class or the average predicted value. A sudden shift signals a change upstream.
- **Quality** — score predictions against the true answers once they arrive. This is the only direct check for concept drift, but true answers often arrive late: fraud is confirmed weeks after the payment. Until then, teams watch proxies, such as how often users correct the output.

The usual fix is **retraining** on recent data, either on a schedule or when monitoring detects drift. In an LLM app, drift shows up as users asking about new topics, and as source documents going stale.
