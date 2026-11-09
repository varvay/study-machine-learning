---
title: Prompting vs RAG vs fine-tuning
---

Recap (G4.1 L1): prompting changes the instructions, RAG adds knowledge at query time, and fine-tuning changes the weights. In practice, the choice comes from a decision table, and evidence from an eval set (real inputs with their expected outputs, used to score each option) feeds that table.

**The decision table** maps the kind of failure to the technique that fixes it:

| The model's failure | Kind of gap | Use | Why |
|---|---|---|---|
| It doesn't know your private or recent facts: policies, product docs, this week's prices | knowledge | RAG | Facts sit in a store you update any time, and the answer can cite the chunk (the document passage RAG retrieved; G1.7) it used. Fine-tuning teaches new facts slowly and makes the model hallucinate (state false facts with confidence; G3.2 L1) more (Gekhman et al.). |
| It knows the facts but uses the wrong format, tone, length, or domain wording, even with clear instructions and examples | behavior | fine-tune (SFT, G4.3) | Hundreds of worked examples set a behavior more reliably than instructions do. |
| It does a narrow, repetitive task (classify, extract fields) well only with a large model or a long few-shot prompt (one carrying many worked examples; G3.5 L1) | cost and latency | fine-tune a small model | The small model learns the one task, the long prompt goes away, and each call gets cheaper and faster. |
| Its answers are correct, but people prefer other ones: shorter, more direct, safer | preference | preference tuning (DPO, G4.3) | It learns from pairs of a chosen and a rejected answer. |
| It must act in several steps: look something up, call an API, then decide | workflow | an agent: an LLM that calls tools in a loop until the task is done (G5.1 L1) | The gap is in control flow: choosing the next step and running it. |

The rules behind the table:

1. **Always start with prompting.** A prompt costs hours to change, where a fine-tune takes days. The prompted result is also the **baseline** that every other option must beat.
2. **Changing knowledge → RAG.** AWS's guidance: "For most knowledge-injection use cases, RAG is a better starting point than fine-tuning." The docs of Nova, Amazon's own model family, say the same of SFT directly: it "teaches the model new *behaviors*, response formats, and reasoning patterns. It does not teach the model new factual knowledge."
3. **Format, style, or a narrow task → fine-tune.** AWS lists "a specific style, format, or niche terminology" and "a very narrow, repetitive task" as the cases where fine-tuning pays off.
4. **RAG and fine-tuning combine.** RAG supplies the facts at query time. Fine-tuning teaches the model how to use them, such as answering only from the retrieved chunks and citing them in a fixed format.

**The procedure** turns the table into a decision backed by numbers:

1. **Build an eval set**: real inputs, each with its expected output or a grading rule (G4.5). Without one, no option can be shown to beat another.
2. **Score a prompt baseline** on it: the strongest model you can use, a clear system prompt, a few examples (few-shot), and structured output, a reply in JSON that follows a given schema (G3.5).
3. **If it meets the bar, ship it.** The bar is the accuracy, cost, and latency the use case needs, agreed before you measure.
4. **Otherwise, run error analysis** (G2.5): tag each failure by its cause, then count the tags.
5. **Fix the largest group with the table**, then score again on the same eval set.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 380" role="img" aria-labelledby="decision-flow-title">
<title id="decision-flow-title">Decision flow: score a prompt baseline; ship if it meets the bar; otherwise tag the failures and add RAG, fine-tuning, or both</title>
<rect class="fold-test" x="40" y="20" width="220" height="64" rx="8" />
<text class="table-name" x="150" y="46" text-anchor="middle">Prompt baseline</text>
<text class="note" x="150" y="66" text-anchor="middle">scored on the eval set</text>
<path class="key-link" d="M260,52 L500,52" />
<text class="key-tag" x="380" y="44" text-anchor="middle">meets the bar</text>
<rect class="fold-train" x="500" y="20" width="220" height="64" rx="8" />
<text class="table-name" x="610" y="46" text-anchor="middle">Ship the prompt</text>
<text class="note" x="610" y="66" text-anchor="middle">no training needed</text>
<path class="key-link" d="M150,84 L150,140" />
<text class="key-tag" x="160" y="116">misses</text>
<rect class="fold-train" x="40" y="140" width="220" height="64" rx="8" />
<text class="table-name" x="150" y="166" text-anchor="middle">Error analysis (G2.5)</text>
<text class="note" x="150" y="186" text-anchor="middle">tag each failure by cause</text>
<path class="key-link" d="M150,204 L150,270" />
<path class="key-link" d="M150,204 C150,240 380,236 380,270" />
<path class="key-link" d="M150,204 C150,240 610,236 610,270" />
<rect class="fold-train" x="40" y="270" width="220" height="64" rx="8" />
<text class="table-name" x="150" y="296" text-anchor="middle">Add RAG</text>
<text class="note" x="150" y="316" text-anchor="middle">missing or stale facts</text>
<rect class="fold-train" x="270" y="270" width="220" height="64" rx="8" />
<text class="table-name" x="380" y="296" text-anchor="middle">Fine-tune</text>
<text class="note" x="380" y="316" text-anchor="middle">format, style, narrow task</text>
<rect class="fold-train" x="500" y="270" width="220" height="64" rx="8" />
<text class="table-name" x="610" y="296" text-anchor="middle">RAG + fine-tune</text>
<text class="note" x="610" y="316" text-anchor="middle">both kinds of failure</text>
<text class="note" x="380" y="366" text-anchor="middle">every change is re-scored on the same eval set</text>
</svg>
</div>
<figcaption>The decision flow. Every branch ends back at the eval set, so each choice is kept only if its score beats the baseline.</figcaption>
</figure>

**A worked example: the capstone assistant** over my study notes. The numbers are illustrative.

- *"What do my notes say about HNSW's `ef_search`?"* (`ef_search` is a search-breadth setting of the HNSW vector index; G1.7 L2.) The model has never seen the notes, so every answer is a guess. That is a knowledge gap, so the fix is RAG over the notes (G1.7).
- *Routing each question to `{"goal": "G1", "type": "compare"}` as JSON.* A large model with 20 examples in the prompt gets 94% right, but costs more per call than the answer itself. A 4B (4-billion-weight) model with the same prompt gets 71% right and breaks the JSON 8% of the time. That is a behavior gap on a narrow task, so the fix is to fine-tune the 4B model (G4.6), then check it against the 94% baseline (G4.5).

**When fine-tuning is the wrong choice:**

- The facts change weekly. Every change would need a new training run.
- You have fewer than a few dozen good examples. Vendor minimums start near there: OpenAI requires 10 and suggests about 50, and Amazon Nova recommends at least 100 per task (G4.4).
- You can't write down what a correct output is. Then there is no eval set, and nothing to show the fine-tune helped.

Sources: [AWS Prescriptive Guidance — Choosing an AI approach](https://docs.aws.amazon.com/prescriptive-guidance/latest/gen-ai-lifecycle-operational-excellence/dev-architecting.html) · [Amazon Nova — Preparing data for fine-tuning](https://docs.aws.amazon.com/nova/latest/userguide/fine-tune-prepare-data-understanding.html) · [Gekhman et al., Does Fine-Tuning LLMs on New Knowledge Encourage Hallucinations?](https://arxiv.org/abs/2405.05904) · [OpenAI — Supervised fine-tuning](https://developers.openai.com/api/docs/guides/supervised-fine-tuning)
