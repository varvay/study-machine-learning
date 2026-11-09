---
title: Hands-on fine-tune
---

A fine-tuning run follows six steps, with a loop back when the result disappoints:

1. **Data** — collect and clean the examples (G4.4), then split them: most for training, some for **validation** (checked during training), and a held-out **test** set for the final comparison (G2.3).
2. **Base model** — the pretrained model to start from. A small open-weight model, one whose weights you can download and train yourself (G3.3 L1), of 1 to 8 billion weights fits on one GPU with QLoRA: at 4 bits, 8 billion weights take about 4 GB (G4.2). An **instruct** version already follows instructions (G4.3), so the run only has to teach the task.
3. **Config** — the method, LoRA or QLoRA (G4.2), and the **hyperparameters**, the settings fixed before training (G2.3): learning rate, number of epochs, batch size, and LoRA rank.
4. **Train** — the training loop of G2.4 runs on a GPU: forward pass, loss, gradients, update, batch after batch. The loss on the training and validation examples is logged as it goes. The output is the adapter file (G4.2).
5. **Evaluate** — score the fine-tuned model and the baseline on the test set, and check general ability for forgetting (G4.5). If the fine-tune does not win, fix the data or the config and train again.
6. **Serve** — deploy it for the application. An inference server, a program that keeps the model in GPU memory and answers requests over an API, loads the base model with the adapter, or a copy with the adapter merged in (G4.2), and the application calls it like any other model (G6).

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 190" role="img" aria-labelledby="hands-on-steps-title">
<title id="hands-on-steps-title">Six steps of a fine-tuning run from data to serving, with a loop from evaluate back to data and config</title>
<text class="note" x="20" y="30">one fine-tuning run</text>
<rect class="fold-train" x="20" y="50" width="98" height="56" rx="8" /><text class="table-name" x="69" y="76" text-anchor="middle">data</text><text class="key-tag" x="69" y="94" text-anchor="middle">JSONL examples</text>
<rect class="fold-train" x="148" y="50" width="98" height="56" rx="8" /><text class="table-name" x="197" y="76" text-anchor="middle">base model</text><text class="key-tag" x="197" y="94" text-anchor="middle">pretrained start</text>
<rect class="fold-train" x="276" y="50" width="98" height="56" rx="8" /><text class="table-name" x="325" y="76" text-anchor="middle">config</text><text class="key-tag" x="325" y="94" text-anchor="middle">LoRA, settings</text>
<rect class="fold-test" x="404" y="50" width="98" height="56" rx="8" /><text class="table-name" x="453" y="76" text-anchor="middle">train</text><text class="key-tag" x="453" y="94" text-anchor="middle">on a GPU</text>
<rect class="fold-train" x="532" y="50" width="98" height="56" rx="8" /><text class="table-name" x="581" y="76" text-anchor="middle">evaluate</text><text class="key-tag" x="581" y="94" text-anchor="middle">vs the baseline</text>
<rect class="fold-train" x="660" y="50" width="98" height="56" rx="8" /><text class="table-name" x="709" y="76" text-anchor="middle">serve</text><text class="key-tag" x="709" y="94" text-anchor="middle">base + adapter</text>
<path class="key-link" d="M118,78 L148,78 M142,74 L148,78 L142,82" />
<path class="key-link" d="M246,78 L276,78 M270,74 L276,78 L270,82" />
<path class="key-link" d="M374,78 L404,78 M398,74 L404,78 L398,82" />
<path class="key-link" d="M502,78 L532,78 M526,74 L532,78 L526,82" />
<path class="key-link" d="M630,78 L660,78 M654,74 L660,78 L654,82" />
<path class="key-link" d="M581,106 L581,146 L69,146 L69,106 M65,113 L69,106 L73,113" />
<path class="key-link" d="M325,146 L325,106 M321,113 L325,106 L329,113" />
<text class="note" x="325" y="172" text-anchor="middle">not better than the baseline: fix the data or the config, then train again</text>
</svg>
</div>
<figcaption>A fine-tuning run. Training, shaded, is the step that changes weights; evaluation decides whether the result ships or the run loops back.</figcaption>
</figure>
