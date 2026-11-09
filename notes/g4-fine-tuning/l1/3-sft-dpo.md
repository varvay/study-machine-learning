---
updated: 2026-10-01T04:30:00.000Z
---

## three different questions, don't mix them

| question | answered by | decides |
|---|---|---|
| which weights change, how many? | full fine-tuning, PEFT (lora, adapters, prompt tuning) | the mechanics of the update |
| what is the model taught? | pretraining, SFT, preference tuning | the data + the loss = which way is "better" while training |
| did it actually get better? | evaluation (G4.5) | a check after training, on data it never saw |

- they combine freely: SFT with lora, DPO with lora, SFT with full fine-tuning. every run gets judged by the same evaluation.
- in short: peft/lora = which weights move. pretraining/SFT/preference = what to teach (the direction). evaluation = did it work.

## the stages set the direction

- pretraining: "better" = predict the next token of raw text. gives language + knowledge.
- SFT: "better" = match the example answers. gives instruction following + format.
- preference tuning (RLHF, DPO): "better" = make the preferred answer of a pair more likely than the rejected one. gives quality + tone.
- but that's "better" DURING training only. training loss can drop while the model gets worse in use:
  - overfitting: memorizes the training examples, fails on new ones
  - catastrophic forgetting: better at my task, worse at everything else
- so i still need evaluation: held-out test set, compare against the base model (baseline), regression checks on general ability, llm-as-judge when there's no single right answer.

## which stage for which goal

- model weak at code, missing OOP patterns → pretraining is the right category, but as **continued pretraining**: keep pretraining an existing model on a big pile of raw code (no labels). never from scratch (millions). it doesn't add tokenizer vocab (the token list stays fixed), it adds knowledge of how tokens combine into patterns.
  - cheaper first try if it's MY team's patterns: SFT on prompt → code pairs written that way, or RAG over examples from our codebase (G4.1). continued pretraining only pays off with a huge unlabeled corpus + a broad knowledge gap.
- chatbot answering questions / complaints → SFT, for HOW it answers: handling a complaint, format, when to escalate, tone.
  - facts that change (policies, order details) don't belong in the weights → RAG. retraining on every change is too expensive.
- answers are correct but too long / a bit cold → preference tuning (DPO). collect pairs: preferred vs rejected (thumbs up / down works). good for tone, helpfulness, conciseness, safety: easy to judge, hard to write one perfect example for.

| goal | stage | data |
|---|---|---|
| broad domain knowledge (lots of code) | continued pretraining | big raw corpus, no labels |
| a behaviour / format (answering complaints) | SFT | input → ideal output pairs |
| better quality among acceptable answers | preference tuning (DPO) | chosen vs rejected pairs |
| facts that change | not training → RAG | documents |
