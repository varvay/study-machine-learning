---
title: Managed fine-tuning
---

L2 walked the managed path on AWS: Amazon Bedrock model customization and SageMaker AI training jobs, with Azure AI Foundry, Vertex AI, and the OpenAI API as reference points. At L3 the questions are what a custom model costs to keep running, where the data goes, how locked in you become, and when self-hosting wins.

**The three costs of a managed fine-tune.** Every provider bills some mix of:

1. **Training** — usually per token processed: tokens in the training file × epochs. Bedrock bills fine-tuning this way; reinforcement fine-tuning is billed per hour.
2. **Storage** — per custom model per month. Bedrock charges $1.95 per model-month.
3. **Hosting and inference** — the cost that surprises clients. Training is paid once; hosting is paid every hour the model is available, whether or not anyone calls it.

**Hosting on Bedrock, three ways:**

- **On-demand, same price as the base model.** A custom model trained with a parameter-efficient technique (fine-tuning, preference optimization, or distillation) can be served on demand, at the base model's token prices, through a **custom model deployment** (`CreateCustomModelDeployment`; the deployment's ARN is then the `modelId`). The limits: the supported base models are Amazon Nova Micro, Lite, Pro, and Nova 2 Lite in US East (N. Virginia), and Meta Llama 3.3 70B Instruct in US West (Oregon), and the model must have been customized on or after 16 July 2025.
- **Provisioned Throughput.** Dedicated capacity, bought in model units (each a fixed amount of throughput for one model) by the hour. Full-rank fine-tuned models can only be served this way. The pricing page's example: Llama 2 13B at $21.18 per model unit per hour with a one-month commitment, which is 730 × $21.18 ≈ **$15,460 a month** for one unit, used or not.
- **Custom Model Import.** Bring weights trained elsewhere, such as your own merged QLoRA fine-tune (G4.6), in a supported architecture: Llama, Mistral, Mixtral, Flan, Qwen, and others. It bills per **Custom Model Unit** per minute, $0.05718 in US East and US West, in 5-minute windows while a model copy is active, plus $1.95 per unit per month for storage. Llama 3.1 8B needs 2 units: $6.86 per active hour. After 5 minutes without calls Bedrock scales it to zero, and the next call waits through a cold start, the model loading back onto a GPU, of tens of seconds. Always on, that is about **$5,000 a month**; active 10 hours on 22 working days, about **$1,500**.

**SageMaker AI** is the do-it-yourself end of AWS. Training jobs run your own script, TRL and PEFT included, on instances you choose, and write the weights to your S3 bucket; **managed spot training**, which runs on spare EC2 capacity (AWS's virtual machines) that AWS can reclaim at short notice, cuts the bill by up to 90% against on-demand instances, if the job checkpoints so an interrupted run resumes. JumpStart fine-tunes listed open models with hyperparameters such as `lora_r`, `lora_alpha`, `int8_quantization`, and `enable_fsdp`. The weights are yours: serve them on a SageMaker endpoint, on your own vLLM, or import them into Bedrock.

**Managed against self-hosted, worked.** Serving one fine-tuned Llama 3.1 8B:

| | Bedrock Custom Model Import | Self-hosted vLLM on EC2 |
|---|---|---|
| Compute | 2 units × $0.05718 per minute = $6.86 per active hour | one g6.xlarge (one 24 GB L4) at $0.805 per hour |
| Always on, 730 hours | ≈ $5,010 a month | ≈ $590 a month |
| Business hours only, 220 hours | ≈ $1,510, with automatic scale to zero | ≈ $180, if you script the start and stop |
| Also included | scaling, patching, the Bedrock API, IAM, logging | nothing: you run the server, the scaling, the on-call |
| Also possible | none of the self-hosted tuning | multi-LoRA: many adapters on one GPU (G4.2) |

The GPU line alone favors self-hosting by about 8×. The comparison a client needs adds engineering time: a production vLLM service needs deployment, autoscaling, monitoring, security patches, and someone on call (G6). For one model at low or bursty volume, Bedrock's scale-to-zero and zero operations often win; for steady volume, many adapters, or a team that already runs GPUs, self-hosting wins. Capacity matters too: a 24 GB L4 holds the 16 GB model plus about 6 GB of KV cache, enough for moderate concurrency; load-test before committing (unsourced).

**Data governance.** What a client's security team will ask, and Bedrock's answers:

- **Who can see the data?** Bedrock runs each provider's model in a **model deployment account** owned by the Bedrock service team. Model providers have no access to those accounts, so they cannot see Bedrock logs, customer prompts, or completions.
- **Where does it live?** Training data stays in your S3 bucket; jobs and custom models can be encrypted with your own KMS keys and reached through a VPC with PrivateLink, a private connection to the service that never crosses the public internet.
- **Which region?** On-demand serving of custom models exists only in the two US regions above, which rules it out for data that must stay in, say, the EU. Check the region list for every feature before promising residency.
- **What goes into the training set?** Governance starts earlier: PII redaction, licenses, and provenance per row (G4.4) apply to managed and self-hosted runs alike.

**Lock-in.** A fine-tune of a closed model can run only where that model runs, and lives only as long as the provider supports it:

- **The weights stay put.** A customized Nova, GPT, or Gemini model is served by its provider only; its weights are not yours to download (the base weights are proprietary).
- **The base model retires.** OpenAI's fine-tuned models remain available only until their base models are deprecated; then the fine-tune must be redone on a successor.
- **The platform can close.** OpenAI announced on 7 May 2026 that it is winding down self-serve fine-tuning: closed to new organizations that day, to organizations that had not run inference on a fine-tuned model in the past 60 days from 2 July 2026, and to all customers for new jobs from 6 January 2027. Existing fine-tuned models keep serving until their base models are deprecated.
- **What stays portable** is what you own: the dataset, the eval set, and the training recipe. Keep those in your repository and versioned (G4.4), and a move to another provider is a retraining run, not a rebuild. Open-weight bases trained on SageMaker or self-hosted keep the weights portable as well.

**Azure and GCP (Google Cloud Platform) equivalents.**

| | AWS | Azure AI Foundry | Google Vertex AI |
|---|---|---|---|
| Managed fine-tuning of the provider's models | Bedrock: Nova, Llama, and others; SFT, distillation, reinforcement fine-tuning | Azure OpenAI models: SFT and DPO billed per training token × epochs; reinforcement fine-tuning per hour ($100 an hour for o4-mini in Microsoft's example) | Gemini: supervised, preference, and reinforcement tuning, per training token × epochs (Gemini 2.5 Flash: $5 per million training tokens) |
| Hosting a custom model | on demand at base prices (listed models), Provisioned Throughput, or Custom Model Import per unit-minute | Standard deployment: base token prices plus $1.70 an hour hosting, about $1,240 a month; Developer tier: no hosting fee, deleted after 24 hours | tuned endpoint at the base model's price for older Gemini models; 1.5× the base price from Gemini 3 on |
| Open-model tuning with your own code | SageMaker AI training jobs, JumpStart | Azure Machine Learning (unsourced here) | Vertex AI open-model tuning (e.g. Llama 3.1 8B SFT at $0.67 per million training tokens) or custom training |

**In an interview**

- *The client asks: fine-tune on Bedrock, or do it ourselves?* It turns on volume, operations, and portability. Bedrock gives scale-to-zero, IAM, and no servers to run, and for a PEFT-tuned Nova or Llama 3.3 70B it serves on demand at base-model prices; self-hosting an 8B model on one L4 costs about $590 a month against about $5,000 for an always-on import, but adds a service the team must run. I would train on SageMaker or my own GPUs so the weights stay ours, then serve on Bedrock while volume is low and move to self-hosted vLLM when steady volume or many adapters make the GPU cheaper.
- *What is the hidden cost of a managed fine-tune?* Hosting, not training: Azure charges $1.70 an hour per deployed fine-tune whether or not it is called, and Bedrock Provisioned Throughput bills model units by the hour. After that come lock-in and residency: the fine-tune dies with its base model or platform, as OpenAI's wind-down of fine-tuning shows, and some serving options exist only in certain regions. I keep the dataset and eval portable so moving is a retraining run.

Sources: [Amazon Bedrock — customize your model](https://docs.aws.amazon.com/bedrock/latest/userguide/custom-models.html) · [Amazon Bedrock pricing (customization, Provisioned Throughput, Custom Model Import)](https://aws.amazon.com/bedrock/pricing/) · [Amazon Bedrock — deploy a custom model for on-demand inference](https://docs.aws.amazon.com/bedrock/latest/userguide/deploy-custom-model-on-demand.html) · [Amazon Bedrock — Custom Model Import](https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-import-model.html) · [Amazon Bedrock — reinforcement fine-tuning](https://docs.aws.amazon.com/bedrock/latest/userguide/reinforcement-fine-tuning.html) · [Amazon Bedrock — data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html) · [SageMaker AI — managed spot training](https://docs.aws.amazon.com/sagemaker/latest/dg/model-managed-spot-training.html) · [SageMaker AI — JumpStart fine-tuning hyperparameters](https://docs.aws.amazon.com/sagemaker/latest/dg/jumpstart-foundation-models-fine-tuning.html) · [Vantage — g6.xlarge pricing](https://instances.vantage.sh/aws/ec2/g6.xlarge) · [Microsoft Foundry — fine-tuning cost management](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/fine-tuning-cost-management) · [Vertex AI — generative AI pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing) · [Vertex AI — tuning overview](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/tune-models) · [OpenAI — model optimization guide](https://developers.openai.com/api/docs/guides/model-optimization) · [OpenAI — deprecations](https://developers.openai.com/api/docs/deprecations)
