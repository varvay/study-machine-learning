---
title: SFT and preference tuning
---

L2 ran SFT with TRL's `SFTTrainer` and DPO on chosen/rejected pairs with `DPOTrainer`. At L3 the questions are why DPO replaced PPO-based RLHF for most teams, what goes wrong when a model optimizes for preferences, and which newer method fits which data.

**RLHF with PPO.** InstructGPT's recipe has three steps:

1. **SFT** on human-written demonstrations.
2. **Reward model** — a copy of the language model with a head (a final layer) that outputs one number, trained on human rankings of 4 to 9 answers to the same prompt so the preferred answer scores higher.
3. **PPO** (proximal policy optimization), a reinforcement-learning algorithm. The **policy**, the model being trained, generates answers; the reward model scores them; the policy is updated to raise the reward minus a penalty β·KL(policy ‖ reference). The **reference** is a frozen copy of the SFT model, and the KL divergence measures how far the policy's token probabilities have drifted from it.

PPO is **actor-critic**: besides the policy (the actor) it trains a **value model** (the critic) that predicts the reward an answer will get, which makes the updates less noisy. DeepSeekMath, the paper that introduced GRPO (below), notes the value model is typically as large as the policy. So during RL four models sit in GPU memory: policy and value model training, reward model and reference frozen. Every step also generates text, the slowest part of the loop.

**DPO.** Rafailov et al. showed that the KL-constrained reward maximization above has a closed-form optimal policy: an exact formula for the best policy, with no search. Inverting it expresses the reward through the policy itself: r(x, y) = β·log(π_θ(y|x) / π_ref(y|x)), plus a term that depends only on the prompt and cancels when two answers to it are compared. Substituted into the preference model (the Bradley–Terry model RLHF's reward model is trained with: the chance that one answer beats another is the sigmoid of their reward difference), this leaves a classification loss over pairs:

L = −log σ( β·[ log(π_θ(y⁺|x) / π_ref(y⁺|x)) − log(π_θ(y⁻|x) / π_ref(y⁻|x)) ] )

- x — the prompt; y⁺ — the chosen answer; y⁻ — the rejected answer;
- π_θ — the policy being trained; π_ref — the frozen reference, usually the SFT model;
- σ — the sigmoid; β — how strongly the policy may move from the reference: higher β keeps it closer (TRL's default is 0.1).

No reward model and no generation during training: two models, and one if `DPOConfig(precompute_ref_log_probs=True)` computes the reference's log-probabilities once before training.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 356" role="img" aria-labelledby="sft-dpo-models-title">
<title id="sft-dpo-models-title">Models held in memory during preference tuning: RLHF with PPO holds four, DPO and KTO two, GRPO one or two plus reward functions, ORPO one</title>
<text class="note" x="210" y="22">shaded: trained · plain: frozen · outline only: optional or not a model</text>
<text class="table-name" x="20" y="62">RLHF with PPO</text><text class="key-tag" x="20" y="80">online: samples every step</text>
<rect class="fold-test" x="210" y="44" width="120" height="44" rx="8" /><text class="table-name" x="270" y="71" text-anchor="middle">policy</text>
<rect class="fold-test" x="340" y="44" width="120" height="44" rx="8" /><text class="table-name" x="400" y="71" text-anchor="middle">value model</text>
<rect class="fold-train" x="470" y="44" width="120" height="44" rx="8" /><text class="table-name" x="530" y="71" text-anchor="middle">reward model</text>
<rect class="fold-train" x="600" y="44" width="120" height="44" rx="8" /><text class="table-name" x="660" y="71" text-anchor="middle">reference</text>
<text class="table-name" x="20" y="126">DPO</text><text class="key-tag" x="20" y="144">offline: fixed chosen/rejected pairs</text>
<rect class="fold-test" x="210" y="108" width="120" height="44" rx="8" /><text class="table-name" x="270" y="135" text-anchor="middle">policy</text>
<rect class="fold-train" x="340" y="108" width="120" height="44" rx="8" /><text class="table-name" x="400" y="128" text-anchor="middle">reference</text><text class="key-tag" x="400" y="144" text-anchor="middle">or precomputed</text>
<text class="table-name" x="20" y="190">KTO</text><text class="key-tag" x="20" y="208">offline: answers labeled good or bad</text>
<rect class="fold-test" x="210" y="172" width="120" height="44" rx="8" /><text class="table-name" x="270" y="199" text-anchor="middle">policy</text>
<rect class="fold-train" x="340" y="172" width="120" height="44" rx="8" /><text class="table-name" x="400" y="192" text-anchor="middle">reference</text><text class="key-tag" x="400" y="208" text-anchor="middle">or precomputed</text>
<text class="table-name" x="20" y="254">GRPO</text><text class="key-tag" x="20" y="272">online: groups of samples</text>
<rect class="fold-test" x="210" y="236" width="120" height="44" rx="8" /><text class="table-name" x="270" y="263" text-anchor="middle">policy</text>
<rect class="table-outline" x="340" y="236" width="120" height="44" rx="8" /><text class="table-name" x="400" y="256" text-anchor="middle">reference</text><text class="key-tag" x="400" y="272" text-anchor="middle">only if β &gt; 0</text>
<rect class="table-outline" x="470" y="236" width="120" height="44" rx="8" /><text class="table-name" x="530" y="256" text-anchor="middle">reward functions</text><text class="key-tag" x="530" y="272" text-anchor="middle">code, not a model</text>
<text class="table-name" x="20" y="318">ORPO</text><text class="key-tag" x="20" y="336">offline: pairs, SFT in one stage</text>
<rect class="fold-test" x="210" y="300" width="120" height="44" rx="8" /><text class="table-name" x="270" y="327" text-anchor="middle">policy</text>
</svg>
</div>
<figcaption>What each method keeps in GPU memory while it trains. PPO's four models are why RLHF needs a cluster; DPO needs a policy and a reference, and ORPO drops the reference too.</figcaption>
</figure>

| | RLHF with PPO | DPO |
|---|---|---|
| Data | rankings to train a reward model, then prompts | a fixed set of chosen/rejected pairs |
| Models in memory | four | two, or one with precomputed reference log-probs |
| Generation during training | yes: it learns from its own current answers (**on-policy**) | no: it learns from answers someone else produced (**off-policy**) |
| Stability | many interacting settings; the DPO paper calls RLHF "complex and often unstable" | a classification loss with one main setting, β |
| Advantage | the reward model can score any new answer, so training can explore beyond the dataset | cheap, simple, reproducible |
| Risk | the policy games the learned reward model | as the policy changes, the fixed pairs describe it less well (unsourced) |

DPO has a failure mode of its own. TRL's docs note that in practice DPO widens the margin mostly by making the *rejected* answer less likely, not the chosen one more likely. If the log-probability of chosen answers (`logps/chosen`) falls while the margin (`rewards/margins`) climbs, the model is drifting away from both answers. Remedies: add an SFT term on the chosen answers (`DPOConfig(loss_type=["sigmoid", "sft"], loss_weights=[...])`), raise β, or train fewer epochs. Rafailov et al. later showed that DPO-style methods still over-optimize: quality degrades at larger KL budgets, often before one epoch is done. Removing the reward model does not remove the problem.

TRL's current release (v1.14) reflects this shift: SFT, DPO, KTO, GRPO, RLOO, and reward modeling are core trainers, ORPO and CPO live under `trl.experimental` (KTO, GRPO, and ORPO are covered under Newer methods below; RLOO, REINFORCE Leave-One-Out, is an online RL method that, like GRPO, needs no value model; CPO, Contrastive Preference Optimization, is a DPO variant with no reference model), and the trainer list has no PPO trainer.

**Reward hacking** is the policy raising its reward in ways that do not make answers better. The reward is only a proxy for what people want, learned from limited data, and optimization finds the proxy's blind spots (Goodhart's law: a measure pursued as a target stops measuring). Gao et al. measured it with a "gold" reward model standing in for humans: as the policy moved further from its starting point, the proxy reward kept rising while the gold reward rose, peaked, then fell; the curves scale predictably with reward-model size.

- **What it looks like** — answers grow longer; tone turns confident or flattering; formatting pleases the scorer; with a rule-based reward, output satisfies the checker without solving the task, such as a correct-looking final line on wrong working (unsourced examples).
- **How to detect it** — plot the training reward against a held-out quality score from humans or a strong judge of another model family; divergence is the signal. Track answer length over training, and read samples at every checkpoint.
- **How to limit it** — the KL penalty β; early stopping on the held-out score; length normalization (TRL's `loss_type="sigmoid_norm"`, the fix for DPO's length bias from SimPO, a reference-free DPO variant); verifiable rewards, such as unit tests or exact answers, wherever the task allows.

**Alignment tax** is the loss of ability on some tasks that alignment training causes. InstructGPT's RLHF regressed on SQuAD, DROP, HellaSwag, and WMT 2015 French-to-English: public question-answering, reading-comprehension, common-sense, and translation benchmarks. Its fix, **PPO-ptx**, mixed updates that raise the likelihood of pretraining data into the PPO updates; that greatly reduced the regressions without lowering labeler preference scores. Your own SFT or DPO run pays the same tax on a smaller scale, as forgetting (G4.5): measure it with a regression suite and limit it with general data in the mix, a KL anchor (a penalty for drifting from the starting model, as β above), and LoRA.

**Newer methods.** Each changes what data is needed or what sits in memory:

| Method | Data | Models in memory | Idea | In TRL v1.14 |
|---|---|---|---|---|
| **ORPO** (Hong et al., 2024) | chosen/rejected pairs | policy only | adds an odds-ratio penalty on the rejected answer to the ordinary SFT loss, so SFT and preference alignment happen in one stage with no reference model | `trl.experimental.orpo.ORPOTrainer`; the paper's λ is `beta`, default 0.1 |
| **KTO** (Ethayarajh et al., 2024) | single answers labeled desirable or not (`label: True/False`) | policy and reference | maximizes a utility modeled on prospect theory, Kahneman and Tversky's model of human choice, where losses weigh more than gains; matched or beat preference-based methods from 1B to 30B | `trl.KTOTrainer`; balance classes with `desirable_weight` and `undesirable_weight` to a 1:1 to 4:3 ratio |
| **GRPO** (Shao et al., 2024) | prompts and reward functions | policy, plus a reference only if β > 0 | PPO without the value model: sample a group of answers per prompt and use the group's mean reward as the baseline | `trl.GRPOTrainer`; defaults `num_generations=8`, `beta=0.0` (no reference loaded), `loss_type="dapo"` (the token-level loss of DAPO, a GRPO refinement); `use_vllm=True` speeds up generation |

KTO fits production feedback: thumbs up and down arrive one answer at a time, never as pairs. TRL's KTO guide asks for at least 4 examples per step, so the KL estimate is sound, and a learning rate between 5e-7 and 5e-6 at the default β of 0.1.

**GRPO's advantage.** An **advantage** says how much better one answer was than expected for its prompt; the update raises the probability of answers with a positive advantage and lowers the rest. GRPO takes the expectation from the group itself: A_i = (r_i − mean(r)) / std(r). Four answers to one math problem, reward 1 if correct: rewards (1, 0, 0, 0) give mean 0.25 and standard deviation 0.5 (TRL uses the sample standard deviation), so advantages (+1.5, −0.5, −0.5, −0.5). A rare correct answer gets a strong push. If all four are right, or all wrong, every advantage is 0 and the prompt teaches nothing, so prompts must be hard enough to fail sometimes and easy enough to pass sometimes. TRL logs the share of such groups as `frac_reward_zero_std`. DeepSeek-R1-Zero, a reasoning model from DeepSeek, was trained this way, with GRPO and a reward based only on whether final answers matched the ground truth, and developed long reasoning without any SFT first.

**Choosing a method by the data you have:**

- demonstrations of ideal answers → **SFT**;
- chosen/rejected pairs → **DPO** as the default, or **ORPO** to fold SFT in and save the reference model's memory (experimental in TRL);
- unpaired thumbs up/down from production → **KTO**;
- an automatic checker (unit tests, exact answers, a JSON schema, SQL that must run) → **GRPO**, or Bedrock's reinforcement fine-tuning with reward functions in Lambda, AWS's service for running code without servers (G4.7);
- large-scale human rankings and a team to run RL infrastructure → **RLHF with PPO**.

**In an interview**

- *Why did most teams move from RLHF with PPO to DPO?* DPO solves the same KL-constrained objective in closed form, so it trains on preference pairs with a classification loss: no reward model, no generation during training, two models in memory instead of four, and far fewer settings to tune. The trade-off is that it learns only from a fixed dataset, while PPO learns from its own current answers. For verifiable tasks the field has swung back toward online RL with GRPO, which drops PPO's value model and scores answers with rules.
- *What is reward hacking, and how would you catch it?* The policy finds outputs the reward scores highly that are not actually better, such as longer or more flattering answers, because the reward model is an imperfect proxy. I would track the training reward against a held-out quality score from humans or a judge of a different model family, watch answer length, and read samples per checkpoint; a rising reward with a flat or falling held-out score is the signature. The fixes are a KL penalty, early stopping on the held-out score, length normalization, and verifiable rewards where possible.

Sources: [Ouyang et al., InstructGPT paper](https://arxiv.org/abs/2203.02155) · [Shao et al., DeepSeekMath (GRPO)](https://arxiv.org/abs/2402.03300) · [Rafailov et al., DPO paper](https://arxiv.org/abs/2305.18290) · [Rafailov et al., overoptimization in direct alignment algorithms](https://arxiv.org/abs/2406.02900) · [Gao et al., Scaling Laws for Reward Model Overoptimization](https://arxiv.org/abs/2210.10760) · [Hong et al., ORPO paper](https://arxiv.org/abs/2403.07691) · [Ethayarajh et al., KTO paper](https://arxiv.org/abs/2402.01306) · [DeepSeek-AI, DeepSeek-R1 paper](https://arxiv.org/abs/2501.12948) · [TRL documentation index (trainer taxonomy)](https://huggingface.co/docs/trl/index) · [TRL — DPO Trainer](https://huggingface.co/docs/trl/dpo_trainer) · [TRL — KTO Trainer](https://huggingface.co/docs/trl/kto_trainer) · [TRL — ORPO Trainer](https://huggingface.co/docs/trl/orpo_trainer) · [TRL — GRPO Trainer](https://huggingface.co/docs/trl/grpo_trainer) · [TRL — GRPO trainer source (advantages, `frac_reward_zero_std`)](https://github.com/huggingface/trl/blob/main/trl/trainer/grpo_trainer.py) · [Amazon Bedrock — model customization methods](https://docs.aws.amazon.com/bedrock/latest/userguide/custom-models.html)
