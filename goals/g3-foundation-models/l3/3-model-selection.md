---
title: Model selection
---

L2 compared models on one task and read prices per million tokens. At L3 the choice is for a client: filter by hard constraints, cost the survivors at real volume, route between them, and let a task-specific eval decide.

**Choose in three passes.**

1. **Hard constraints remove options.** Where data may be processed (data residency), whether it may leave the client's network at all (on-premises), the licence of an open-weight model, the context length and modalities (text, images, audio) needed. A model that fails one is out, whatever its quality.
2. **Cost and latency rank the rest,** computed at the client's real volume and prompt sizes.
3. **A task-specific eval picks,** as the cheapest candidate that clears the quality bar on the client's own examples. Leaderboards only shortlist.

**Data residency on AWS.** Amazon Bedrock runs each provider's model in a **model deployment account** owned by the Bedrock team; the model provider has no access to it, so providers never see prompts, completions, or logs. Where inference runs is a choice of endpoint:

- **In-region** — call a model ID in one AWS Region, such as `eu-central-1`; inference stays there.
- **Geographic cross-Region inference** — an inference profile for a geography (US, EU, APAC) routes each request to any Region inside it, for more capacity. The Bedrock docs recommend it when data residency rules apply.
- **Global cross-Region inference** — routes to any commercial AWS Region worldwide, at about 10% lower price. It breaks residency requirements; block it for regulated clients with a service control policy (an AWS Organizations rule that limits what the client's accounts may call).
- CloudTrail, AWS's log of every API call, records where each request ran in `additionalEventData.inferenceRegion`, which is the audit evidence a regulator asks for.

**The deployment ladder on AWS**, from least to most control:

| Option | What you get | You pay for | Choose it when |
|---|---|---|---|
| **Bedrock on-demand** | serverless API over many proprietary and open models | tokens | the default: variable traffic, no ML ops team |
| **Bedrock Provisioned Throughput** | reserved capacity in **model units** (each a fixed rate of input and output tokens per minute) | hours, with no commitment, 1 month, or 6 months; longer is cheaper | steady high volume, predictable latency, or a model you customized in Bedrock (required there) |
| **Bedrock Custom Model Import** | your own fine-tuned open weights (Llama, Mistral, Mixtral, Qwen, GPT-OSS, Flan-T5) served on demand | usage of the imported model | a fine-tuned open model (G4) without running servers; weights in Hugging Face safetensors format (its standard weight-file format), under 200 GB for text models, context under 128K |
| **SageMaker AI endpoint** | any model on instances you choose, in your VPC (your private network inside AWS), with the LMI container running vLLM or TensorRT-LLM | instance hours, busy or idle | full control of the engine, quantization, or hardware |
| **On-premises** | the same engine on the client's GPUs | hardware and operations | data may not leave the building, or air-gapped sites (no connection to outside networks) |

The same choices on the other clouds:

| Need | AWS | Azure | Google Cloud |
|---|---|---|---|
| managed model API | Bedrock | Microsoft Foundry Models | Vertex AI (docs now titled Gemini Enterprise Agent Platform) |
| process within one geography | geographic cross-Region inference profile | Data Zone deployment (US, EU, APAC) | multi-region endpoint (US, EU) |
| tightest location control | in-region model ID (one Region) | Standard or Regional Provisioned deployment (one Azure geography) | regional endpoint (the region's jurisdiction) |
| cheapest, any region | global cross-Region inference | Global Standard deployment | global endpoint |
| reserved capacity | Provisioned Throughput (model units) | Provisioned deployments (PTUs: provisioned throughput units) | Provisioned Throughput (GSUs: generative AI scale units) |

**Cost at scale.** API cost grows with tokens; self-hosted cost grows with GPU hours, busy or idle.

- API cost per month = requests × (input tokens × input price + output tokens × output price). Output tokens cost about 5× input tokens for current Claude models, and every output token also adds decode latency (G3.1), so cap `max_tokens` and ask for short answers.
- Self-hosted cost per month = replicas × 730 hours × hourly instance price, plus the engineers who run it. It wins only when traffic keeps the GPUs busy around the clock; bursty or low traffic pays for idle hours.
- Discounts change the ranking: prompt caching bills repeated prefixes at a tenth of the input price or less (G3.5), and batch inference halves the price where answers may wait (Anthropic's Batch API; Azure Global Batch).

**Worked example.** A European bank wants a support assistant over its policy documents: 50,000 conversations a day, about 4 model calls each, data kept in the EU, first token within 2 seconds.

- Residency: Bedrock in an EU Region, with the EU geographic inference profile for capacity; global profiles blocked by policy.
- Volume: 200,000 calls a day × (3,000 input + 300 output tokens) = 600M input and 60M output tokens a day.
- At Anthropic's list prices (Bedrock publishes its own on its pricing page), Claude Sonnet 5.5 at $2 / $10 per million costs 600 × $2 + 60 × $10 = $1,800 a day, about $54,000 a month. Claude Haiku 4.5 at $1 / $5 costs $900 a day, about $27,000 a month.
- If 2,000 of the 3,000 input tokens are a fixed system prompt and tool definitions, caching them saves 90% on 400M tokens a day: $720 a day on Sonnet.
- The eval then decides whether Haiku clears the quality bar, on all questions or only the simple ones. That second answer leads to routing.

**Model routing** is sending each request to the cheapest model likely to answer it well.

- **Rules** — route by task or input: classification and extraction to a small model, multi-step reasoning to a large one. Transparent and easy to test.
- **Learned router** — a classifier predicts, per request, whether the weak model's answer would be as good as the strong one's. RouteLLM trained routers on human preference data and, in some settings, cut cost by over 2× without losing quality on standard benchmarks.
- **Cascade** — call the cheap model first, score its answer, and escalate only when the score is low. FrugalGPT matched GPT-4's quality at up to 98% lower cost on its benchmarks. The price is latency on escalated requests, and a scorer that must itself be trusted.
- **Bedrock Intelligent Prompt Routing** — a managed router between exactly two models of one family (for example two Claude or two Llama models). It predicts each model's response quality per request and switches from the fallback model to the other only when the predicted gain exceeds your `responseQualityDifference`. It is optimized for English prompts and cannot learn from your application's own quality data.

**Fallback** is serving a request from another model or Region when the first choice fails: throttling (HTTP 429), server errors, or timeouts.

- Retry with exponential backoff and jitter (the wait doubles after each failure, plus a random offset so clients do not retry in step) first, then fall over to another Region in the allowed geography, then to another model.
- Put a **circuit breaker** in front of each model: after repeated failures, stop calling it for a while so every request doesn't pay the timeout.
- A fallback model is a different model: prompts, output formats, and refusal behaviour differ, and prompt caches start cold (a cache holds one model's keys and values). Keep a prompt version per model and run the eval on every fallback path before it takes traffic.

**A task-specific eval** is a fixed set of real inputs from the client's use case, each with a correct answer or a grading rubric, scored the same way for every candidate model.

- **Build it** from real traffic or client documents: typical cases, hard cases, and the cases that cause harm when wrong. A few hundred items is a common starting size (unsourced).
- **Score** with the cheapest reliable grader: exact match or field-level F1 (G2.2) for extraction, JSON schema validity for structured output, faithfulness for RAG (G3.2), an LLM judge with a rubric for open answers.
- **Record cost and latency** next to quality: p50 (median) and p95 (95th-percentile) latency, and cost per 1,000 requests from real token counts.
- **Decide** by the quality bar first, then cost. Pin exact model versions, and re-run the eval before moving to a new one.
- **On AWS**, Bedrock model evaluation jobs run this with your own prompt dataset: programmatic metrics, human workers, or an LLM judge. They also accept imported models, prompt routers, and provisioned models.

A minimal harness over the Bedrock Converse API, for an extraction task with exact-match grading:

```python
import statistics

import boto3

bedrock = boto3.client("bedrock-runtime", region_name="eu-central-1")

USD_PER_MILLION_TOKENS = {
    "anthropic.claude-sonnet-5-5": {"input": 2.00, "output": 10.00},
    "anthropic.claude-haiku-4-5-20251001-v1:0": {"input": 1.00, "output": 5.00},
}


def evaluate(model_id, eval_set):
    correct, latencies, cost = 0, [], 0.0
    price = USD_PER_MILLION_TOKENS[model_id]
    for item in eval_set:
        response = bedrock.converse(
            modelId=model_id,
            system=[{"text": "Extract the policy number. Reply with the number only."}],
            messages=[{"role": "user", "content": [{"text": item["document"]}]}],
            inferenceConfig={"maxTokens": 50, "temperature": 0},
        )
        answer = response["output"]["message"]["content"][0]["text"].strip()
        correct += answer == item["expected"]
        latencies.append(response["metrics"]["latencyMs"])
        usage = response["usage"]
        cost += (usage["inputTokens"] * price["input"] + usage["outputTokens"] * price["output"]) / 1e6
    return {
        "accuracy": correct / len(eval_set),
        "p95_latency_ms": statistics.quantiles(latencies, n=20)[-1],
        "usd_per_1000_requests": 1000 * cost / len(eval_set),
    }
```

The prices in the dictionary are Anthropic's list prices; replace them with the Bedrock pricing page's values for the Region you use. Some models are callable only through an inference profile ID (such as one prefixed `eu.`); the model's Bedrock documentation lists which.

**In an interview**

- *A client in the EU wants a GenAI assistant but worries about data leaving the EU. What do you propose?* Bedrock in an EU Region: model providers have no access to the deployment accounts, and inference stays in-region or, with the EU geographic inference profile, within EU Regions; global profiles are blocked by a service control policy, and CloudTrail shows the Region of every request. If even that is not allowed, an open-weight model on a SageMaker endpoint in their VPC, or on their own GPUs with vLLM. Then I pick the model with an eval on their data.
- *How do you cut LLM cost without hurting quality?* Measure first with a task eval that tracks quality and cost per request. Then take the free wins: prompt caching for fixed prefixes, shorter outputs, batch pricing for offline work. Then route: send the requests the eval shows a small model handles to that model, and keep the large model for the rest, with the eval gating every change.

Sources: [Bedrock data protection (model deployment accounts)](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html) · [Bedrock cross-Region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html) · [Bedrock Provisioned Throughput](https://docs.aws.amazon.com/bedrock/latest/userguide/prov-throughput.html) · [Bedrock Custom Model Import](https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-import-model.html) · [SageMaker JumpStart](https://docs.aws.amazon.com/sagemaker/latest/dg/studio-jumpstart.html) · [SageMaker LMI container docs](https://docs.djl.ai/master/docs/serving/serving/docs/lmi/index.html) · [Microsoft Foundry deployment types](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types) · [Google Cloud generative AI data residency](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency) · [Google Cloud Provisioned Throughput](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/provisioned-throughput/overview) · [Anthropic pricing (list prices, batch, caching)](https://platform.claude.com/docs/en/about-claude/pricing) · [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) · [Ong et al., RouteLLM](https://arxiv.org/abs/2406.18665) · [Chen et al., FrugalGPT](https://arxiv.org/abs/2305.05176) · [Bedrock Intelligent Prompt Routing](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-routing.html) · [Bedrock evaluations](https://docs.aws.amazon.com/bedrock/latest/userguide/evaluation.html) · [boto3 Converse API](https://docs.aws.amazon.com/boto3/latest/reference/services/bedrock-runtime/client/converse.html)
