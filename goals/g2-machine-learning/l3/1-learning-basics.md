---
title: Learning basics
---

**Bias-variance decomposition** — an identity that splits a model's expected squared error on a new point into three parts. Imagine drawing many training sets from the same source, training the same kind of model on each, and predicting the same point x. With y = f(x) + noise:

E[(y − f̂(x))²] = σ² + (E[f̂(x)] − f(x))² + E[(f̂(x) − E[f̂(x)])²]

- **f(x)** — the true value the data follows at x; **f̂(x)** — the prediction of one trained model; **E[…]** — the average over training sets and noise.
- **σ²** — the noise in y itself. No model removes it: it is the **irreducible error**.
- **Bias²**, the middle term — how far the *average* model's prediction is from the truth. It measures what the model family cannot express.
- **Variance**, the last term — how much single models scatter around their average. It measures sensitivity to which rows landed in the training set.

The terms are exact only for squared error, and they can be measured only in simulation, where fresh training sets can be drawn. scikit-learn's example measures a decision tree at bias² 0.0003, variance 0.0152, noise 0.0098; bagging the same tree cuts variance to 0.0092 and leaves bias² at 0.0004. On real data you read the two terms off a learning curve (G2.1 L2): a large gap between training and validation error is variance; both errors high is bias.

**Does the trade-off hold for deep networks?** The identity always holds; the U-shaped test-error curve against model size does not. Past the size where a model fits its training data exactly, test error can fall a second time: **double descent**. Belkin et al. showed it for several model families, and Nakkiran et al. showed it in deep networks, also against training time. This is one reason very large networks generalize despite fitting their training data perfectly.

**Why ensembles work.** An ensemble combines many models into one prediction. The decomposition says what each kind attacks.

- **Bagging** (bootstrap aggregating) — train each model on a **bootstrap sample**, a random draw of rows with replacement from the training set, then average their predictions. Averaging B models, each with variance σ² and pairwise correlation ρ, gives variance ρσ² + (1 − ρ)σ²/B. The second part shrinks as B grows; the first stays, so the models must also disagree. A **random forest** lowers ρ by letting each split consider only a random subset of the features (`max_features`). Averaging leaves bias about where one model had it, so bagging suits models with low bias and high variance: deep, unpruned trees (grown to full depth, with no branches cut back). Bagging a linear model changes little, because its variance is already low.
- **Boosting** — train models in sequence, each one fitted to what the ensemble so far still gets wrong, and add them up. In **gradient boosting** each new tree fits the negative gradient of the loss, which for squared error is the residual y − prediction, and joins the sum scaled by a **learning rate** (shrinkage). Every round lowers the training error, which is bias, so boosting suits weak, high-bias learners: shallow trees. The same property makes it overfit if run too long; the number of trees (with early stopping on validation data), the learning rate, and row subsampling hold its variance down.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 320" role="img" aria-labelledby="learning-basics-ensembles-title">
<title id="learning-basics-ensembles-title">Bagging trains deep trees in parallel on bootstrap samples and averages them; boosting trains shallow trees in sequence, each on the errors left by the ones before, and sums them</title>
<text class="note" x="20" y="22">bagging: independent models, then average</text>
<path class="key-link" d="M130,97 L170,55" /><path class="key-link" d="M130,97 L170,100" /><path class="key-link" d="M130,97 L170,145" />
<path class="key-link" d="M320,55 L360,55" /><path class="key-link" d="M320,100 L360,100" /><path class="key-link" d="M320,145 L360,145" />
<path class="key-link" d="M490,55 L540,97" /><path class="key-link" d="M490,100 L540,97" /><path class="key-link" d="M490,145 L540,97" />
<rect class="fold-train" x="20" y="80" width="110" height="34" rx="6" /><text x="75" y="102" text-anchor="middle">training data</text>
<rect class="fold-train" x="170" y="40" width="150" height="30" rx="6" /><text x="245" y="60" text-anchor="middle">bootstrap sample 1</text>
<rect class="fold-train" x="170" y="85" width="150" height="30" rx="6" /><text x="245" y="105" text-anchor="middle">bootstrap sample 2</text>
<rect class="fold-train" x="170" y="130" width="150" height="30" rx="6" /><text x="245" y="150" text-anchor="middle">bootstrap sample 3</text>
<rect class="fold-train" x="360" y="40" width="130" height="30" rx="6" /><text x="425" y="60" text-anchor="middle">deep tree 1</text>
<rect class="fold-train" x="360" y="85" width="130" height="30" rx="6" /><text x="425" y="105" text-anchor="middle">deep tree 2</text>
<rect class="fold-train" x="360" y="130" width="130" height="30" rx="6" /><text x="425" y="150" text-anchor="middle">deep tree 3</text>
<rect class="fold-test" x="540" y="80" width="110" height="34" rx="6" /><text class="table-name" x="595" y="102" text-anchor="middle">average</text>
<text class="note" x="662" y="94">variance falls</text><text class="note" x="662" y="110">bias stays</text>
<text class="note" x="20" y="200">boosting: each model fits what the sum so far still gets wrong</text>
<path class="key-link" d="M130,247 L160,247" /><path class="key-link" d="M270,247 L320,247" /><path class="key-link" d="M430,247 L480,247" /><path class="key-link" d="M590,247 L620,247" />
<text class="key-tag" x="295" y="237" text-anchor="middle">errors</text><text class="key-tag" x="455" y="237" text-anchor="middle">errors</text>
<rect class="fold-train" x="20" y="230" width="110" height="34" rx="6" /><text x="75" y="252" text-anchor="middle">training data</text>
<rect class="fold-train" x="160" y="230" width="110" height="34" rx="6" /><text x="215" y="252" text-anchor="middle">shallow tree 1</text>
<rect class="fold-train" x="320" y="230" width="110" height="34" rx="6" /><text x="375" y="252" text-anchor="middle">shallow tree 2</text>
<rect class="fold-train" x="480" y="230" width="110" height="34" rx="6" /><text x="535" y="252" text-anchor="middle">shallow tree 3</text>
<rect class="fold-test" x="620" y="230" width="120" height="34" rx="6" /><text class="table-name" x="680" y="252" text-anchor="middle">scaled sum</text>
<text class="note" x="620" y="290">bias falls each round;</text><text class="note" x="620" y="306">too many rounds overfit</text>
</svg>
</div>
<figcaption>Bagging runs its models in parallel and averages away their disagreement. Boosting runs them in sequence, and each one corrects the ones before it.</figcaption>
</figure>

**Hyperparameter search** — choosing the settings fixed before training (G2.3 L1), such as tree depth or learning rate, by training candidates and scoring each on validation data.

- **Grid search** — tries every combination of listed values. Its cost multiplies with each hyperparameter added, and it spends most trials on combinations that differ only in settings that barely matter.
- **Random search** — draws every trial's values at random from ranges. Bergstra and Bengio showed it finds good settings faster than a grid, because usually only a few hyperparameters matter and which ones differ by dataset. A 3 × 3 grid tests 3 learning rates in 9 trials; 9 random trials test 9.
- **Bayesian optimization** — fits a model of "score given hyperparameters" to the trials so far, then picks the next trial where improvement looks most likely. Optuna, a Python hyperparameter-search library, does this by default with its **TPE** (Tree-structured Parzen Estimator) sampler, which models where good and bad past trials fell and samples where good ones are denser. **Pruning** stops trials whose early scores fall below the median of past trials at the same step (`MedianPruner`), so the budget goes to promising ones. **Successive halving** does the same on a fixed schedule: start many candidates on little data, keep the best half, double their budget (`HalvingRandomSearchCV`, still experimental in scikit-learn).

Choose by budget. A grid is fine for two or three hyperparameters with cheap training. Random search is the default when trials run in parallel, because each trial is independent. Bayesian search earns its cost when each trial is expensive (minutes to hours) and runs mostly in sequence, since each trial waits on the previous results. Search learning rates and penalties on a log scale: the difference between 0.001 and 0.01 matters as much as between 0.01 and 0.1.

```python
import optuna
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import cross_val_score

def objective(trial: optuna.Trial) -> float:
    model = HistGradientBoostingClassifier(
        learning_rate=trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
        max_leaf_nodes=trial.suggest_int("max_leaf_nodes", 8, 64, log=True),
        l2_regularization=trial.suggest_float("l2_regularization", 1e-3, 10.0, log=True),
    )
    return cross_val_score(model, X_train, y_train, cv=5, scoring="average_precision").mean()

study = optuna.create_study(direction="maximize")
study.optimize(objective, n_trials=50)
print(study.best_params, study.best_value)
```

Each trial is scored by average precision (PR-AUC, G2.2 L3). Every trial scored on the same validation folds fits the choice a little to those folds, so `best_value` is optimistic. Report the final model on a test set the search never saw, or wrap the search in an outer cross-validation loop (**nested cross-validation**) when data is too scarce for a test set.

**Choosing a model for a client.** Data size, data type, and the need to explain decisions narrow the choice before any tuning:

| Situation | Start with | Why |
|---|---|---|
| Tabular, hundreds to a few thousand rows, each decision must be explained (credit, insurance, clinical) | Regularized logistic regression, or an Explainable Boosting Machine | The model itself is readable: a weight or a shape per feature. EBM is a glassbox additive model (its prediction is a sum of one learned curve per feature, plus a few feature pairs) that InterpretML reports as close to random forests and boosted trees in accuracy. |
| Tabular, ~10,000 rows or more, accuracy first | Gradient boosted trees (XGBoost, LightGBM), explained with SHAP (SHapley Additive exPlanations) | Grinsztajn et al. found tree-based models still beat deep learning on medium-sized tabular data (~10K samples). SHAP gives each feature's contribution to one prediction. |
| Images, audio, free text | A pretrained deep network (already trained on a large general dataset) or foundation model (a large pretrained model adapted to many tasks), fine-tuned (trained further on your own examples) or prompted (G3, G4) | They arrive with learned representations; training from scratch needs far more data. |
| Text, very few labels | An LLM with few-shot prompting (a prompt that includes a few labeled examples; G3.5), or embeddings plus logistic regression | Uses the knowledge in pretrained models; the small labeled set goes to evaluation. |

Two kinds of explanation need separating. A **glassbox** model is readable as it stands; a **post-hoc** explanation such as SHAP approximates a black-box model from outside. When an auditor must check the model's actual reasoning, only a glassbox model gives it. Whatever the pick, first build the simplest baseline (a majority-class guess, a logistic regression) so the client sees what the extra complexity buys.

**In an interview**

- *Why does a random forest overfit less than a single decision tree?* A deep tree has low bias and high variance: it changes a lot with the training sample. The forest averages many trees trained on bootstrap samples, and averaging cuts variance while keeping bias roughly the same. Random feature subsets at each split make the trees disagree more, and less correlated trees cancel more of each other's errors.
- *A bank has 5,000 rows of loan data and must explain every rejection. What do you build?* A regularized logistic regression or an Explainable Boosting Machine: both are readable as they stand, and 5,000 rows is too little to gain much from complex models. I would compare them against gradient boosting under cross-validation, so the bank sees exactly how much accuracy interpretability costs. If boosting wins by a margin that matters, SHAP explanations are an option, but only if the regulator accepts approximations.

Sources: [scikit-learn — Bias-variance decomposition example](https://scikit-learn.org/stable/auto_examples/ensemble/plot_bias_variance.html) · [scikit-learn — Ensembles](https://scikit-learn.org/stable/modules/ensemble.html) · [Hastie, Tibshirani & Friedman, *The Elements of Statistical Learning* (§7.3, §15.2)](https://hastie.su.domains/ElemStatLearn/) · [Belkin et al., double descent](https://arxiv.org/abs/1812.11118) · [Nakkiran et al., Deep Double Descent](https://arxiv.org/abs/1912.02292) · [Bergstra & Bengio, Random Search for Hyper-Parameter Optimization](https://www.jmlr.org/papers/v13/bergstra12a.html) · [Optuna — `create_study` (TPE default)](https://optuna.readthedocs.io/en/stable/reference/generated/optuna.create_study.html) · [Optuna — `MedianPruner`](https://optuna.readthedocs.io/en/stable/reference/generated/optuna.pruners.MedianPruner.html) · [scikit-learn — Tuning hyperparameters](https://scikit-learn.org/stable/modules/grid_search.html) · [Grinsztajn et al., tree-based models on tabular data](https://arxiv.org/abs/2207.08815) · [InterpretML — Explainable Boosting Machine](https://interpret.ml/docs/ebm.html) · [Lundberg & Lee, SHAP](https://arxiv.org/abs/1705.07874)
