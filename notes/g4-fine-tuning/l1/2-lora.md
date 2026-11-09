---
updated: 2026-10-01T04:05:00.000Z
---

## prompt tuning, what i finally get

- the model never reads words. each token is looked up in the embedding table, one row of 4,096 numbers per vocab token, and layer 1 reads those vectors. a normal (hard) prompt = real tokens = existing rows of that table.
- a soft prompt = a few extra vectors (say 20) put before the real input, that aren't in the table at all. they match no real word, so you can't read them back as text.
- where they come from: training, just like weights, only at the input instead of inside a layer.
  1. start random (or copied from real words like "classify sentiment")
  2. run the task's examples through the model with them in front
  3. loss → backprop flows through all 32 frozen layers back to the input
  4. only the 20 vectors get nudged, not one model weight changes
  5. repeat until they sit wherever the frozen model answers correctly
- so they're random only at the start. after training they're not irrelevant, they're tuned for the task. irrelevant to each single input, the same way a system prompt is.
- best way to see it: a fixed instruction like "classify this review as positive or negative:", but written by gradient descent in the model's own internal language instead of by me. can sit anywhere in the vector space, not only on real words, that's why it can beat hand-written prompts.
- how it steers: attention. every input token can attend to the soft prompt in every layer, so it shapes the whole computation. i'm tuning the context, not the model.
- tiny: $20 \times 4096 = 81{,}920$ params vs 8B. needs an open-weight model (vectors in, gradients out), can't do it through a text api.
- limit: it can only bring out abilities the frozen model already has. near full fine-tuning on very big models, weaker on small ones (lora usually wins there).

## how it's used

- one soft prompt per task (sentiment, invoice extraction, support tone…). on use, prepend that task's soft prompt to the user's input. one frozen base model serves many tasks by swapping tiny vectors, same idea as many lora adapters on one base.
- the app picks the task, not the model. sentiment endpoint always prepends the sentiment prompt. picking automatically from the user's input needs a router first (small classifier / llm call), that's the routing pattern (G5.3, G6.8), not prompt tuning itself.
- it clarifies the task (what kind of answer, what format), not this particular user's message. same soft prompt for every input of that task.

## lora, what i finally get

- in short: lora freezes the whole model, and for chosen weight matrices in every layer it learns a small correction $B \cdot A$, then adds it into each matrix. not the last layer, and no new layers.
- the pair sits beside one existing matrix inside a layer (e.g. $W_q$ in layer 5) and reads the same input $x$ that $W$ reads, not the model's output:
  $h = Wx + \frac{\alpha}{r} \cdot B(Ax)$
- $A$ and $B$ have different shapes and jobs. $A$ ($r \times 4096$) squeezes $x$ down to $r$ numbers, $B$ ($4096 \times r$) expands back. $A$ starts random, $B$ starts at 0, so at step 0 nothing changes and training grows the correction from nothing.
- $B \cdot A$ = a full-size $4096 \times 4096$ update $\Delta W$, same shape as $W$. after training, merge: $W' = W + \frac{\alpha}{r} B A$. model keeps its exact shape, no extra cost at run time.
- usually many pairs: $W_q$ and $W_v$ only, or all 7 matrices in every layer. llama 3.1 8b with all 7 = 32 × 7 = 224 pairs.
- lora ≠ adapters. lora = linear bypass beside a matrix, merges into $W$. adapter = new small block in the path (squeeze → nonlinearity → expand), can't merge, every token pays a bit extra.

## what r is

- $r$ = rank, a hyperparameter i choose. NOT how many weights get updated: every weight in $W$ changes, all 16.8M of them. $r$ limits how many independent patterns the change is built from.
- my neurons picture: $A$ is like a tiny layer of $r$ neurons (no relu) reading $x$, each one a pattern detector ("does $x$ look like pattern 3?"). $B$ decides what each detected pattern does to the output. so $r$ = how many new patterns the correction can detect and respond to. each pattern still touches every weight, but in a coordinated way, that's why $65{,}536$ numbers can steer $16.8$M.
- the hypothesis: adapting to a task needs only a few patterns (low "intrinsic rank"). lora paper: ranks 1–8 often matched much bigger ones. that's why $r$ stays small.
- photo analogy: changing a photo's warmth touches every pixel, but the whole edit is one number and one pattern. lora does edits like that to each matrix, with $r$ patterns.
- picking it: start at 8 or 16 → train → eval on held-out data (G4.5). underfits with lots of data → double $r$. overfits on little data → halve $r$ or get more data. honest way = small sweep (8, 16, 32, 64) on my own eval.
- params per matrix = $r \times (4096 + 4096)$, so cost grows linearly with $r$. small $r$ fits format / style / narrow task; large $r$ for a new domain, new language, lots of data.
- partner $\alpha$: the update is scaled by $\frac{\alpha}{r}$. common rule $\alpha = 2r$ (e.g. $r = 16$, $\alpha = 32$). rslora scales by $\frac{\alpha}{\sqrt{r}}$ instead, better at large $r$.
- depth for later: hyperparameters with code in G4.2 L2, choosing rank and target matrices in G4.2 L3.

## still to check

- lester et al. 2021 (the prompt tuning paper) is in the sources of G4.2 L1, the "near full fine-tuning on big models" claim comes from it.
- hu et al. 2021 (the lora paper) for the "ranks 1–8 often enough" result, from memory, check it.
