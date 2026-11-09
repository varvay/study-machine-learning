---
title: Neural network training
---

**Vanishing and exploding gradients.** Backpropagation (G2.4 L1) carries the gradient from the loss down through the layers, and at each layer multiplies it by that layer's **local factor**: its weights times the slope of its activation, w × f′(z). The gradient that reaches layer 1 of an L-layer network is a product of L such factors, so it changes exponentially with depth:

- **Vanishing gradient** — factors below 1 shrink it toward zero. The early layers barely update, and training stalls while the loss is still high. The sigmoid's slope is at most 0.25, so ten sigmoid layers with weights near 1 cut the gradient about a million times. Glorot and Bengio traced the failure of deep sigmoid networks to exactly this saturation (the sigmoid going flat, with a slope near 0, for large inputs).
- **Exploding gradient** — factors above 1 grow it without limit. One update throws the weights far off; the loss spikes or becomes NaN (not a number).

In a real network each factor is a matrix (the layer's Jacobian: how each of its outputs changes with each of its inputs), and what compounds is its typical scale, but the arithmetic is the same. The walkthrough below runs a one-neuron-per-layer stack; try the sigmoid and then ReLU with the same weight.

Symptoms: with vanishing gradients the loss plateaus early and the per-layer gradient norms (the overall size of each layer's gradient) shrink by orders of magnitude toward the input; with exploding ones the total gradient norm jumps by orders of magnitude just before a loss spike. Log per-layer gradient norms (Weights & Biases or TensorBoard, a training-metrics dashboard, do this) to see which.

Five fixes; the first four keep the local factors near 1, the last caps the damage when they are not:

- **ReLU** (and its smooth relatives GELU and SiLU, common in transformers) — its slope is exactly 1 for positive inputs, so the activation no longer shrinks the gradient. Its slope is 0 for negative inputs, so a neuron whose input stays negative never updates again (a **dead ReLU**); leaky ReLU keeps a small slope there.
- **Initialization** — draw the initial weights at the scale that keeps each layer's output variance equal to its input variance, so the factors start near 1. **Xavier / Glorot** initialization suits tanh (an S-shaped activation from −1 to 1) and sigmoid; **He** initialization, with variance 2 / fan-in (the number of inputs), suits ReLU, which zeroes half its inputs.
- **Residual connections** — each block adds its input to its output: h_l = h_(l−1) + F(h_(l−1)). The derivative is then 1 + F′, so the gradient has a direct path through every block that no weight can shrink. He et al. trained 152-layer networks this way, and every transformer block is residual.
- **Normalization** — rescale activations to zero mean and unit variance inside the network, which keeps each layer's input where its activation has a healthy slope. **Batch normalization** averages over the examples in a batch; **layer normalization** averages over the features of one example, so it works with any batch size and computes the same thing in training and inference (running the trained model to get predictions), which is why transformers use it. Where it sits matters: Xiong et al. showed that normalizing after the residual addition (Post-LN, the original transformer) produces large gradients near the output at the start and needs learning-rate warmup, while normalizing inside the residual branch (Pre-LN) trains without it.
- **Gradient clipping** — if the norm of all gradients together exceeds a limit, scale them all down to that limit, keeping their direction (Pascanu et al.). It stops explosions and does nothing for vanishing. `clip_grad_norm_` returns the norm before clipping, so log it: if clipping fires on nearly every step, the learning rate is too high. Hugging Face `Trainer`, the ready-made training loop of the `transformers` library, clips at `max_grad_norm = 1.0` by default.

```python
loss.backward()
total_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
optimizer.step()
optimizer.zero_grad()
```

**Learning-rate warmup and cosine decay** — a **learning-rate schedule** changes the learning rate η (G2.4 L1) over training instead of fixing it. The common schedule has two phases:

- **Warmup** — raise η linearly from near 0 to its peak over the first steps, often a few percent of training. At the start, gradients are large and erratic, and Adam's per-parameter estimate of gradient size rests on a handful of batches. Liu et al. showed that estimate has high variance early and that warmup works by reducing it; Goyal et al. needed a gradual warmup to train with very large batches. A full-size step at step 1 can push the weights into a region training never leaves.
- **Cosine decay** — after warmup, lower η along half a cosine wave: η_t = η_min + ½(η_max − η_min)(1 + cos(π t / T)), where t counts steps since warmup ended, T is the length of the decay, and η_min is the floor (Loshchilov and Hutter). The rate stays high early, while the loss has far to fall, and becomes small at the end, so the weights settle into a minimum instead of bouncing across it. Google's tuning playbook prefers linear or cosine decay and stresses that having some decay matters more than which one.

The schedule is set by the total number of optimizer steps, so stopping early leaves the rate high, and with gradient accumulation (summing gradients over several batches before one update, to act like a larger batch) a step means one optimizer update, not one batch. In Hugging Face (transformers v5.17 docs), `TrainingArguments(lr_scheduler_type="cosine", warmup_steps=0.03)` warms up over 3% of training (`warmup_steps` takes a step count, or a fraction below 1) and decays to 0; `"cosine_with_min_lr"` stops at a floor (`min_lr` or `min_lr_rate`, passed through `lr_scheduler_kwargs`). The same schedule is available as `get_cosine_schedule_with_warmup(optimizer, num_warmup_steps, num_training_steps)`, or in plain PyTorch as `SequentialLR` chaining `LinearLR` into `CosineAnnealingLR`. The walkthrough below computes it for any settings.

**Mixed precision (fp16, bf16)** — training with most arithmetic in 16-bit floating point instead of 32-bit, while a 32-bit master copy of the weights receives the updates (Micikevicius et al.). Activations take half the memory and GPU tensor cores (units built for matrix multiplication) run 16-bit math faster; the master copy keeps small updates from rounding away. A floating-point number stores an **exponent**, which sets its range, and a **mantissa**, which sets its precision:

| Format | Exponent bits | Mantissa bits | What it means |
|---|---|---|---|
| fp32 | 8 | 23 | the reference: wide range, fine precision |
| fp16 | 5 | 10 | largest value 65,504; small gradients round to 0 (underflow) |
| bf16 | 8 | 7 | the same range as fp32, coarser precision |

- **fp16** needs **loss scaling**: multiply the loss by a large factor S before backward so small gradients stay representable, then divide the gradients by S before the update. `torch.amp.GradScaler("cuda")` picks S dynamically and skips any step whose gradients overflowed.
- **bf16** covers fp32's range, so it needs no loss scaling; the Hugging Face docs recommend it over fp16 where the hardware supports it. Its coarse mantissa is why the 32-bit master weights still matter.

Choose bf16 on GPUs that support it, fp16 with a `GradScaler` on older ones (such as the T4 GPU common on free Colab, Google's hosted notebook service, which lacks bf16 support — unsourced). `torch.autocast` keeps precision-sensitive operations, such as reductions (sums and means over many values) and losses, in fp32 by itself. A model pretrained in bf16 can overflow when run in fp16, which the PyTorch AMP (automatic mixed precision) docs warn about.

```python
scaler = torch.amp.GradScaler("cuda")
with torch.autocast(device_type="cuda", dtype=torch.float16):
    loss = loss_fn(model(inputs), targets)
scaler.scale(loss).backward()
scaler.unscale_(optimizer)
torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
scaler.step(optimizer)
scaler.update()
```

With bf16, drop the scaler: `dtype=torch.bfloat16`, then a plain `loss.backward()` and `optimizer.step()`. Clipping after `unscale_` matters: clipping the scaled gradients would compare them with the wrong limit.

**Diagnose training from a loss curve.** Plot training and validation loss against steps, smoothed with a moving average, and read the shape:

| What the curve does | Likely cause | What to do |
|---|---|---|
| Starts far from the loss of a uniform guess (−log(1/C) for C classes) | Bad initialization of the last layer, or broken labels | Check the data and labels; initialize the output bias to the class balance |
| Stays flat from the start | Learning rate too low, vanishing gradients, or a bug (frozen parameters, which updates skip; labels misaligned with inputs) | First make the model overfit one small batch to near-zero loss; if it cannot, the bug is in the code |
| Falls, then shoots up or turns NaN | Learning rate too high, no warmup, fp16 overflow | Lower the peak rate, add warmup, clip gradients, switch to bf16 |
| Sharp spikes that recover | Outlier batches, or a rate at the edge of stability | Inspect the batches at the spikes, clip gradients |
| Training falls, validation turns up | Overfitting (G2.1 L1) | Stop at the validation minimum (early stopping), regularize, add data |
| Both plateau high | Underfitting: too little capacity or training | Larger model, train longer, less regularization |
| Very noisy | Batch too small for the rate | Larger batch, or lower rate |
| Validation below training | Dropout is active only in training, or validation data is easier or leaked (G2.3) | Compare both in evaluation mode; check the split |

Karpathy's recipe gives the two sanity checks in the table: confirm the loss at initialization, and overfit a single batch before training on everything.

**In an interview**

- *A 12-layer network with sigmoid activations barely learns, and its first layers' weights hardly change. Why, and what do you change?* The sigmoid's slope is at most 0.25, so backpropagation multiplies the gradient by a factor well below 1 at every layer, and after 12 layers almost nothing reaches the first ones. I would switch to ReLU with He initialization, add residual connections so gradients have a direct path, and add normalization. Then I would confirm the fix by logging per-layer gradient norms.
- *A fine-tune's loss goes NaN at step 300. Walk me through it.* I would look at the gradient norm and learning rate just before step 300: a rising norm points to a rate that is too high or a missing warmup, so I would lower the peak, add warmup, and clip. If it runs in fp16, overflow is likely, and bf16 or a correctly used `GradScaler` fixes it. If the norm was steady, I would inspect that step's batch for bad data, such as empty or extremely long sequences.

Sources: [Glorot & Bengio, difficulty of training deep networks](https://proceedings.mlr.press/v9/glorot10a.html) · [He et al., Delving Deep into Rectifiers (He init)](https://arxiv.org/abs/1502.01852) · [He et al., Deep Residual Learning](https://arxiv.org/abs/1512.03385) · [Ioffe & Szegedy, Batch Normalization](https://arxiv.org/abs/1502.03167) · [Ba et al., Layer Normalization](https://arxiv.org/abs/1607.06450) · [Xiong et al., Layer Normalization in the Transformer](https://arxiv.org/abs/2002.04745) · [Pascanu et al., gradient clipping](https://arxiv.org/abs/1211.5063) · [PyTorch — `clip_grad_norm_`](https://docs.pytorch.org/docs/stable/generated/torch.nn.utils.clip_grad_norm_.html) · [Liu et al., variance of the adaptive learning rate (RAdam)](https://arxiv.org/abs/1908.03265) · [Goyal et al., large-minibatch SGD with warmup](https://arxiv.org/abs/1706.02677) · [Loshchilov & Hutter, SGDR (cosine annealing)](https://arxiv.org/abs/1608.03983) · [Google Research — Deep Learning Tuning Playbook](https://github.com/google-research/tuning_playbook) · [Hugging Face — Optimization schedules](https://huggingface.co/docs/transformers/main_classes/optimizer_schedules) · [Hugging Face — `TrainingArguments`](https://huggingface.co/docs/transformers/main_classes/trainer) · [PyTorch — LR schedulers](https://docs.pytorch.org/docs/stable/optim.html) · [Micikevicius et al., Mixed Precision Training](https://arxiv.org/abs/1710.03740) · [bfloat16 format](https://en.wikipedia.org/wiki/Bfloat16_floating-point_format) · [fp16 format](https://en.wikipedia.org/wiki/Half-precision_floating-point_format) · [PyTorch — Automatic mixed precision](https://docs.pytorch.org/docs/stable/amp.html) · [PyTorch — AMP examples (clipping)](https://docs.pytorch.org/docs/stable/notes/amp_examples.html) · [Karpathy, A Recipe for Training Neural Networks](https://karpathy.github.io/2019/04/25/recipe/)
