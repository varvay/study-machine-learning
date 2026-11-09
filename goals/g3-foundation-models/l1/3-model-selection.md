---
title: Model selection
---

Choosing a model means choosing who runs it, how large it is, and what it costs in money and waiting time. The first split is who holds the weights.

- **Proprietary model** — a model whose trained weights stay with its maker, so it is used only through the maker's API or a cloud that serves it. Claude, GPT, and Gemini are proprietary. Claude, for example, is served by Anthropic's API and also by Amazon Bedrock, Google Cloud, and Microsoft Foundry.
- **Open-weight model** — a model whose trained weights are published for anyone to download, so it can run on your own servers or any cloud, and be fine-tuned: trained further on your own examples to fit a task (G4). Llama, Qwen, DeepSeek, Gemma, OpenAI's gpt-oss, and several Mistral models are open-weight. A license sets what you may do with the weights: gpt-oss uses the permissive Apache 2.0 license; other families have their own terms, so read the license before building on a model.

Open-weight does not force you to run the model yourself: Amazon Bedrock serves Llama, Mistral, Qwen, DeepSeek, Gemma, and gpt-oss as managed APIs, next to proprietary models such as Claude.

| | Proprietary | Open-weight, self-hosted |
|---|---|---|
| Access | the provider's API only | download the weights and run them anywhere |
| Your data | sent to the provider's API; a cloud's regional endpoint can keep it in one region | can stay on your own hardware, even with no internet |
| Cost | pay per token used | pay for GPUs, busy or idle |
| Operations | the provider runs, scales, and updates it | you run, scale, and update it |
| Customization | only what the provider offers | full control: fine-tune (G4), compress, change the serving setup |
| Top-end quality | the strongest models have usually been proprietary (unsourced; check current leaderboards, public rankings of models by benchmark score, G3.3 L2) | the gap depends on the task and changes with each release |

The second choice is size, which sets a four-way trade-off between quality, speed, cost, and hardware.

- **Parameters** — the numbers a model learns in training (G2.4). A model's size is its parameter count, usually in billions: an "8B" model has about 8 billion.
- **Larger models** usually know more and reason better, but every token needs more computation, so they answer more slowly, cost more per token, and need more GPU memory. gpt-oss-120b fits on one 80 GB GPU; gpt-oss-20b runs within 16 GB of memory, small enough for local use.
- **Latency** — how long the user waits: the time until the first token appears, plus the time to generate each token after it. It grows with model size, prompt length, and answer length.
- **Reasoning models** — models that generate hidden "thinking" tokens before they answer. Thinking improves hard multi-step tasks, and its tokens are billed as output and add latency. Claude exposes an `effort` setting that trades intelligence against latency and cost within one model.

Providers sell their families in size tiers. The current Claude line:

| Model | Relative latency | Price per 1M input / output tokens | Context window |
|---|---|---|---|
| Claude Haiku 4.5 | fastest | $1 / $5 | 200K |
| Claude Sonnet 5.5 | fast | $2 / $10 | 1M |
| Claude Opus 5.5 | moderate | $4 / $20 | 1M |
| Claude Fable 5.1 | slower | $10 / $50 | 1M |

Output tokens cost five times as much as input tokens here, so long answers, and long thinking, drive the bill.

**Picking one.** Settle the hard constraints first: data that may not leave your premises rules out every hosted API, and a strict latency target rules out the largest models. Then test candidates on examples of your own task, since public benchmarks give only a rough ranking. Anthropic describes two starting points:

- **Efficiency-first** — start with a fast, cheap model and upgrade only where it fails. Suited to prototypes, tight latency, high volume, and straightforward tasks.
- **Capability-first** — start with the strongest model to see what quality is reachable, then move parts of the work to cheaper models or lower effort. Suited to complex reasoning, and to tasks where accuracy outweighs cost.

Sources: [Anthropic — Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) · [Anthropic — Choosing a model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model) · [Anthropic — Context windows (thinking tokens)](https://platform.claude.com/docs/en/build-with-claude/context-windows) · [Anthropic — Prompting best practices (thinking)](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) · [Hugging Face LLM Course — open decoder models](https://huggingface.co/learn/llm-course/chapter1/6) · [Amazon Bedrock — Models at a glance](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html) · [OpenAI — gpt-oss README](https://github.com/openai/gpt-oss)
