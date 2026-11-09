---
title: Managed fine-tuning
---

Recap (G4.7 L1): in managed fine-tuning, a cloud service runs the training infrastructure. You upload a dataset, pick a base model and a few hyperparameters, and get back a private custom model to call. On AWS there are two services: **Amazon Bedrock** fine-tunes the models it hosts, with no infrastructure to manage, and **Amazon SageMaker AI** fine-tunes open-weight models with more control.

| | Bedrock model customization | SageMaker AI |
|---|---|---|
| You control | the data and a few hyperparameters | the model, the method, and, in training jobs, the code and instances |
| Base models | Amazon Nova (Micro, Lite, Pro, 2 Lite), Meta Llama 3.1 / 3.2 / 3.3, Anthropic Claude 3 Haiku, and a few image and embedding models | open-weight models: Qwen3 / 3.5 / 3.6, Llama 3.x, Gemma 4, GPT-OSS, and Nova (serverless customization), or any model in your own training job |
| Methods | supervised fine-tuning, reinforcement fine-tuning, distillation | SFT, DPO, RLVR (reinforcement learning with verifiable rewards: code checks each answer), RLAIF (reinforcement learning from AI feedback: a model scores each answer), with LoRA or full fine-tuning; anything in your own script |
| Serving the result | on-demand custom model deployment (Nova, Llama 3.3 70B), or Provisioned Throughput | a SageMaker endpoint (a managed server that hosts the model behind an HTTPS URL) billed per instance-hour, or import into Bedrock |
| Training billed by | tokens × epochs, plus monthly storage per custom model | serverless usage, or instance-hours for training jobs |

**Bedrock's three methods**, in AWS's words:

- **Supervised fine-tuning** — "Provide *labeled* data to train a model to improve performance on specific tasks."
- **Reinforcement fine-tuning** (RFT) — "you define reward functions that evaluate response quality", and the model learns from those scores.
- **Distillation** — "transfer knowledge from a larger more intelligent model (known as teacher) to a smaller, faster, and cost-efficient model (known as student)."

**The Bedrock path, end to end:** the routing task (G4.4) fine-tuned on **Amazon Nova Micro** in us-east-1. Nova Micro is chosen because it supports on-demand inference after customization. `SYSTEM_PROMPT` below is the one from the G4.4 pipeline.

**1. Convert the data** to Bedrock's conversation schema, and upload `train.jsonl` and `val.jsonl` to S3, AWS's file storage. Nova accepts 8 to 20,000 records with a 32k-token context.

```python
def to_bedrock_record(example: dict) -> dict:
    system_message, user_message = example["prompt"]
    answer = example["completion"][0]
    return {
        "schemaVersion": "bedrock-conversation-2024",
        "system": [{"text": system_message["content"]}],
        "messages": [
            {"role": "user", "content": [{"text": user_message["content"]}]},
            {"role": "assistant", "content": [{"text": answer["content"]}]},
        ],
    }
```

**2. Create a service role** that Bedrock assumes to read the data and write the results. A role is an AWS IAM identity with permissions attached, which a service can take on (assume) for a task. Its trust policy, the rule for who may assume it, lets `bedrock.amazonaws.com` call `sts:AssumeRole`, limited to your account's customization jobs:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "bedrock.amazonaws.com"},
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": {"aws:SourceAccount": "<account-id>"},
      "ArnEquals": {"aws:SourceArn": "arn:aws:bedrock:us-east-1:<account-id>:model-customization-job/*"}
    }
  }]
}
```

- **Role permissions**: `s3:GetObject` and `s3:ListBucket` on the data bucket; `s3:GetObject`, `s3:PutObject`, and `s3:ListBucket` on the output bucket.
- **Caller permission**: whoever starts the job needs `iam:PassRole` on this role, the right to hand the role to a service.
- **Optional hardening**: `vpcConfig` to run the job inside your VPC (your private network on AWS), and `customModelKmsKeyId` to encrypt the model with your own KMS key (a key held in AWS Key Management Service).
- **Data retention**: AWS states that "None of the training or validation data you provide for fine tuning is stored by Amazon Bedrock, after the fine-tuning job completes."

**3. Start the job.** Every hyperparameter value is a string. Nova Micro's three hyperparameters:

- `epochCount` — 1 to 5, default 2.
- `learningRate` — 1e-6 to 1e-4, default 1e-5.
- `learningRateWarmupSteps` — 0 to 100, default 10. AWS suggests dataset size ÷ 640 for Nova Micro: 800 rows → 1.

```python
import boto3

bedrock = boto3.client("bedrock", region_name="us-east-1")

job = bedrock.create_model_customization_job(
    jobName="routing-nova-micro-001",
    customModelName="routing-nova-micro",
    roleArn="arn:aws:iam::<account-id>:role/BedrockCustomizationRole",
    baseModelIdentifier="amazon.nova-micro-v1:0:128k",
    customizationType="FINE_TUNING",
    hyperParameters={"epochCount": "2", "learningRate": "0.00001", "learningRateWarmupSteps": "1"},
    trainingDataConfig={"s3Uri": "s3://<bucket>/routing/train.jsonl"},
    validationDataConfig={"validators": [{"s3Uri": "s3://<bucket>/routing/val.jsonl"}]},
    outputDataConfig={"s3Uri": "s3://<bucket>/routing/output/"},
)
```

The CLI equivalent is `aws bedrock create-model-customization-job`.

**4. Wait for it, and read the metrics.** The status runs `InProgress` → `Completed`, `Failed`, `Stopping`, or `Stopped`. The job passes through validation, data processing, and training.

```python
import time

def wait_for_job(job_arn: str) -> dict:
    while (details := bedrock.get_model_customization_job(jobIdentifier=job_arn))["status"] == "InProgress":
        time.sleep(300)
    return details

details = wait_for_job(job["jobArn"])
custom_model_arn = details["outputModelArn"]
print(details["status"], details.get("trainingMetrics"), details.get("validationMetrics"))
```

The output bucket also receives per-epoch training and validation loss files, which give the loss curves (G4.5).

**5. Deploy it on demand and call it.** A **custom model deployment** serves the model pay-per-use, with no reserved capacity. It supports Nova Lite, Nova 2 Lite, Nova Micro, and Nova Pro in us-east-1, and Llama 3.3 70B Instruct in us-west-2, for models customized on or after 2025-07-16. The deployment's ARN (Amazon Resource Name, the ID AWS gives every resource) goes where a model ID normally goes:

```python
deployment = bedrock.create_custom_model_deployment(
    modelDeploymentName="routing-nova-micro-on-demand",
    modelArn=custom_model_arn,
)

runtime = boto3.client("bedrock-runtime", region_name="us-east-1")
response = runtime.converse(
    modelId=deployment["customModelDeploymentArn"],
    system=[{"text": SYSTEM_PROMPT}],
    messages=[{"role": "user", "content": [{"text": "When should I pick IVF over HNSW?"}]}],
    inferenceConfig={"temperature": 0.0, "maxTokens": 32},
)
print(response["output"]["message"]["content"][0]["text"])
```

Wait until the deployment's status is `Active` before calling it, and delete it with `delete_custom_model_deployment` when you are done. Deleting the deployment keeps the custom model.

**The other way to serve it: Provisioned Throughput.** This reserves dedicated capacity, billed by the hour. `create_provisioned_model_throughput(modelId=custom_model_arn, provisionedModelName=..., modelUnits=1)` returns a `provisionedModelArn` to use as the model ID. Omit `commitmentDuration` for no commitment, or set `OneMonth` or `SixMonths`. For base models without on-demand support, and for full-rank fine-tunes, it is the only option; AWS's pricing page says "For Full Rank fine-tuned models, Provisioned Throughput (PT) is the available option."

**Serving your own fine-tune: Custom Model Import.** This Bedrock feature brings weights trained elsewhere, such as the G4.6 Qwen3 fine-tune, into Bedrock, and serves them on demand.

- **Architectures**: Llama, Mistral, Mixtral, Qwen2 / 2.5, and Qwen3 (`Qwen3ForCausalLM` and `Qwen3MoeForCausalLM`), among others.
- **Files**: the merged model (G4.6 step 9) in Hugging Face format — `.safetensors` weights, `config.json`, and the tokenizer files — in an S3 folder.
- **Limits**: text models under 200 GB of weights and under 128K context. AWS states "Amazon Bedrock supports transformer version 4.51.3". The G4.6 run uses Transformers 5, so if the import rejects the files, redo the merge in an environment pinned to 4.51.3 (untested).
- **Billing**: running model copies × Custom Model Units (CMUs) per copy × the per-minute CMU rate, "charged over 5-minute billing windows from the first successful inference call." "There is no charge to import the model."

```python
import json

bedrock.create_model_import_job(
    jobName="routing-qwen3-import-001",
    importedModelName="routing-qwen3-4b",
    roleArn="arn:aws:iam::<account-id>:role/BedrockImportRole",
    modelDataSource={"s3DataSource": {"s3Uri": "s3://<bucket>/routing-merged/"}},
)

payload = {"messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": "When should I pick IVF over HNSW?"}], "max_tokens": 32, "temperature": 0.0}
response = runtime.invoke_model(modelId="<imported-model-arn>", body=json.dumps(payload), accept="application/json", contentType="application/json")
print(json.loads(response["body"].read())["choices"][0]["message"]["content"])
```

- **Use `InvokeModel`.** The Converse API does not support imported Qwen3 models. The body above uses the OpenAI chat-completion format, which imported models accept, and which needs the chat template inside `tokenizer_config.json`.
- **The first call after idle time** can fail with `ModelNotReadyException` while Bedrock restores the model. boto3 retries with backoff; raise the retry count if it keeps failing.

**The SageMaker AI path.** **Serverless model customization** (announced December 2025) fine-tunes open-weight models with SFT, DPO, RLVR, RLAIF, or multi-turn RL, using LoRA or full fine-tuning. It needs no instances to size. It uses SageMaker Python SDK v3; v2 has been in maintenance mode since 2026-07-06. The docs' example (its `SFTTrainer` is SageMaker's class, not TRL's):

```python
from sagemaker.train import SFTTrainer
from sagemaker.train.common import TrainingType

trainer = SFTTrainer(
    model="meta-textgeneration-llama-3-2-1b-instruct",
    training_type=TrainingType.LORA,
    model_package_group="my-finetuned-models",
    training_dataset="s3://my-bucket/train.jsonl",
    accept_eula=True,
)
trainer.train()
```

- `train(dry_run=True)` validates the setup without training.
- The result is registered in the `model_package_group` model registry, SageMaker's versioned catalog of trained models. Deploy it to a SageMaker endpoint or to Bedrock.

**Full control** means running the G4.6 TRL script as a SageMaker training job. In SDK v3, `ModelTrainer` runs your own script on instances you choose; it replaces v2's `HuggingFace` estimator and `JumpStartEstimator`. `ModelBuilder(model=trainer).deploy()` then serves the result on an endpoint of an instance type such as `ml.g5.2xlarge` (one NVIDIA A10G GPU). **SageMaker HyperPod recipes** are pre-built training setups for larger multi-GPU runs.

**Choosing on AWS:**

- **A Bedrock model fits the task** → Bedrock customization. It has the least to operate, and on-demand serving for Nova.
- **You need an open model, or DPO / RL** → SageMaker serverless customization.
- **You need your own code or method** → a SageMaker training job with your TRL script.
- **You trained it yourself and want serverless serving** → Custom Model Import.

**Other clouds, and OpenAI as a reference:**

| | Azure: Microsoft Foundry | Google Cloud: Gemini Enterprise Agent Platform (formerly Vertex AI) | OpenAI API |
|---|---|---|---|
| Models | `gpt-4.1` / `-mini` / `-nano`, `gpt-4o`, `gpt-4o-mini`; `o4-mini` for RFT; open models such as Llama-3.3-70B-Instruct, Qwen-32B, gpt-oss-20b | Gemini 3.5 Flash, 3.1 Flash-Lite, 2.5 Pro / Flash / Flash-Lite; open models such as Gemma, Qwen, Llama | `gpt-4.1` / `-mini` / `-nano` (SFT, DPO); `o4-mini` (RFT) |
| Methods | SFT, DPO, RFT | supervised, preference tuning, distillation | SFT, DPO, RFT |
| Training options | Standard (data stays in region), Global (cheaper, no residency), Developer (preemptible: the job can be paused for higher-priority work; 50% off Global) | adapter size, epochs, learning-rate multiplier | epochs, batch size, learning-rate multiplier (`beta` for DPO) |
| Serving the result | per token plus an hourly hosting fee; or Provisioned Throughput units; Developer deployments are deleted after 24 hours | tuned Gemini: serverless endpoint, per token (1.5× the base price from Gemini 3 on); open models: a dedicated GPU endpoint | per token, no hosting fee |
| Job API | `client.fine_tuning.jobs.create(...)` with the OpenAI SDK | `client.tunings.tune(...)` in `google-genai`, Google's Python SDK; `vertexai.tuning` is deprecated | `client.fine_tuning.jobs.create(...)` |

**The OpenAI fine-tuning API** is the reference design that the others resemble. It is being wound down:

- Since 2026-05-07, organizations that never fine-tuned cannot start jobs.
- From 2027-01-06, no customer can create new jobs.
- Inference on existing fine-tuned models continues until their base models are deprecated.

The shape of a job:

```python
from openai import OpenAI

client = OpenAI()
training_file = client.files.create(file=open("train.jsonl", "rb"), purpose="fine-tune")
job = client.fine_tuning.jobs.create(
    model="gpt-4.1-mini-2025-04-14",
    training_file=training_file.id,
    method={"type": "supervised", "supervised": {"hyperparameters": {"n_epochs": 3}}},
)
for event in client.fine_tuning.jobs.list_events(fine_tuning_job_id=job.id, limit=10):
    print(event.message)
```

- Each training line is `{"messages": [...]}`. The minimum is 10 examples, and the docs suggest starting with about 50.
- DPO uses `method={"type": "dpo", "dpo": {"hyperparameters": {"beta": 0.1}}}`, with lines of `input`, `preferred_output`, and `non_preferred_output`.
- The finished job's `fine_tuned_model` (`ft:...`) is passed as `model` in normal API calls.

Sources:

- AWS Bedrock: [Customize your model](https://docs.aws.amazon.com/bedrock/latest/userguide/custom-models.html) · [Supported models for fine-tuning](https://docs.aws.amazon.com/bedrock/latest/userguide/custom-model-fine-tuning.html) · [Nova data preparation](https://docs.aws.amazon.com/nova/latest/userguide/fine-tune-prepare-data-understanding.html) · [Custom model hyperparameters](https://docs.aws.amazon.com/bedrock/latest/userguide/custom-models-hp.html) · [`CreateModelCustomizationJob`](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_CreateModelCustomizationJob.html) · [`GetModelCustomizationJob`](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetModelCustomizationJob.html) · [Access and security for customization jobs](https://docs.aws.amazon.com/bedrock/latest/userguide/custom-model-job-access-security.html) · [Deploy a custom model for on-demand inference](https://docs.aws.amazon.com/bedrock/latest/userguide/deploy-custom-model-on-demand.html) · [Provisioned Throughput](https://docs.aws.amazon.com/bedrock/latest/userguide/prov-throughput.html) · [Custom Model Import](https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-import-model.html) · [`CreateModelImportJob`](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_CreateModelImportJob.html) · [Invoke an imported model](https://docs.aws.amazon.com/bedrock/latest/userguide/invoke-imported-model.html) · [Import cost](https://docs.aws.amazon.com/bedrock/latest/userguide/import-model-calculate-cost.html) · [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
- AWS SageMaker: [Serverless model customization](https://docs.aws.amazon.com/sagemaker/latest/dg/customize-model.html) · [SDK v3 model customization](https://sagemaker.readthedocs.io/en/stable/model_customization/model_customization.html) · [SDK lifecycle](https://sagemaker.readthedocs.io/en/stable/lifecycle.html) · [SDK v3 training (`ModelTrainer`)](https://sagemaker.readthedocs.io/en/stable/training/index.html) · [HyperPod recipes](https://docs.aws.amazon.com/sagemaker/latest/dg/sagemaker-hyperpod-recipes.html)
- Azure: [Foundry fine-tuning](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/fine-tuning) · [Fine-tuning cost management](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/fine-tuning-cost-management)
- Google Cloud: [Tuning overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tuning) · [Supervised tuning](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tuning/supervised-tuning) · [Open-model tuning](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tuning/open-model-tuning) · [Pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing)
- OpenAI: [Supervised fine-tuning](https://developers.openai.com/api/docs/guides/supervised-fine-tuning) · [Model optimization](https://developers.openai.com/api/docs/guides/model-optimization) · [Deprecations](https://developers.openai.com/api/docs/deprecations) · [`jobs.create` reference](https://developers.openai.com/api/reference/python/resources/fine_tuning/subresources/jobs/methods/create)
