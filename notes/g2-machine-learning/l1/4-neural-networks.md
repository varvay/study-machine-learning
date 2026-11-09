---
updated: 2026-10-01T03:30:00.000Z
---

## layers, what i finally get

- one neuron = one line. $w_1x + w_2y + b = 0$, weights tilt it, bias shifts it. one weight per input feature, but only inside that one neuron.
- a layer = many neurons reading the same inputs, each with its own weights. so a layer of 3 neurons = 3 lines.
- each neuron outputs "which side of my line is this point on" (relu makes it 0 on the other side). those outputs are NEW features: $x, y$ are given, $h_1, h_2, h_3$ are learned.
- the next layer draws its line on the $h$'s, not on $x, y$. a straight cut on $(h_1, h_2, h_3)$ = a triangle back on the $(x, y)$ plane. xor is the same trick with 2 lines ($x_1 + x_2 = 0.5$ and $x_1 + x_2 = 1.5$, class 1 sits in the band between).
- so weights aren't the features, they're the recipe to build new features from old ones.
- width = more lines (more sides). depth = combining shapes (two triangles, rings, holes, curves). no relu = lines of lines collapse back into one line.

## layers in an llm

- every layer = same function, different weights. llama 3.1 8b is 32 copies of: norm → attention → $+x$ → norm → feed-forward → $+x$. ~218M params per layer, ~80% of it in the feed-forward.
- tokens don't get their own layer. every token climbs the same 32 layers. weights differ per layer (rows), shared by every token (columns). tokens only meet each other in attention.
- model size is fixed. a longer prompt = more compute + a bigger kv cache, never more weights.
- weights vs parameters: strictly, parameters = weights + biases, and the inputs $x$ are data, not parameters. llm talk says "weights" for all of them (llama has no biases anyway).
- why stack layers at all: some properties can only be computed from other computed properties. "bank" → noun → riverside (needs "river") → steep place → next word "slipped". one layer would have to jump straight from raw tokens to "slipped".

## who decides what

- humans pick the shape (how many layers, how wide), the data, and the loss. number of layers = hyperparameter, fixed before training (llama 3: 32 / 80 / 126 layers for 8b / 70b / 405b).
- training picks every weight, layer 1 included. all start random, backprop moves the lines wherever the loss goes down. nobody seeds layer 1, the machine never "knows" what a triangle is.
- each layer's role (syntax-ish early, meaning later) isn't designed, it emerges. we only partly know it (probing, interpretability), and neurons mix many concepts at once (superposition). so in practice you judge a model by what it does (evals), not by reading its weights.
- old ml = hand-made features (feature engineering). deep learning learns them instead, because ours are worse for language and images.
- fine-tuning: the "seed" is the whole pretrained model, not layer 1. keep training on narrow data → specialized, but it can get worse outside that subject (catastrophic forgetting, G4.5).

## still to check

- llama numbers and the interpretability papers (tenney 2019, anthropic 2024/2025) were from memory, unsourced.
