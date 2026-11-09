---
title: SFT and preference tuning
---

A chat model is built in stages; each trains the same weights further, on a different kind of data:

- **Pretraining** — training a model from random weights on a huge amount of raw text to predict the next token (G3.1). The result is a **base model**: it has learned language and much of the world's knowledge, but its objective is to continue text, which differs from following instructions. Asked a question, it may continue with more questions, as a quiz page would (an unsourced illustration).
- **Supervised fine-tuning (SFT)** — training on examples of a prompt paired with the ideal response, still by predicting the next token, so the model learns to produce the response when it sees the prompt. When the examples are instructions across many tasks, SFT is called **instruction tuning**, and the result is an **instruct** (or chat) model.
- **Preference tuning** — training on comparisons: for one prompt, a better answer and a worse one. The model learns to make answers like the better one more likely. It teaches qualities that have no single right answer to copy, such as helpfulness, tone, and safety.

| Stage | Training data | Teaches |
|---|---|---|
| Pretraining | raw text, such as web pages and books | language and knowledge |
| SFT | prompt → ideal response | to follow instructions, in a format |
| Preference tuning | prompt → chosen and rejected responses | which of two good-looking answers people prefer |

Two ways to do preference tuning:

- **RLHF** (reinforcement learning from human feedback) — people rank several model answers; a separate **reward model** learns to score answers the way they ranked them; then reinforcement learning (learning by trial and reward, G2.1 L1; InstructGPT used the PPO algorithm, which keeps each update small) tunes the LLM to earn high scores, with a penalty for drifting far from where it started.
- **DPO** (direct preference optimization) — training directly on chosen / rejected pairs with one simple loss, skipping the reward model and the reinforcement learning. The model can score any answer by how likely it would be to write it. A frozen copy of the starting model, the **reference**, scores it too. The loss rewards the model for raising the chosen answer's likelihood more than the rejected one's, measured against the reference, and its push fades once the gap is wide, so the model learns the preference without drifting far from where it started (the loss itself: G4.3 L2). The walkthrough below runs RLHF and DPO side by side on the same pairs. Its paper matched or beat PPO-based RLHF on the tasks it tested, and it is much simpler to run.

The stages matter more than size: OpenAI's InstructGPT, a 1.3-billion-weight model after SFT and RLHF, gave answers people preferred to those of the 175-billion-weight GPT-3 base model. SFT also needs few examples when they are good: LIMA, a research model built on the 65-billion-weight LLaMA base model, reached strong results after SFT on 1,000 curated examples, which suggests most knowledge comes from pretraining and SFT mainly teaches format.

For an application team, the base of its own fine-tune is usually an instruct model (unsourced), with SFT on its task added on top. Microsoft's fine-tuning guide advises starting with SFT, and adding DPO once you have examples of preferred and rejected outputs.

Sources: [Ouyang et al., InstructGPT paper](https://arxiv.org/abs/2203.02155) · [Rafailov et al., DPO paper](https://arxiv.org/abs/2305.18290) · [Zhou et al., LIMA paper](https://arxiv.org/abs/2305.11206) · [Microsoft Foundry — Fine-tuning overview](https://learn.microsoft.com/en-us/azure/ai-foundry/concepts/fine-tuning-overview)
