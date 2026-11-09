---
title: Model selection
---

Recap (G3.3 L1): proprietary against open-weight, and size against cost, latency, and quality. This section puts prices side by side, compares models on one task with code, and reads the documents that describe a model.

**Price per million tokens.** API models charge separately for input tokens (everything sent) and output tokens (everything generated, hidden reasoning included). Prices are per million tokens (MTok), as of 2026-10:

| Provider | Model | API ID | Input $/MTok | Output $/MTok | Context window |
|---|---|---|---|---|---|
| Anthropic | Claude Fable 5.1 | `claude-fable-5-1` | 10 | 50 | 1M |
| Anthropic | Claude Opus 5.5 | `claude-opus-5-5` | 4 | 20 | 1M |
| Anthropic | Claude Sonnet 5.5 | `claude-sonnet-5-5` | 2 | 10 | 1M |
| Anthropic | Claude Haiku 4.5 | `claude-haiku-4-5` | 1 | 5 | 200K |
| OpenAI | GPT-6 Astra | `gpt-6-astra` | 10 | 50 | 1.05M |
| OpenAI | GPT-6.1 Sol | `gpt-6.1-sol` | 2 | 10 | 1.05M |
| OpenAI | GPT-6 Luna | `gpt-6-luna` | 0.10 | 0.50 | 1.05M |
| Google | Gemini 3.1 Pro (preview) | `gemini-3.1-pro-preview` | 2 (4 above 200K) | 12 (18 above 200K) | 1M |
| Google | Gemini 3.8 Flash | `gemini-3.8-flash` | 0.75 | 3.75 | 1M |
| Google | Gemini 3.5 Flash-Lite | `gemini-3.5-flash-lite` | 0.30 | 2.50 | 1M |
| Mistral (open-weight) on Bedrock | Mistral Large 3 | `mistral.mistral-large-3-675b-instruct` | 0.50 | 1.50 | 256K |

- **OpenAI long context** — above 272K input tokens, GPT-6 prices rise (Astra to $20 / $75).
- **Gemini 3.8 Flash** — the price shown is introductory until 2026-12-31, then $1.50 / $7.50.
- **Discounts** — Anthropic's Batch API, which takes requests in bulk and returns the results within 24 hours, halves both prices, and prompt-cache reads (input the provider already processed in an earlier request with the same prompt start, G3.5 L3) cost a tenth of the input price or less (G6.8).

The cost of one request follows from the token counts:

cost per request = input tokens × input price / 10⁶ + output tokens × output price / 10⁶

A RAG request with 4,000 input tokens (system prompt, retrieved chunks, question) and 400 output tokens:

| Model | Cost per request | Per 1,000 requests |
|---|---|---|
| Claude Sonnet 5.5 | 4,000 × 2 / 10⁶ + 400 × 10 / 10⁶ = $0.012 | $12 |
| Claude Haiku 4.5 | $0.006 | $6 |
| GPT-6 Luna | $0.0006 | $0.60 |
| Gemini 3.5 Flash-Lite | $0.0022 | $2.20 |
| Mistral Large 3 on Bedrock | $0.0026 | $2.60 |

List prices mislead in two ways, so compare **cost per task** measured on your own traffic:

- **Token counts differ per tokenizer.** The same text is more tokens on one model than another; Claude Opus 4.7 and later produce about 30% more tokens than earlier Claude models for the same text.
- **Reasoning tokens are billed as output.** A reasoning model can spend far more output tokens thinking than it spends on the answer, so a cheap-looking model can cost more per task.

**Open-weight families, as of 2026-10.** Their weights download from Hugging Face; you pay for the GPUs that run them, or for a host such as Bedrock.

| Family | Latest models | License | Gated on Hugging Face |
|---|---|---|---|
| Llama (Meta) | Llama 4 Scout (109B total, 17B active, mixture-of-experts), Llama 4 Maverick (17B active, 128 experts) | Llama 4 Community License | yes: accept the license first |
| Qwen (Alibaba) | Qwen3.8-27B (dense), Qwen3.8-2.4T-A95B (mixture-of-experts) | Apache 2.0 for 27B; a custom license for the largest | no |
| Mistral | Mistral Small 4 (119B total, 6.5B active), Ministral 3 (3B, 8B, 14B), Mistral Medium 3.5 (128B) | Apache 2.0; Medium 3.5 under a modified MIT license with an exception for large companies | no |

A **mixture-of-experts** model splits its feed-forward networks into many "experts" and sends each token through only a few of them; a **dense** model sends every token through all its parameters (G3.1 L3). "Active" parameters are the ones each token passes through. Speed follows the active count; memory follows the total, since all experts must be loaded.

**Compare models on one task.** Public scores rank models on someone else's task. The deciding test is your own:

1. **Build an eval set** — 50–200 real inputs with the correct output, labelled by someone who knows the domain. Keep it out of every prompt (G2.3).
2. **Fix everything but the model** — the same prompt, the same inputs, the same output limit.
3. **Measure quality, latency, and cost** — for each model: accuracy (or another G2.2 metric), median and 95th-percentile latency, and cost per request.
4. **Pick the cheapest model that clears the quality bar**, then look at its failures (G2.5) before trusting it.

Amazon Bedrock serves proprietary and open-weight models behind one API, Converse, so a comparison is one loop. This one classifies support tickets:

```python
import json
import statistics
from dataclasses import dataclass

import boto3

PRICE_PER_MILLION_TOKENS_USD = {
    "global.anthropic.claude-sonnet-5-5": (2.00, 10.00),
    "global.anthropic.claude-haiku-4-5-20251001-v1:0": (1.00, 5.00),
    "mistral.mistral-large-3-675b-instruct": (0.50, 1.50),
    "qwen.qwen3-32b-v1:0": (0.1545, 0.618),
}
SYSTEM_PROMPT = "Classify the support ticket. Reply with one word only: billing, bug, how-to, or other."

@dataclass
class ModelScore:
    model_id: str
    accuracy: float
    median_latency_ms: float
    p95_latency_ms: float
    cost_per_request_usd: float

def reply_text(response: dict) -> str:
    blocks = response["output"]["message"]["content"]
    return next(block["text"] for block in blocks if "text" in block).strip().lower()

def request_cost(model_id: str, usage: dict) -> float:
    input_price, output_price = PRICE_PER_MILLION_TOKENS_USD[model_id]
    return (usage["inputTokens"] * input_price + usage["outputTokens"] * output_price) / 1_000_000

def score_model(client, model_id: str, examples: list[dict]) -> ModelScore:
    correct, latencies, costs = 0, [], []
    for example in examples:
        response = client.converse(
            modelId=model_id,
            system=[{"text": SYSTEM_PROMPT}],
            messages=[{"role": "user", "content": [{"text": example["ticket"]}]}],
            inferenceConfig={"maxTokens": 1000},
        )
        correct += reply_text(response) == example["label"]
        latencies.append(response["metrics"]["latencyMs"])
        costs.append(request_cost(model_id, response["usage"]))
    return ModelScore(
        model_id=model_id,
        accuracy=correct / len(examples),
        median_latency_ms=statistics.median(latencies),
        p95_latency_ms=statistics.quantiles(latencies, n=20)[18],
        cost_per_request_usd=statistics.mean(costs),
    )

client = boto3.client("bedrock-runtime", region_name="us-east-1")
examples = [json.loads(line) for line in open("tickets_eval.jsonl")]
for model_id in PRICE_PER_MILLION_TOKENS_USD:
    print(score_model(client, model_id, examples))
```

- `tickets_eval.jsonl` holds one `{"ticket": "...", "label": "billing"}` per line.
- `reply_text` takes the first text block, skipping any reasoning block a thinking model returns; Claude Sonnet 5.5 on Bedrock has adaptive thinking on by default. `maxTokens` leaves room for those thinking tokens.
- `statistics.quantiles(latencies, n=20)` returns the 19 cut points at 5%, 10%, … 95%, so index 18 is the 95th percentile.
- The Claude prices are Anthropic's list prices; Bedrock bills Claude through AWS Marketplace, and Anthropic states that regional endpoints cost 10% more than the `global.` profiles used here. The Qwen3 32B price is the one the Bedrock pricing page listed (Sydney region) when checked. Llama 4 Maverick runs on the same API as `us.meta.llama4-maverick-17b-instruct-v1:0`; its price was not listed on the page when checked.
- GPT and Gemini models go through their own SDKs; keep the same eval set and scoring so the numbers stay comparable.

**Read a model card.** A **model card** is the document published with a model that states what it is, what it is for, and how it was tested. On Hugging Face it is the repository's `README.md`: YAML metadata (license, datasets, base model, pipeline tag (the task type, such as text-generation), languages, evaluation results) followed by text. What to check before choosing:

| Check | Why | Where |
|---|---|---|
| License and gating | commercial use, user caps, attribution | `license` metadata; the gated banner |
| Intended use and limitations | a model outside its intended use fails in untested ways | the card's text |
| Parameters (total and active) | GPU memory: about parameters × bytes per parameter, plus the KV cache, the stored keys and values of earlier tokens that generation reuses (G3.1 L3, G6.4) | the model details |
| Context length | whether your prompts fit | the model details or `config.json` (`max_position_embeddings`) |
| Knowledge cutoff | the newest facts the model can know | the model details |
| Evaluation results | which benchmarks, whose run, what settings | the `model-index` metadata or an eval table |
| Chat template and recommended settings | a wrong template or sampling setup degrades output | `tokenizer_config.json`; the usage section |

For example, the Qwen2.5-0.5B-Instruct card states 0.49B parameters, a 32,768-token context, and Apache 2.0. At 2 bytes per parameter in bf16, Qwen3.8-27B needs about 54 GB for its weights alone, so it does not fit a 48 GB GPU unquantized (quantizing stores each weight in fewer bits, such as 8 or 4, to cut memory). Cloud catalogs publish the same facts per model: the Bedrock model card lists context window, max output tokens, modalities, and model IDs.

**Use leaderboards with caution.** A **leaderboard** ranks models by scores on shared tests. Three are current, as of 2026-10:

- **Arena** (arena.ai, formerly LMArena; lmarena.ai redirects there) — a person enters a prompt, two anonymous models answer, and the person votes for the better answer; a rating model (Bradley-Terry, akin to chess Elo) turns the votes into a ranking. The text board had more than 8.6 million votes on 2026-09-30.
- **Artificial Analysis** — runs benchmarks itself and publishes an Intelligence Index, one score combined from several benchmarks, next to measured speed and price per model.
- **Hugging Face Open LLM Leaderboard** — retired in March 2025; it now shows historical results only.

Why a leaderboard does not decide for you:

- **Contamination** — benchmark questions leak into training data, so a score can measure memory instead of skill (G2.3 L3).
- **Preference is not correctness** — an Arena vote records which answer a person liked more, and a voter rarely checks the facts in either.
- **Settings differ** — providers report their own numbers with their own prompts, sampling, and reasoning effort.
- **Different task** — a top general score says little about your ticket classifier or your language.

Use leaderboards to shortlist three or four candidates, then decide with your own eval.

Sources: [Anthropic — Pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [Anthropic — Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) · [OpenAI — Pricing](https://developers.openai.com/api/docs/pricing) · [OpenAI — Models](https://developers.openai.com/api/docs/models) · [Google — Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Google — Gemini models](https://ai.google.dev/gemini-api/docs/models) · [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) · [Bedrock — Mistral Large 3](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-mistral-large-3.html), [Qwen3 32B](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-32b.html), [Llama 4 Maverick](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-meta-llama-4-maverick-17b-instruct.html), [Claude Haiku 4.5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html), [Claude Sonnet 5.5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html) model cards · [Bedrock — Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) · [Llama 4 Scout](https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct), [Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B), [Mistral Small 4](https://huggingface.co/mistralai/Mistral-Small-4-119B-2603), [Mistral Medium 3.5](https://huggingface.co/mistralai/Mistral-Medium-3.5-128B), [Ministral 3 8B](https://huggingface.co/mistralai/Ministral-3-8B-Reasoning-2512) model cards · [Hugging Face — Model cards](https://huggingface.co/docs/hub/model-cards) · [Arena text leaderboard](https://arena.ai/leaderboard/text) · [Wikipedia — Arena (AI platform)](https://en.wikipedia.org/wiki/Arena_%28AI_platform%29) · [Artificial Analysis](https://artificialanalysis.ai/) · [Open LLM Leaderboard retirement](https://huggingface.co/spaces/open-llm-leaderboard/open_llm_leaderboard/discussions/1135)
