---
title: Inference, hallucination, and serving
---

L2 reduced hallucination with grounding and tuned the sampling parameters. At L3 the questions are why hallucinations happen at all, how to catch them automatically, and how a serving engine runs many requests on one GPU.

**Why hallucinations happen.** A **hallucination** is fluent output that is false, or unsupported by the source the model was given. Three causes stack:

- **The objective.** Pretraining (the first and largest training stage, next-token prediction on raw text; a model after only this stage is a **base model**) rewards the most probable next token, not the true one. Where the training text is dense and consistent, probable and true coincide; elsewhere the model still produces a fluent guess. Kalai et al. make this precise: generating only valid statements is at least as hard as classifying statements as valid or not, so errors follow from ordinary statistics. Facts seen once in training are the weak spot: *"if 20% of birthday facts appear exactly once in the pretraining data, then one expects base models to hallucinate on at least 20% of birthday facts."*
- **The incentives.** Post-training (the later stages that tune a base model into an assistant, G4.3) and benchmarks mostly grade answers right or wrong. "I don't know" scores the same as a wrong answer, so a model tuned to score well learns to guess: under binary grading, abstaining is strictly worse than a best guess (Kalai et al.).
- **Gaps in the data.** Events after the training cutoff, private company facts, rare entities, and sources that contradict each other leave nothing reliable to predict from.
- **Decoding.** Sampling sometimes picks a lower-probability token, and every later token is conditioned on it. Top-p cuts the unreliable tail of the distribution for this reason (Holtzman et al.). Once a model has committed to a wrong claim, it tends to justify it with more wrong claims, even ones it can recognize as false when asked separately: ChatGPT and GPT-4 identified 67% and 87% of their own mistakes (Zhang et al., "hallucination snowballing").

In RAG, the failure has two forms: the answer contradicts the retrieved text (**intrinsic** hallucination), or adds claims the text cannot confirm (**extrinsic**), in the terms of Ji et al.'s survey. Retrieval failures (G2.5) look the same to the user, so error analysis must tell them apart.

**Detecting hallucinations.** Three checks, each catching a different failure:

| Check | How it works | Needs | Catches | Cost |
|---|---|---|---|---|
| **Faithfulness** (groundedness) | Split the answer into claims; check each claim against the retrieved context with an LLM or an entailment model (a classifier that tells whether one text follows from another). Score = supported claims / total claims (the definition in Ragas, an open-source RAG evaluation library). | the context the answer used | claims the sources do not support | one judge call per answer |
| **Self-consistency** | Sample the same question several times at temperature > 0 and compare. Agreement means the model knows; disagreement means it is guessing (SelfCheckGPT). | nothing external | confident-sounding guesses with no source to check against | k extra generations |
| **LLM-as-judge** | A second model grades the answer against a rubric or a reference answer. | a rubric, ideally reference answers | wrong, incomplete, or off-topic answers | one judge call per answer |

- **Faithfulness is not correctness.** An answer faithful to a stale document is still wrong; pair it with retrieval checks.
- **Self-consistency multiplies cost** by the number of samples, so run it offline or on high-stakes routes only. Majority voting over samples also improves accuracy on reasoning tasks (Wang et al.).
- **Judges have biases**: they favour the first-listed answer (position bias), longer answers (verbosity bias), and their own model's outputs (self-enhancement bias). Strong judges still agreed with human preferences over 80% of the time, the same level as humans with each other (Zheng et al.). Mitigate by swapping answer order, giving reference answers, using a different model family as judge, and checking the judge's scores against a set of human labels before trusting it.
- **On AWS**, Bedrock Guardrails, Bedrock's configurable filters on model input and output, has a **contextual grounding check**: given a grounding source, a query, and the model's response, it scores **grounding** (is every claim supported by the source?) and **relevance** (does it answer the query?), and blocks responses below thresholds you set between 0 and 0.99. Limits: 100,000 characters of source, 1,000 of query, 5,000 of response. It supports summarization, paraphrasing, and question answering, not conversational chatbots.

**Lost in the middle.** Liu et al. placed the one document holding the answer at different positions among many retrieved documents. Accuracy was highest when it came first or last and dropped markedly when it sat in the middle, even for models built for long context. The drop traces a U-shaped curve over position. Consequences for RAG:

- Retrieve fewer, better chunks: rerank (re-score the retrieved chunks against the question with a slower, more accurate model), then pass the top few (5–10 is a common starting point; unsourced), not 50.
- Put the strongest evidence at the start or the end of the context, and the question at the end. Anthropic's guide reports that a query placed after long documents improved response quality by up to 30% in its tests.
- A larger context window is not proof of better use of it. The paper tested 2023 models; measure your own model by moving a known answer through the context of your real prompts.

**Serving engines.** A **serving engine** is the server that loads model weights onto GPUs and schedules requests on them: it batches requests, manages KV-cache memory (G3.1), streams tokens, and exposes an HTTP API. **vLLM** is the common open-source choice; Hugging Face's TGI (Text Generation Inference) is in maintenance mode, and its README points to vLLM and SGLang, another open-source engine. On AWS, SageMaker, the AWS service for hosting your own models, offers a Large Model Inference (LMI) container that runs vLLM or TensorRT-LLM, NVIDIA's inference library; Bedrock runs its own engines out of sight.

Three techniques give vLLM its throughput:

- **Continuous batching** (iteration-level scheduling) — the scheduler rebuilds the batch at every decode iteration: a finished sequence leaves at once, and a waiting request joins in its place. **Static batching** (request-level scheduling) keeps a batch fixed until its longest request finishes, so slots of finished requests sit idle and new requests queue behind them. Orca, a 2022 research serving system, introduced iteration-level scheduling and reported 36.9× the throughput of FasterTransformer, NVIDIA's earlier inference library, at the same latency. The walkthrough below runs both schedulers on the same requests.
- **PagedAttention** — the KV cache is stored in fixed-size blocks, and a per-request block table maps token positions to blocks, the way an operating system maps virtual memory pages. A request takes blocks as it grows, instead of reserving memory for its maximum length up front. Waste falls to near zero, so more sequences fit in the batch, and requests can share blocks of a common prefix (**prefix caching**, G3.5). vLLM reported 2–4× the throughput of FasterTransformer and Orca.
- **Chunked prefill** — a long prompt's prefill is split into chunks, each batched together with other requests' decode steps, so one 50K-token prompt does not freeze every other user's token stream. It is on by default in vLLM V1. `max_num_batched_tokens` sets the chunk budget per iteration: smaller values improve inter-token latency, larger ones improve time to first token.

When the KV cache fills, vLLM **preempts** requests (evicts their cache and recomputes it later), and latency spikes. The knobs:

```bash
vllm serve meta-llama/Llama-3.1-8B-Instruct \
  --max-model-len 16384 \
  --gpu-memory-utilization 0.90 \
  --max-num-seqs 128 \
  --max-num-batched-tokens 8192 \
  --kv-cache-dtype fp8
```

- `--max-model-len` caps context per request, which caps its cache.
- `--gpu-memory-utilization` is the fraction of GPU memory vLLM may use; what the weights leave becomes KV cache.
- `--max-num-seqs` caps concurrent sequences per iteration; lowering it reduces preemption.
- `--max-num-batched-tokens` caps tokens processed per iteration; vLLM recommends above 8192 for throughput.

Serving is measured by **TTFT** (prefill plus queueing), **inter-token latency** (decode), throughput in tokens per second across all users, and the share of requests meeting both latency targets. Throughput and latency trade against each other through batch size: a fuller batch raises throughput and slows every sequence in it.

**In an interview**

- *Your RAG bot retrieves the right document but still answers wrongly. Why, and how do you catch it?* The model can ignore or override the context: its pretrained knowledge conflicts with the document, the key passage sits in the middle of a long context, or it snowballs from an early wrong token. Catch it with a faithfulness check that verifies each claim against the retrieved chunks, in offline evals and on sampled production traffic. Fix it with fewer, reranked chunks placed at the edges, answer-only-from-context instructions with citations, and a grounding guardrail on the output.
- *How does vLLM serve more users per GPU than a naive server?* Decode is memory-bound, so throughput comes from big batches, and batch size is limited by KV-cache memory. PagedAttention allocates the cache in small blocks on demand, so almost no memory is wasted and more sequences fit. Continuous batching refills a slot the moment a sequence finishes, so the GPU never waits for the longest request in a batch.

Sources: [Kalai et al., Why Language Models Hallucinate](https://arxiv.org/abs/2509.04664) · [Holtzman et al., The Curious Case of Neural Text Degeneration](https://arxiv.org/abs/1904.09751) · [Zhang et al., How Language Model Hallucinations Can Snowball](https://arxiv.org/abs/2305.13534) · [Ji et al., Survey of Hallucination in NLG](https://arxiv.org/abs/2202.03629) · [Ragas, Faithfulness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/) · [Manakul et al., SelfCheckGPT](https://arxiv.org/abs/2303.08896) · [Wang et al., Self-Consistency](https://arxiv.org/abs/2203.11171) · [Zheng et al., Judging LLM-as-a-Judge](https://arxiv.org/abs/2306.05685) · [Bedrock Guardrails contextual grounding check](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-contextual-grounding-check.html) · [Liu et al., Lost in the Middle](https://arxiv.org/abs/2307.03172) · [Anthropic, prompting best practices (long context)](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) · [TGI README (maintenance mode)](https://github.com/huggingface/text-generation-inference) · [SageMaker LMI container docs](https://docs.djl.ai/master/docs/serving/serving/docs/lmi/index.html) · [Yu et al., Orca (OSDI '22)](https://www.usenix.org/conference/osdi22/presentation/yu) · [Kwon et al., PagedAttention / vLLM](https://arxiv.org/abs/2309.06180) · [vLLM optimization and tuning](https://docs.vllm.ai/en/latest/configuration/optimization/) · [vLLM engine arguments](https://docs.vllm.ai/en/latest/configuration/engine_args/)
