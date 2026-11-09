---
title: Managed fine-tuning
---

**Managed fine-tuning** is a cloud service that runs the fine-tune for you. You upload the dataset to the provider's storage, pick a base model and a few settings, and start a job; the service provides the GPUs, trains the model, and keeps the result, ready to call through the same API as its other models.

Why teams use it:

- **No infrastructure** — no GPUs to reserve, no training code, no drivers. Azure's serverless fine-tuning needs no GPU quota at all (a quota is the cloud account's cap on how many GPUs it may reserve).
- **Models you cannot download** — some models can be tuned only through their provider, such as OpenAI's models on Azure.
- **One place** — the tuned model is hosted, secured, and billed in the same cloud account as the rest of the application.

What it costs in return:

- **Fewer choices** — only the base models and settings the service offers. Azure's serverless fine-tuning, for example, has fewer hyperparameter options than its managed-compute kind.
- **Charges beyond training** — Amazon Bedrock charges for training by tokens processed (training tokens × epochs), plus a monthly storage fee per custom model. Calling the model is a third charge: pay per use with an on-demand deployment, or pay for reserved capacity with **Provisioned Throughput**.

Services come in two kinds:

- **Serverless** — you send data and settings; the provider picks and runs the hardware. Amazon Bedrock model customization works this way, offering supervised fine-tuning, reinforcement fine-tuning (the model's own answers are scored by a reward function you define, and training raises the scores; G4.7 L2), and **distillation** (fine-tuning a small model on a larger model's answers).
- **Managed compute** — you choose the GPU machines for training and hosting, and the service runs the job on them. Amazon SageMaker AI works this way: its JumpStart catalog fine-tunes open models such as Llama and Mistral, with LoRA settings exposed as hyperparameters.

The same pieces on AWS, Azure, and Google Cloud:

| | AWS | Azure | Google Cloud |
|---|---|---|---|
| Serverless tuning | Amazon Bedrock model customization: SFT, reinforcement fine-tuning, distillation | Microsoft Foundry (formerly Azure AI Foundry) serverless fine-tuning: SFT, DPO, reinforcement fine-tuning | Gemini Enterprise Agent Platform (formerly Vertex AI): SFT, preference and reinforcement tuning of Gemini |
| Open-model tuning | Amazon SageMaker AI JumpStart | Microsoft Foundry managed compute | the same platform's open-model tuning: SFT and distillation |

OpenAI's own fine-tuning API is a common reference point, but its docs now say the platform is winding down and closed to new users.

Sources: [Amazon Bedrock — Customize your model](https://docs.aws.amazon.com/bedrock/latest/userguide/custom-models.html) · [Amazon Bedrock — Set up inference for a custom model](https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-use.html) · [Amazon SageMaker AI — Fine-tuning foundation models](https://docs.aws.amazon.com/sagemaker/latest/dg/jumpstart-foundation-models-fine-tuning.html) · [Microsoft Foundry product page](https://azure.microsoft.com/en-us/products/ai-foundry/) · [Microsoft Foundry — Fine-tuning overview](https://learn.microsoft.com/en-us/azure/ai-foundry/concepts/fine-tuning-overview) · [Google Cloud — Introduction to tuning](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/tune-models) · [Gemini Enterprise Agent Platform (formerly Vertex AI)](https://cloud.google.com/products/gemini-enterprise-agent-platform) · [OpenAI — Model optimization](https://developers.openai.com/api/docs/guides/model-optimization)
