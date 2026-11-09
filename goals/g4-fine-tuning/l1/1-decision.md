---
title: Prompting vs RAG vs fine-tuning
---

An LLM's answer depends on two things: the **prompt** it reads, and the **weights** it computes with. Strictly, weights are one kind of parameter, next to biases (G2.4); with LLMs, "weights" loosely means all the parameters, every number set by training, as in "open-weight model" or "download the weights". That loose sense is the one used here. There are three ways to change what a model does, and each changes a different part:

- **Prompting** — changing the instructions in the prompt: a system prompt, rules, a few worked examples (G3.5). The model stays the same; the next request reads the new text. Example: adding "Reply in two sentences and quote the policy" to a support bot's system prompt.
- **RAG** (retrieval-augmented generation) — adding knowledge to the prompt at query time. For each question, a search fetches the most relevant passages from your documents (G1.7), and the app pastes them into the prompt. The model stays the same and answers from text it has just been handed. Example: for "Can I return my headphones?", the search fetches the refund policy page.
- **Fine-tuning** — changing the model's weights by training it further on examples of the wanted behaviour. The result is a new model that does the task with less spelled out in the prompt. Example: training on 1,000 support tickets paired with ideal replies, so the model writes in the house style without being told.

How the three differ in use:

| | Prompting | RAG | Fine-tuning |
|---|---|---|---|
| What changes | instructions in the prompt | context in the prompt | the weights |
| A change takes effect | on the next request | once the edited document is re-indexed | after a new training run |
| What it needs | a well-written prompt | documents and a search index | example inputs with ideal outputs, and GPU time |
| Cost per request | grows with the prompt's length | adds a search and the retrieved text | the prompt can be shorter |

Fine-tuning moves instructions and examples out of the prompt and into the weights. Prompts get shorter, which saves tokens (the word pieces a model reads, and the unit an API bills by; G3.1 L1) and can lower latency; a smaller fine-tuned model can also match a larger general one on a narrow task. Knowledge trained into the weights, though, stays fixed until the next training run, and the model cannot say where it learned a fact. RAG keeps knowledge in documents: edit a document and the next answer uses it, with the source passage available to cite.

The three combine. A fine-tuned model still reads a prompt, so RAG can feed it fresh documents while fine-tuning sets its format and style. G4.1 L2 turns this into a decision table.

The walkthrough below sends one question through each setup and marks what changes: the prompt, or the weights.

Sources: [OpenAI — Model optimization: benefits of fine-tuning](https://developers.openai.com/api/docs/guides/model-optimization) · [Lewis et al., RAG paper](https://arxiv.org/abs/2005.11401)
