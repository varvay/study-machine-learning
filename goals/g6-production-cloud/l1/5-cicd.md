---
title: CI/CD and evaluation gates
---

- **CI (continuous integration)** — every change pushed to the repository triggers an automated build and test run, so a broken change is caught within minutes, before it is merged.
- **CD (continuous delivery or deployment)** — every change that passes CI is packaged and released automatically: to a staging environment (a copy of production used for final checks) that awaits a final approval (delivery), or straight to production (deployment).

An ML or LLM app changes in more ways than its code, and each can change the answers: the model, the prompt, the retrieval settings (chunk size, top-k), the documents, and the training data. So each of them is versioned and goes through the pipeline like code.

- **Model versioning** — giving every trained or fine-tuned model a fixed version, linked to the code, data, and settings that produced it. Any answer can then be traced to the exact model behind it, and a bad release rolled back to the previous version. For a model API, the version is the exact model ID the app sends, such as `anthropic.claude-opus-4-7` on Bedrock.
- **Model registry** — a catalog of model versions with their metadata and lifecycle state, from which deployment pulls a model. The **MLflow Model Registry**, part of the open-source MLflow platform for tracking training runs and models, records each version, **aliases** that point to one (such as "champion" for the version in production), tags, and **lineage**: which training run produced it. The **SageMaker Model Registry** groups versions into model groups and gives each version an approval status that can gate its deployment.
- **Evaluation gate** — an automated pipeline step that scores a new version on a fixed evaluation set and blocks the release if a score falls below a threshold, or below the version in production. Unit tests check that the code runs; the gate checks that the answers are still good. Example: a prompt change runs 200 saved questions with known good answers, and it ships only if the share judged correct does not drop. The scores come from metrics (G2.2) or an LLM that grades each answer, an **LLM judge** (G5.6).

The gate is **offline**: it scores saved data before release. Scoring live traffic after release is online evaluation, part of observability (G6.6).

A release then flows: change → CI runs the unit tests and the offline evaluation → the new version enters the registry → the gate passes it → deployment → monitoring.

Sources: [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/) · [SageMaker Model Registry](https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry.html) · [What is Amazon Bedrock? (model ID example)](https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html)
