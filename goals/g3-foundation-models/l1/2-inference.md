---
title: Inference and hallucination
---

**Inference** is running a trained model to get an output, as opposed to training it. An LLM generates its answer one token at a time, in a loop:

1. Run the prompt, plus everything generated so far, through the model.
2. Get a probability for every token in the vocabulary to come next.
3. Choose one token: the **decoding** step.
4. Append it to the text, and repeat until the model emits an end token (a special vocabulary token that means "answer finished") or hits a limit.

Each output token costs one more pass through the model, so a long answer takes proportionally longer to generate.

The simplest choice in step 3 is **greedy decoding**: always take the most likely token. It gives the same output every time, but tends toward bland, repetitive text. **Sampling** instead draws the token at random, weighted by the probabilities, and three settings shape the draw:

- **Temperature** — a number that sharpens or flattens the probabilities before the draw. Its range depends on the API; Claude's takes 0 to 1. Below 1, likely tokens gain and unlikely ones lose, so the output is more predictable; at 0 the top token always wins, which is greedy decoding. Above 1, the probabilities even out and rarer tokens get picked more often: more variety, and more mistakes. Low values suit extraction, classification, and code; higher values suit brainstorming and creative writing. Even at 0 the output is not fully deterministic on Claude's API.
- **Top-p** (nucleus sampling) — keeps only the most likely tokens whose probabilities add up to at least p, and draws among those. If the candidates are "horses" 0.7, "zebras" 0.2, and "unicorns" 0.1, top-p 0.7 keeps only "horses", and top-p 0.9 keeps "horses" and "zebras". Temperature reshapes every probability; top-p cuts off the unlikely tail. Tune one of the two, not both: their combined effect is hard to predict.
- **Top-k** — keeps only the k most likely tokens, such as the top 50, and draws among those.

The walkthrough below applies temperature, then top-p, to one next-token choice.

Which of these a model accepts depends on the model. Claude Opus 4.7 and later models reject any non-default `temperature`, `top_p`, or `top_k` with an error, and Anthropic recommends steering through the prompt instead. Azure OpenAI's GPT-5-series reasoning models (models that generate step-by-step thinking tokens before the answer) do not support `temperature` or `top_p` either. Open-weight models (models whose trained weights anyone can download) that you serve yourself (G3.3), and many other API models, accept all three.

- **Max tokens** — the upper limit on how many tokens the model may generate in one response. It caps the cost and the latency of a response. The model often stops earlier, when its answer is done; a response that hits the limit is cut off mid-sentence, and Claude's API reports `stop_reason: "max_tokens"`. To get a short answer, ask for one in the prompt; the limit only truncates.
- **Context window** — the maximum number of tokens the model can take into account in one request: the system prompt (the application's standing instructions, G3.5), the whole conversation so far, any documents and tool definitions (descriptions of functions the model may ask to call, G5.4), and the response being generated. Claude Opus 5.5 has 1M tokens and Claude Haiku 4.5 has 200K; GPT-5 on Azure has 400K.

Three consequences follow:

- **The model remembers nothing between requests.** A chat app resends the whole conversation on every turn, so a long chat slowly fills the window. Longer-term memory is the application's job (G5.2).
- **An input over the limit is rejected**, with a "prompt is too long" error on Claude's API. The application must drop old turns, summarize them, or include only the relevant parts of its documents, which is what RAG does: retrieval-augmented generation fetches the passages relevant to the question and adds only those to the prompt (G1.7).
- **A larger context is not automatically better.** As the token count grows, the model's accuracy and recall over the context degrade, which Anthropic calls context rot, and every input token is billed.

**Hallucination** — output that is fluent and confident but false, or unsupported by the sources the model was given: an invented citation, a wrong date, an API method that does not exist. It comes in two kinds:

- **Factuality hallucination** — the output contradicts real-world facts, such as a wrong year for a product launch.
- **Faithfulness hallucination** — the output departs from the input: it ignores the instructions, contradicts the context supplied, or contradicts itself. A RAG answer that states what no retrieved document says is one.

Why it happens, in a nutshell: the model is trained to produce likely text, not true text. When it lacks a fact, a plausible guess is still likely text, and both training and benchmarks (the standard tests models are scored on) reward a confident guess over "I don't know". Nothing in the output marks a guess, so a hallucination reads exactly like a correct answer. The deeper causes are in G3.2 L3; grounding answers in retrieved documents with citations, the main remedy, is in G3.2 L2.

Sources: [Holtzman et al., nucleus sampling](https://arxiv.org/abs/1904.09751) · [Amazon Bedrock — Inference parameters](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-parameters.html) · [Anthropic — Messages API](https://platform.claude.com/docs/en/api/messages) · [Anthropic — API parameter deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations) · [Azure AI Inference SDK — Temperature (temperature with top-p)](https://learn.microsoft.com/en-us/dotnet/api/azure.ai.inference.chatcompletionsoptions.temperature?view=azure-dotnet-preview) · [Azure OpenAI — Reasoning models](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning) · [Anthropic — Stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons) · [Anthropic — Context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows) · [Anthropic — Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) · [Huang et al., hallucination survey](https://arxiv.org/abs/2311.05232) · [Kalai et al., Why language models hallucinate](https://arxiv.org/abs/2509.04664)
