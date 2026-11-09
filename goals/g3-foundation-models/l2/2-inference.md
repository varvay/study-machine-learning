---
title: Inference and hallucination
---

Recap (G3.2 L1): the model outputs a probability for every next token, and temperature, top-p, and max tokens shape how one is chosen and how many follow. This section gives the formulas, the settings each API accepts as of 2026-10, and the code that grounds answers in sources.

**Temperature sampling.** The model's last layer outputs one **logit** zᵢ per vocabulary token: an unbounded score, higher meaning more likely. Temperature T rescales the logits before softmax turns them into probabilities:

pᵢ = exp(zᵢ / T) / Σⱼ exp(zⱼ / T)

- **zᵢ** — the logit of token i.
- **T** — the temperature, a positive number.
- **Σⱼ** — the sum over every token j in the vocabulary, so the probabilities add up to 1.
- **T = 1** leaves the model's own distribution unchanged. **T < 1** stretches the gaps between logits, so the top token gains. **T > 1** shrinks the gaps, so the distribution flattens. As T approaches 0, all the probability goes to the top token: **greedy decoding**.

Worked example: logits 5, 3, 2.5, 2, 0.5 for the next token after "The capital of France is" (illustrative numbers).

| T | "Paris" (z = 5) | "a" (3) | "the" (2.5) | "located" (2) | "Lyon" (0.5) |
|---|---|---|---|---|---|
| 0.5 | 0.973 | 0.018 | 0.007 | 0.002 | <0.001 |
| 1 | 0.782 | 0.106 | 0.064 | 0.039 | 0.009 |
| 2 | 0.504 | 0.186 | 0.144 | 0.113 | 0.053 |

At T = 2, a sampled answer says something other than "Paris" about half the time.

- **Top-p (nucleus sampling)** — sort tokens by probability, keep the smallest set whose probabilities sum to at least p, rescale that set to sum to 1, and sample from it. At T = 1 with p = 0.9, the running total is 0.782, 0.888, 0.952, so "Paris", "a", and "the" stay, rescaled to 0.821, 0.111, 0.067.
- **Top-k** — keep only the k most likely tokens, then rescale and sample.
- **Max tokens** — a hard cap on generated tokens. The request must also fit the context window: input tokens + max tokens ≤ context window.

The same steps in code, applied in that order (temperature, then top-p):

```python
import numpy as np

def sample_next_token(logits: np.ndarray, temperature: float, top_p: float, rng: np.random.Generator) -> int:
    if temperature == 0:
        return int(np.argmax(logits))
    scaled = logits / temperature
    probabilities = np.exp(scaled - scaled.max())
    probabilities /= probabilities.sum()
    order = np.argsort(probabilities)[::-1]
    cumulative = np.cumsum(probabilities[order])
    nucleus = order[: np.searchsorted(cumulative, top_p) + 1]
    nucleus_probabilities = probabilities[nucleus] / probabilities[nucleus].sum()
    return int(rng.choice(nucleus, p=nucleus_probabilities))

logits = np.array([5, 3, 2.5, 2, 0.5])
print(sample_next_token(logits, temperature=1.0, top_p=0.9, rng=np.random.default_rng(7)))
```

`rng` is a random number generator; seeding it (7) makes the draw repeat on every run.

With Hugging Face `transformers`, the same knobs are arguments of `generate`; `do_sample=True` turns sampling on, and without it `generate` decodes greedily:

```python
outputs = model.generate(**inputs, do_sample=True, temperature=0.7, top_p=0.9, top_k=50, max_new_tokens=200)
```

**What each API accepts, as of 2026-10.** The newest hosted models removed most sampling knobs, so check before tuning:

| Model / API | temperature, top-p, top-k | max tokens |
|---|---|---|
| Claude Opus 4.7 and later, the whole Claude 5 family | not settable: any temperature other than 1.0, any top_p below 0.99, or any top_k returns a 400 error | `max_tokens`, required |
| Claude Haiku 4.5, Opus/Sonnet 4.6 and earlier | temperature 0.0–1.0 (default 1.0), top_p, top_k | `max_tokens`, required |
| OpenAI GPT-6 family (reasoning models) | remove temperature and top_p unless reasoning effort (how much the model thinks before answering) is `none`; GPT-6 Astra and GPT-6.1 Sol do not support `none` | `max_output_tokens` |
| Google Gemini 3.x | settable, but Google strongly recommends keeping the defaults (temperature 1.0); lower values can cause looping (the model repeating itself) | `maxOutputTokens` |
| Amazon Bedrock Converse (Bedrock's one chat API for all its models) | `inferenceConfig`: `temperature`, `topP` (each model decides whether it accepts them) | `maxTokens` |
| Open-weight models you serve (transformers, or vLLM, an open-source serving engine, G3.2 L3) | all settable | `max_new_tokens` / `max_tokens` |

Where sampling is fixed, control the output through the prompt, structured output (G3.5), and reasoning effort instead. Even at temperature 0, Anthropic states that results are not fully deterministic.

**Tune per task.** Anthropic's guidance: temperature near 0 for analytical and multiple-choice tasks, near 1 for creative tasks.

| Task | Temperature (where settable) | Max tokens |
|---|---|---|
| Classification, extraction, text-to-SQL | 0 or near 0: one right answer, repeatable | small: the label or the JSON object |
| RAG question answering | low | sized to the expected answer, e.g. 500 |
| Brainstorming, marketing copy | near 1 | as long as the piece |
| Several diverse candidates to vote on or rerank | near 1, with n samples | per candidate |

**Detect a truncated answer.** A response that hits the cap stops mid-sentence and reports why: `stop_reason: "max_tokens"` on Claude's Messages API, `stopReason: "max_tokens"` on Bedrock Converse, and `status: "incomplete"` with reason `max_output_tokens` on OpenAI's Responses API, where the cap also counts the hidden reasoning tokens. Check it before parsing: truncated JSON does not parse.

**Reduce hallucination.** A **grounded** answer uses only the sources supplied in the prompt, typically retrieved by RAG (G1.7). Three prompt rules do most of the work, all from Anthropic's hallucination guide:

- **Answer only from the context** — tell the model to use the supplied documents and not its general knowledge.
- **Allow "I don't know"** — give an exact phrase for a missing answer, so a guess is never the only way to comply.
- **Cite** — require a source ID on every claim, so each claim can be checked; for long documents, have the model extract exact quotes first and answer from them.

A grounded RAG call to Claude on Amazon Bedrock, with the citation check done in code:

```python
import re
import boto3

GROUNDED_SYSTEM_PROMPT = """You answer questions about the company handbook.
Use only the sources inside <sources>. Do not use general knowledge.
After every sentence, cite the supporting source ID in square brackets, e.g. [2].
If the sources do not contain the answer, reply exactly: I don't know."""

def format_sources(chunks: list[str]) -> str:
    numbered = "\n".join(f'<source id="{index}">{chunk}</source>' for index, chunk in enumerate(chunks, start=1))
    return f"<sources>\n{numbered}\n</sources>"

def cited_ids(answer: str) -> set[int]:
    return {int(match) for match in re.findall(r"\[(\d+)\]", answer)}

def answer_from_sources(question: str, chunks: list[str]) -> str:
    client = boto3.client("bedrock-runtime", region_name="us-east-1")
    response = client.converse(
        modelId="global.anthropic.claude-sonnet-5-5",
        system=[{"text": GROUNDED_SYSTEM_PROMPT}],
        messages=[{"role": "user", "content": [{"text": f"{format_sources(chunks)}\n\nQuestion: {question}"}]}],
        inferenceConfig={"maxTokens": 500},
    )
    if response["stopReason"] == "max_tokens":
        raise ValueError("answer was cut off; raise maxTokens")
    answer = response["output"]["message"]["content"][0]["text"]
    if answer.strip() == "I don't know":
        return answer
    unknown = cited_ids(answer) - set(range(1, len(chunks) + 1))
    if not cited_ids(answer) or unknown:
        raise ValueError(f"answer cites no source or an unknown source: {sorted(unknown)}")
    return answer
```

- `boto3` is the AWS SDK for Python, and its `bedrock-runtime` client calls models. The `global.` prefix on the model ID names a global inference profile: Bedrock picks a commercial AWS region anywhere in the world to process the request ([AWS — Cross-Region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html)).
- The sources sit inside XML-style tags, so the model can tell documents from instructions (G3.5).
- No `temperature` is passed: Claude Sonnet 5.5 rejects non-default values.
- The code check catches a missing or invented source ID. It does not prove the cited source supports the sentence; faithfulness checks and LLM-as-judge, a second model grading the answer against its sources, do that (G3.2 L3).
- Log answers that fail the check, or come back "I don't know", with their retrieved chunks: they show whether retrieval or the model failed (G2.5).

Sources: [Holtzman et al., nucleus sampling](https://arxiv.org/abs/1904.09751) · [Hugging Face — Generation strategies](https://huggingface.co/docs/transformers/main/en/generation_strategies) · [Anthropic — Messages API (temperature, top_p, top_k)](https://platform.claude.com/docs/en/api/messages) · [OpenAI — Using GPT-6](https://developers.openai.com/api/docs/guides/latest-model) · [OpenAI — Reasoning models (`max_output_tokens`)](https://developers.openai.com/api/docs/guides/reasoning) · [Google — Gemini prompting strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies) · [Google — generateContent (`maxOutputTokens`)](https://ai.google.dev/api/generate-content) · [Amazon Bedrock — Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) · [Amazon Bedrock — Claude Sonnet 5.5 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html) · [Anthropic — Reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)
