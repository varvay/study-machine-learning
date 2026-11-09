---
title: Neural network training
---

A **neural network** is a model built from many small, identical units, neurons, arranged in layers. LLMs (G3) are very large neural networks, trained the way this section describes.

- **Neuron** — a unit that multiplies each input by a **weight**, adds the results plus a constant called its **bias**, and passes the sum through an activation function: output = activation(w₁x₁ + w₂x₂ + … + b). The weights and biases are the parameters that training adjusts; the inputs x are data, not parameters. This bias is a parameter, unrelated to the bias of G2.1. With LLMs, "weights" is often used loosely for all the parameters, as in "open-weight model".
- **Activation function** — a non-linear function applied to the neuron's sum. The most common, **ReLU**, outputs max(0, sum). Without it, any stack of layers collapses into one linear function, which can only draw straight lines.
- **Layer** — a group of neurons that all read the same inputs. A network stacks layers: an input layer, **hidden layers**, and an output layer. "Deep" learning means many hidden layers.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 230" role="img" aria-labelledby="neuron-title">
<title id="neuron-title">One neuron: three inputs, each multiplied by a weight, summed with a bias, passed through an activation to give the output</title>
<text x="40" y="54">x₁</text><text x="40" y="119">x₂</text><text x="40" y="184">x₃</text>
<text class="note" x="20" y="24">inputs</text>
<path class="key-link" d="M62,50 L318,112" /><path class="key-link" d="M62,115 L318,115" /><path class="key-link" d="M62,180 L318,118" />
<text class="key-tag" x="170" y="68">× w₁</text><text class="key-tag" x="170" y="108">× w₂</text><text class="key-tag" x="170" y="166">× w₃</text>
<rect class="fold-test" x="318" y="85" width="140" height="60" rx="30" />
<text class="table-name" x="388" y="111" text-anchor="middle">Σ + b</text>
<text class="key-tag" x="388" y="130" text-anchor="middle">weighted sum</text>
<path class="key-link" d="M458,115 L520,115" />
<rect class="fold-train" x="520" y="90" width="120" height="50" rx="10" />
<text class="table-name" x="580" y="112" text-anchor="middle">activation</text>
<text class="key-tag" x="580" y="129" text-anchor="middle">e.g. max(0, sum)</text>
<path class="key-link" d="M640,115 L700,115" />
<text x="708" y="119">output</text>
</svg>
</div>
<figcaption>One neuron. A layer holds many of them side by side; each neuron's output becomes an input of the next layer.</figcaption>
</figure>

Training runs the same loop many times. The first walkthrough below runs one round of it through a network of three hidden neurons, with every number shown:

- **Forward pass** — computing the network's output for an input, layer by layer from input to output.
- **Loss** — one number that measures how wrong the output is against the label, such as the squared difference for a number, or **cross-entropy** for a category (it grows as the model's probability for the correct answer shrinks). Training means lowering the average loss over the training data.
- **Gradient** — for each parameter, how much the loss would change if that parameter grew slightly. Its sign gives the direction that increases the loss.
- **Backpropagation** — the method that computes every parameter's gradient in one backward sweep, from the loss back through the layers. Each layer reuses the result of the layer after it (the chain rule of calculus: the slope through a chain of functions is the product of their slopes), so the whole sweep costs only a small multiple of one forward pass.
- **Gradient descent** — updating every parameter a small step against its gradient: w ← w − η × gradient. The **learning rate** η sets the step size: too small and training crawls; too large and each step overshoots the minimum. The second walkthrough below shows both.
- **Batch** and **epoch** — each update uses a small batch of examples, not the whole dataset, so each step is cheap. One pass through all the training data is one epoch; training usually takes many epochs.
