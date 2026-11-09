---
title: Neural network training
---

Recap (G2.4 L1): a network of layers of neurons computes a forward pass, a loss measures its error, backpropagation computes each parameter's gradient, and gradient descent steps against it, batch by batch, epoch by epoch. Here the same loop runs in PyTorch.

**PyTorch** is a Python library for building and training neural networks. Its building blocks:

- **Tensor** — an n-dimensional array, like an array of NumPy (Python's standard numeric library), that can live on a GPU (a graphics processor, which runs a network's many multiplications in parallel). Operations on tensors are recorded, so PyTorch can compute gradients automatically (**autograd**).
- **`nn.Module`** — a layer or a whole model; it owns its parameters. `nn.Sequential` chains modules in order.
- **`nn.Linear(in_features, out_features)`** — a **fully connected layer**: each of its `out_features` neurons computes a weighted sum of all `in_features` inputs plus a bias (the neuron of G2.4 L1).
- **`DataLoader`** — hands out the training data in shuffled batches of `batch_size` rows; `TensorDataset` wraps tensors as a dataset.
- **Optimizer** — applies the update rule to every parameter, such as `torch.optim.AdamW(model.parameters(), lr=1e-3)`, where `lr` is the learning rate (AdamW is explained under Optimizers below).

**Train a small MLP.** A **multilayer perceptron (MLP)** is a network of fully connected layers with an activation between them, the basic network for tabular data (rows and columns, as in a spreadsheet). This one reads the 30 breast-cancer measurements and outputs one score per class.

```python
import copy

import torch
from sklearn.datasets import load_breast_cancer
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

torch.manual_seed(0)

X, y = load_breast_cancer(return_X_y=True)
X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.25, stratify=y, random_state=0)
scaler = StandardScaler().fit(X_train)
X_train, X_val = scaler.transform(X_train), scaler.transform(X_val)

def as_tensors(features, labels):
    return torch.tensor(features, dtype=torch.float32), torch.tensor(labels, dtype=torch.long)

train_dataset = TensorDataset(*as_tensors(X_train, y_train))
X_val_tensor, y_val_tensor = as_tensors(X_val, y_val)

def build_model():
    return nn.Sequential(
        nn.Linear(30, 64),
        nn.BatchNorm1d(64),
        nn.ReLU(),
        nn.Dropout(p=0.3),
        nn.Linear(64, 2),
    )

def train(model, learning_rate=1e-3, batch_size=32, max_epochs=200, patience=10, verbose=False):
    loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, drop_last=True)
    loss_fn = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=1e-2)
    best_val_loss, best_state, epochs_without_improvement = float("inf"), None, 0

    for epoch in range(1, max_epochs + 1):
        model.train()
        train_loss_sum = 0.0
        for features, labels in loader:
            optimizer.zero_grad()
            loss = loss_fn(model(features), labels)
            loss.backward()
            optimizer.step()
            train_loss_sum += loss.item() * len(labels)
        train_loss = train_loss_sum / (len(loader) * batch_size)

        model.eval()
        with torch.no_grad():
            val_logits = model(X_val_tensor)
            val_loss = loss_fn(val_logits, y_val_tensor).item()
            val_accuracy = (val_logits.argmax(dim=1) == y_val_tensor).float().mean().item()
        if verbose and epoch % 5 == 0:
            print(f"epoch {epoch:3d}  train loss {train_loss:.3f}  val loss {val_loss:.3f}  val accuracy {val_accuracy:.3f}")

        if val_loss < best_val_loss:
            best_val_loss, best_state, epochs_without_improvement = val_loss, copy.deepcopy(model.state_dict()), 0
        else:
            epochs_without_improvement += 1
            if epochs_without_improvement == patience:
                break

    model.load_state_dict(best_state)
    if verbose:
        print(f"stopped at epoch {epoch}; restored the best val loss, {best_val_loss:.3f}")
    return best_val_loss, epoch

train(build_model(), verbose=True)
```

```text
epoch   5  train loss 0.199  val loss 0.193  val accuracy 0.937
epoch  10  train loss 0.115  val loss 0.135  val accuracy 0.937
epoch  15  train loss 0.086  val loss 0.110  val accuracy 0.944
epoch  20  train loss 0.069  val loss 0.101  val accuracy 0.944
epoch  25  train loss 0.074  val loss 0.093  val accuracy 0.951
epoch  30  train loss 0.066  val loss 0.090  val accuracy 0.972
epoch  35  train loss 0.054  val loss 0.091  val accuracy 0.965
epoch  40  train loss 0.073  val loss 0.094  val accuracy 0.958
epoch  45  train loss 0.058  val loss 0.084  val accuracy 0.958
epoch  50  train loss 0.056  val loss 0.092  val accuracy 0.958
stopped at epoch 52; restored the best val loss, 0.083
```

The inner loop is the training step of G2.4 L1, one line each:

1. **`optimizer.zero_grad()`** — clears the previous batch's gradients. PyTorch adds each new gradient to the stored one, so without this, batches would pile up.
2. **`model(features)`** — the forward pass. It returns **logits**, one raw score per class.
3. **`loss_fn(…, labels)`** — the loss for the batch.
4. **`loss.backward()`** — backpropagation: fills each parameter's `.grad`.
5. **`optimizer.step()`** — updates every parameter from its gradient.

Around it:

- **`model.train()` and `model.eval()`** switch the dropout and batch-normalization layers between their training and evaluation behaviour (both below). Evaluating in training mode gives random, wrong predictions.
- **`torch.no_grad()`** turns off gradient recording during evaluation, which saves memory and time.
- **Early stopping** — stopping training once the validation loss has not improved for `patience` epochs in a row, then restoring the weights from the best epoch. It keeps the model from the point where it generalized best, before it started to memorize. `state_dict()` returns the model's live tensors, so the best one is saved with `copy.deepcopy`. The walkthrough below steps through it.

Here the validation loss bottomed at 0.083 at epoch 42, ten epochs before the stop, and the training loss sits below it throughout: the model fits its own data better than new data, as expected.

**Loss functions.**

- **Mean squared error**, for regression: MSE = (1/n) Σᵢ (yᵢ − ŷᵢ)², the RMSE of G2.2 without the root. `nn.MSELoss()`. The last layer outputs one number with no activation, and the targets are floats.
- **Cross-entropy**, for classification. **Softmax** turns the logits z₁ … z_K into probabilities, pₖ = e^zₖ / Σⱼ e^zⱼ. The loss for one example is −log p_y, the negative log of the probability given to the true class y, averaged over the batch. `nn.CrossEntropyLoss()` takes the raw logits and the class indices (integers), and applies the softmax itself, so the model must not end in a softmax layer. For a binary task with a single output logit, `nn.BCEWithLogitsLoss` is the equivalent.

Worked example: logits [2.0, 0.5, −1.0] with true class 0 give probabilities [0.786, 0.175, 0.039], and the loss is −log 0.786 = 0.241. An LLM uses the same loss over its vocabulary, and exp of it is the perplexity (G2.2).

```python
import torch
from torch import nn

logits = torch.tensor([[2.0, 0.5, -1.0]])
label = torch.tensor([0])
print(nn.CrossEntropyLoss()(logits, label).item())

predicted = torch.tensor([2.5, 0.0, 2.0])
target = torch.tensor([3.0, -0.5, 2.0])
print(nn.MSELoss()(predicted, target).item())
```

```text
0.24131132662296295
0.1666666716337204
```

**Optimizers.**

- **SGD** (stochastic gradient descent) — the update of G2.4 L1, w ← w − η g, where g is the gradient on one batch. With **momentum** μ, PyTorch keeps a velocity v, a running sum of recent gradients: v ← μv + g, then w ← w − ηv. The velocity smooths out the noise of single batches and speeds up travel in a direction the gradients keep agreeing on. `torch.optim.SGD(model.parameters(), lr=0.01, momentum=0.9)`.
- **AdamW** — gives every parameter its own step size. It keeps two running averages per parameter: m, of the gradient (weight β₁ = 0.9), and v, of the squared gradient (β₂ = 0.999). Both start at zero, so early values are scaled up (m̂, v̂). The step is w ← w − η m̂ / (√v̂ + ε), where ε is a tiny constant that prevents division by zero: a parameter with small or noisy gradients gets its step rescaled by their typical size. Then **weight decay** shrinks each weight directly, w ← w − ηλw, which acts like the L2 penalty of G2.1. The "W" means this decay is decoupled: plain Adam's `weight_decay` adds λw to the gradient instead, where the per-parameter rescaling weakens it. PyTorch defaults: `lr=1e-3`, `betas=(0.9, 0.999)`, `eps=1e-8`, `weight_decay=1e-2`.

**Tuning the learning rate and batch size.**

- **Learning rate** — sweep it on a log scale, such as 1e-4, 1e-3, 1e-2, 1e-1, compare the best validation loss of each run, then refine around the winner. Too low shows as slow progress that runs out of epochs; too high as a loss that jumps around or grows (the walkthrough in G2.4 L1).
- **Batch size** — the number of examples per update. A larger batch gives a less noisy gradient and uses the hardware better, but makes fewer updates per epoch and needs more memory. After changing it, re-tune the learning rate. A common starting point for SGD scales the learning rate in proportion to the batch size (the linear scaling rule of Goyal et al.).

```python
for batch_size in [16, 64]:
    for learning_rate in [1e-4, 1e-3, 1e-2, 1e-1]:
        torch.manual_seed(0)
        val_loss, epochs = train(build_model(), learning_rate, batch_size)
        print(f"batch {batch_size:3d}  lr {learning_rate:<6g}  best val loss {val_loss:.3f}  after {epochs} epochs")
```

```text
batch  16  lr 0.0001  best val loss 0.100  after 141 epochs
batch  16  lr 0.001   best val loss 0.086  after 41 epochs
batch  16  lr 0.01    best val loss 0.084  after 27 epochs
batch  16  lr 0.1     best val loss 0.093  after 23 epochs
batch  64  lr 0.0001  best val loss 0.126  after 200 epochs
batch  64  lr 0.001   best val loss 0.088  after 87 epochs
batch  64  lr 0.01    best val loss 0.077  after 21 epochs
batch  64  lr 0.1     best val loss 0.083  after 28 epochs
```

At 1e-4 training crawls: with batch 64 it hits the 200-epoch limit still improving. A batch of 64 makes 6 updates per epoch against 26 for a batch of 16, so at the same learning rate it needs more epochs (87 against 41 at 1e-3). The best runs use 1e-2. On 426 training rows the differences are small; on a large dataset they grow.

**Dropout** — a layer that, during training, sets each activation (a neuron's output value) to zero with probability p and multiplies the survivors by 1/(1 − p), so the expected total stays the same. During evaluation it passes everything through unchanged. Because any neuron may vanish, no neuron can rely on a specific other one, which reduces overfitting. `nn.Dropout(p=0.5)` is the default rate; the model above uses 0.3.

```python
torch.manual_seed(0)
dropout = nn.Dropout(p=0.5)
activations = torch.ones(8)
dropout.train()
print(dropout(activations))
dropout.eval()
print(dropout(activations))
```

```text
tensor([2., 0., 0., 2., 2., 0., 0., 2.])
tensor([1., 1., 1., 1., 1., 1., 1., 1.])
```

**Normalization layers** keep each layer's inputs on a steady scale, which makes training more stable and tolerates higher learning rates.

- **`nn.BatchNorm1d(num_features)`** — for each feature, subtracts the mean over the batch and divides by the batch's standard deviation, then applies a learned scale γ and shift β: y = (x − E[x]) / √(Var[x] + ε) · γ + β. In training it uses the current batch's statistics and updates running averages of them; in evaluation it uses the running averages. A training batch of one row has no spread and raises an error, which is why the loader sets `drop_last=True`.
- **`nn.LayerNorm(normalized_shape)`** — the same formula, but the mean and variance are taken over the features of each example on its own. It uses no batch statistics, so it behaves the same in training and evaluation at any batch size. Transformers, the network design behind LLMs, use it (G3.1).

Sources: [PyTorch — Optimizing model parameters](https://docs.pytorch.org/tutorials/beginner/basics/optimization_tutorial.html) · PyTorch 2.14 docs: [CrossEntropyLoss](https://docs.pytorch.org/docs/2.14/generated/torch.nn.CrossEntropyLoss.html), [BCEWithLogitsLoss](https://docs.pytorch.org/docs/2.14/generated/torch.nn.BCEWithLogitsLoss.html), [MSELoss](https://docs.pytorch.org/docs/2.14/generated/torch.nn.MSELoss.html), [SGD](https://docs.pytorch.org/docs/2.14/generated/torch.optim.SGD.html), [AdamW](https://docs.pytorch.org/docs/2.14/generated/torch.optim.AdamW.html), [Dropout](https://docs.pytorch.org/docs/2.14/generated/torch.nn.Dropout.html), [BatchNorm1d](https://docs.pytorch.org/docs/2.14/generated/torch.nn.BatchNorm1d.html), [LayerNorm](https://docs.pytorch.org/docs/2.14/generated/torch.nn.LayerNorm.html) · [Loshchilov & Hutter, Decoupled Weight Decay Regularization](https://arxiv.org/abs/1711.05101) · [Goyal et al., Accurate, Large Minibatch SGD](https://arxiv.org/abs/1706.02677) · [Ioffe & Szegedy, Batch Normalization](https://arxiv.org/abs/1502.03167)
