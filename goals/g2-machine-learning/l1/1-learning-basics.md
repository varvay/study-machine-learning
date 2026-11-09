---
title: Learning basics
---

**Machine learning** is building a program that learns a rule from examples instead of being given the rule. The program is a **model**: a function with adjustable numbers inside it, its **parameters**. **Training** adjusts the parameters until the model's outputs match the examples. A spam filter learns which words signal spam from thousands of emails marked by people, where nobody wrote the rule by hand.

Three ways to learn, by what the examples contain:

- **Supervised learning** — learning from examples that come with the correct answer, the **label**. Emails marked spam or not spam train a model to label new emails.
- **Unsupervised learning** — finding structure in examples that have no labels. Grouping customers by what they buy (**clustering**) needs no one to name the groups first.
- **Reinforcement learning** — learning by acting and receiving a reward or penalty for each outcome. A game-playing agent learns which moves win; RLHF (reinforcement learning from human feedback, G4) tunes LLMs (large language models, the text-generating models of G3) the same way, with human preferences as the reward.

Supervised tasks split by the kind of answer:

- **Classification** — the answer is a category: spam or not spam, which of 10 digits.
- **Regression** — the answer is a number: a house price, tomorrow's demand.

The goal is not to do well on the training examples; it is to do well on data the model has never seen. That ability is **generalization**, and two failures work against it:

- **Underfitting** — the model is too simple to capture the pattern, so it does badly on the training data and on new data. A straight line through data that curves.
- **Overfitting** — the model is flexible enough to memorize the training data, noise included (the random scatter in the data that no rule predicts), so it does well on training data and badly on new data. A curve that bends through every training point.

The same two failures have statistical names:

- **Bias** — error from assumptions too simple for the data. It stays even with endless data. High bias means underfitting.
- **Variance** — error from sensitivity to the particular training sample: train on a different sample and the predictions change a lot. High variance means overfitting.
- **Bias-variance trade-off** — a more flexible model lowers bias and raises variance. The best model sits between the two extremes, as the walkthrough below shows.

Two standard tools against overfitting:

- **Regularization** — a penalty added to the training objective (the error score that training drives down, called the loss in G2.4) that grows with the size of the parameters. The model then prefers simpler fits unless the data strongly supports a complex one.
- **Cross-validation** — estimating how well a model generalizes by training and testing it several times on different splits of the data. In **k-fold** cross-validation, the data is cut into k parts; each part serves once as the test set while the other k − 1 train the model, and the k scores are averaged. One split alone gives a score that depends on the luck of which rows landed in the test part.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 250" role="img" aria-labelledby="k-fold-title">
<title id="k-fold-title">5-fold cross-validation: five rounds, each using a different fifth of the data as the test part</title>
<text class="note" x="20" y="22">the same data, cut into 5 parts</text>
<rect class="fold-test" x="120" y="40" width="120" height="30" rx="6" /><rect class="fold-train" x="245" y="40" width="120" height="30" rx="6" /><rect class="fold-train" x="370" y="40" width="120" height="30" rx="6" /><rect class="fold-train" x="495" y="40" width="120" height="30" rx="6" /><rect class="fold-train" x="620" y="40" width="120" height="30" rx="6" /><text x="20" y="60">round 1</text><text class="note" x="180" y="60" text-anchor="middle">test</text>
<rect class="fold-train" x="120" y="80" width="120" height="30" rx="6" /><rect class="fold-test" x="245" y="80" width="120" height="30" rx="6" /><rect class="fold-train" x="370" y="80" width="120" height="30" rx="6" /><rect class="fold-train" x="495" y="80" width="120" height="30" rx="6" /><rect class="fold-train" x="620" y="80" width="120" height="30" rx="6" /><text x="20" y="100">round 2</text><text class="note" x="305" y="100" text-anchor="middle">test</text>
<rect class="fold-train" x="120" y="120" width="120" height="30" rx="6" /><rect class="fold-train" x="245" y="120" width="120" height="30" rx="6" /><rect class="fold-test" x="370" y="120" width="120" height="30" rx="6" /><rect class="fold-train" x="495" y="120" width="120" height="30" rx="6" /><rect class="fold-train" x="620" y="120" width="120" height="30" rx="6" /><text x="20" y="140">round 3</text><text class="note" x="430" y="140" text-anchor="middle">test</text>
<rect class="fold-train" x="120" y="160" width="120" height="30" rx="6" /><rect class="fold-train" x="245" y="160" width="120" height="30" rx="6" /><rect class="fold-train" x="370" y="160" width="120" height="30" rx="6" /><rect class="fold-test" x="495" y="160" width="120" height="30" rx="6" /><rect class="fold-train" x="620" y="160" width="120" height="30" rx="6" /><text x="20" y="180">round 4</text><text class="note" x="555" y="180" text-anchor="middle">test</text>
<rect class="fold-train" x="120" y="200" width="120" height="30" rx="6" /><rect class="fold-train" x="245" y="200" width="120" height="30" rx="6" /><rect class="fold-train" x="370" y="200" width="120" height="30" rx="6" /><rect class="fold-train" x="495" y="200" width="120" height="30" rx="6" /><rect class="fold-test" x="620" y="200" width="120" height="30" rx="6" /><text x="20" y="220">round 5</text><text class="note" x="680" y="220" text-anchor="middle">test</text>
</svg>
</div>
<figcaption>5-fold cross-validation. Each round trains a fresh model on the four plain parts and scores it on the shaded one; the reported score is the average of the five.</figcaption>
</figure>

Source: [scikit-learn — Cross-validation](https://scikit-learn.org/stable/modules/cross_validation.html)
