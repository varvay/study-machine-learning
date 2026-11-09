---
title: Prompting vs RAG vs fine-tuning
---

L2's decision table maps the problem to a technique: changing knowledge to RAG; format, style, or a narrow task to fine-tuning; prompting first. At L3 the choice is defended to a client with numbers on five axes, and backed by an eval run on their data.

**Evidence first.** The defensible order is a ladder, each rung taken only when the eval shows the rung below falls short:

1. Build the eval set first (G4.5): a few hundred real inputs with expected outputs, sliced by the cases the client cares about.
2. Prompt the strongest model affordable, with instructions and a few examples. This is the **baseline**, and it fixes the quality bar and the cost to beat.
3. Add RAG when the failures are missing or stale facts, as error analysis (G2.5) will show.
4. Fine-tune when the failures are format, style, or a narrow skill the prompt cannot pin down, or when the baseline is good but too slow or too expensive.
5. Combine: a fine-tuned model can still read retrieved context; fine-tuning teaches it how to answer, RAG supplies what to answer with.

**The five axes.**

| Axis | Prompting | RAG | Fine-tuning |
|---|---|---|---|
| **Cost** | per token; long few-shot prompts are paid on every call | adds embedding, vector storage, and longer prompts | upfront data and training; then a shorter prompt, often on a smaller model |
| **Latency** | prompt length sets the time to the first token (the wait before the answer starts to appear; G6.8 L1) | adds a retrieval step and a longer prompt | a small model with a short prompt is the fastest option |
| **Data volume** | a handful of examples | a corpus, no labels | hundreds to thousands of labeled examples (G4.4) |
| **Maintenance** | edit a prompt | re-index changed documents | retrain and re-evaluate per data change and per base-model upgrade |
| **Eval evidence** | the baseline score | retrieval recall and answer faithfulness, whether the answer sticks to the retrieved text (G1.7, G3.2) | beats the baseline on the held-out set without regressions (G4.5) |

**Facts belong in RAG; the evidence says so.** Ovadia et al. compared the two for knowledge injection: RAG consistently outperformed unsupervised fine-tuning (continued next-token training on the raw documents), for facts the model had seen and for new ones. Gekhman et al. found that models learn fine-tuning examples with new facts more slowly than examples consistent with what they know, and once learned, those examples make the model more prone to hallucinate. A fine-tune also freezes facts at training time, while RAG updates when a document is re-indexed and can cite its source.

**The cost argument, worked.** A client classifies 1,000,000 support tickets a month. Prices below are illustrative, not quotes; redo the arithmetic with the client's real prices.

- **Prompted large model** — 2,500 input tokens per ticket (instructions plus 20 examples) and 50 output tokens, at $3 per million input and $15 per million output tokens: 2,500 × $3/1M + 50 × $15/1M = $0.00825 per ticket, **$8,250 a month**. The cost grows with volume.
- **Fine-tuned 8B model, self-hosted** — the examples are now in the weights, so the prompt shrinks to about 150 tokens. On one g6.xlarge (one 24 GB NVIDIA L4) at $0.805 an hour on demand, running all month costs 730 × $0.805 = **$588 a month**, whatever the volume, as long as one GPU keeps up. At an average of 0.4 tickets per second it should, but load-test before promising it (unsourced).
- **Break-even** — $588 / $0.00825 ≈ 71,000 tickets a month. Below that, the prompted model is cheaper; above it, the fine-tune wins, and by 14× at a million.
- **Hidden costs** move the break-even: labeling (2,000 examples at 2 minutes each is 67 hours of expert time), retraining when the base model or the ticket categories change, and running a GPU service. **Prompt caching** (G6.8), where the provider reuses a prompt prefix it has already processed and bills it at a discount, makes the repeated few-shot prefix cheaper and so raises the break-even.

**When a fine-tuned small model beats a prompted large one.** Evidence that it can: InstructGPT's 1.3B model's outputs were preferred to 175B GPT-3's, despite 100 times fewer parameters. LoRA Land, a study by Zhao et al., fine-tuned 310 models across 31 narrow tasks: the 4-bit LoRA models beat their base models by 34 points and GPT-4 by 10 points on average. The conditions under which it holds:

- **The task is narrow and stable** — classification, extraction into a fixed schema, routing, a house style. Broad reasoning and open-domain knowledge stay with the large model.
- **The labels exist** — a few thousand clean examples, or a strong model to generate them (G4.4).
- **The volume is high** — enough that per-token savings repay the fixed costs, as in the break-even above.
- **Latency or placement rules** — a latency budget a large model misses, or data that must stay on the client's own hardware.

Re-check the decision each time a new large model ships: the baseline moves, and the fine-tune must keep beating it.

**Defending the choice to a client.** Present it as a claim, the evidence, the risk, and the exit: *"Fine-tune an 8B model for ticket routing, because on 500 held-out tickets it matched the large model's accuracy (91% against 92%) at one fourteenth of the monthly cost at your volume. The risk is new ticket categories; we retrain monthly from corrected labels and fall back to the large model if accuracy drops below 88%."* (The figures in this example are invented to show the shape.)

**In an interview**

- *A client wants to fine-tune a model on their 10,000 policy documents so the chatbot knows them. What do you recommend?* RAG, not fine-tuning, for the knowledge: studies comparing the two found retrieval consistently better at injecting facts, and fine-tuning on new facts can raise hallucination. RAG also updates when a policy changes and can cite the clause it used, which a policy chatbot needs. I would fine-tune only if the eval showed a remaining problem of format or tone, and even then on examples of answers, not on the raw documents.
- *When would you pick a fine-tuned 8B model over a frontier model API?* (A frontier model is one of the most capable models of the day.) When the task is narrow and stable, labeled data exists, and volume is high enough that per-token savings beat the fixed cost of training and hosting: a break-even I compute from real prices. Latency budgets and data-placement rules can also force it. I decide with an eval: the fine-tune must match the prompted baseline on held-out data before cost enters the argument.

Sources: [Ovadia et al., Fine-Tuning or Retrieval?](https://arxiv.org/abs/2312.05934) · [Gekhman et al., Does Fine-Tuning LLMs on New Knowledge Encourage Hallucinations?](https://arxiv.org/abs/2405.05904) · [Ouyang et al., InstructGPT paper](https://arxiv.org/abs/2203.02155) · [Zhao et al., LoRA Land](https://arxiv.org/abs/2405.00732) · [Vantage — g6.xlarge pricing and specs](https://instances.vantage.sh/aws/ec2/g6.xlarge)
