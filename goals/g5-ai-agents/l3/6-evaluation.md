---
title: Trusting the judge, gating releases, watching production
---

L2 built a task test set, an LLM-as-judge rubric, and tracing. Each raises a question at this level: how far to trust the judge's scores, how to stop a bad change from shipping when every run gives a different answer, and how to keep measuring once real users arrive.

**Calibrating the judge.** An LLM judge is a classifier: it labels each trajectory pass or fail, so it has error rates like any classifier (G2.2), and until they are measured its scores are opinions. Calibration measures them against people:

1. **Label** — domain experts mark a sample of trajectories pass or fail, each with a one-line reason. Take the sample from real traffic and include plenty of failures.
2. **Split** — a development part to tune the judge's prompt on, and a test part scored once at the end, for the same reason as any model (G2.3): a judge tuned on its test set looks better than it is.
3. **Measure** — the judge's **true positive rate** (TPR: of the truly passing runs, the share it passes) and **true negative rate** (TNR: of the truly failing runs, the share it fails). Plain agreement misleads: if 90% of runs pass, a judge that always says "pass" agrees 90% of the time and catches no failures. **Cohen's kappa** gives one agreement number corrected for chance: 1 is perfect agreement, 0 is no better than chance.
4. **Improve** — one criterion per judge, a binary verdict, a rubric with examples of failures, and reasoning written before the verdict. Re-measure after each change.
5. **Correct the reported score** — a judge with known TPR and TNR gives a biased pass rate, and the bias can be removed. If the judge passes a share p of runs, the true pass rate θ is θ = (p + TNR − 1) / (TPR + TNR − 1). With TPR 0.95 and TNR 0.60, a judge reporting 78.5% means a true pass rate of (0.785 + 0.60 − 1) / (0.95 + 0.60 − 1) = 0.70. This is the Rogan–Gladen correction from epidemiology; Lee et al. (2025) apply it to LLM judges and add confidence intervals, the range the true rate likely lies in.

Known biases to design against: LLM judges favor the first answer shown (**position bias**), longer answers (**verbosity bias**), and answers from their own model (**self-enhancement bias**), even though a strong judge matched human preferences over 80% of the time, as often as two humans agree (Zheng et al., 2023). Swap the order in pairwise comparisons, where the judge picks the better of two answers, use a judge from another model family, and pin the judge's model version: a new judge model needs a new calibration.

For agents, use the judge last. Anthropic's advice is to grade the **outcome** (the final state of the environment) over the path, because agents find valid paths the eval's author did not foresee. Check the outcome with code where possible (the record exists, the tests pass, the refund equals the order value), and ask the judge only about what code cannot check, such as the tone of a customer email.

**Evals in CI** (continuous integration, the pipeline that builds and tests every change; G6.5) — running the eval suite automatically on every change that can alter the agent's behavior (prompt, tool definition, model version, retrieval settings, framework upgrade) and blocking the release when it regresses. In tiers:

- **On every pull request** — fast, deterministic tests: tool schemas are valid, prompts render, the loop logic works against a mocked model, a stand-in that returns canned replies.
- **On changes to the agent** — a **regression suite**: tasks the agent already solves, expected to pass nearly 100% of the time, run against the real model.
- **Nightly** — a **capability suite**: hard tasks with low pass rates, tracking progress rather than gating.
- **Always 100%** — safety tasks as hard gates: injection attempts (G5.5), forbidden actions, cross-user data. One failure blocks the release.

Non-determinism is what makes agent CI hard. Run each task k times and report both **pass@k** (at least one of k trials succeeds) and **pass^k** (all k succeed); a customer-facing agent needs pass^k, because every user gets one try. Small suites are noisy: with 50 tasks and an 80% pass rate, the 95% confidence interval is about ±11 points (1.96 × √(0.8 × 0.2 / 50) ≈ 0.11), so a 5-point drop may be chance. Compare the new version and the baseline on the same tasks, and grow the suite where decisions are close. Anthropic suggests starting with 20–50 tasks drawn from real failures.

Keep each trial reproducible: tools run in a sandbox seeded with the same fake data and reset between trials, external APIs are recorded fixtures (saved responses replayed in each trial), and the dataset, judge prompt, and judge model are versioned with the code. In the Spring AI stack, the `Evaluator` interface (with `RelevancyEvaluator` and `FactCheckingEvaluator`) runs inside JUnit tests; on AWS, AgentCore Evaluations offers on-demand runs for CI (generally available since March 2026).

**Online eval from production traces** — scoring live traffic continuously, because offline sets never cover everything users do. Its signals:

- **Implicit** — users retry or rephrase, abandon a session, edit or reject a draft, escalate to a person.
- **Explicit** — ratings and written feedback, rare and skewed towards the unhappy.
- **Outcome** — the ticket reopened, the payment reversed. The truest signal, and it often arrives weeks later (G2.6).
- **Operational** — steps and cost per task, tool error rates, policy denials, loops cut off by caps.
- **Judged** — the calibrated judges run on a sample of traces.

Sample on purpose: all flagged or failed runs, more from risky or new kinds of task, and a random slice for an unbiased trend. Redact personal data before traces reach a judge or a reviewer, and restrict who can read traces. AgentCore Evaluations' online mode samples and scores live traces; Langfuse, LangSmith, and Arize Phoenix (L2) do the same on their own traces.

Online and offline eval form one loop: production failures are reviewed and labeled (error analysis, G2.5), become new test cases, and the grown suite gates the next release.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 275" role="img" aria-labelledby="evaluation-loop-title">
<title id="evaluation-loop-title">The evaluation loop: production traces are sampled and judged; failures are reviewed and become test cases that gate the next release</title>
<rect class="fold-train" x="20" y="30" width="160" height="62" rx="8" />
<text class="table-name" x="32" y="54">Production traces</text>
<text class="key-tag" x="32" y="74">every run, redacted</text>
<rect class="fold-train" x="213" y="30" width="160" height="62" rx="8" />
<text class="table-name" x="225" y="54">Sample</text>
<text class="key-tag" x="225" y="74">failures, risky, random</text>
<rect class="fold-test" x="406" y="30" width="160" height="62" rx="8" />
<text class="table-name" x="418" y="54">Checks and judges</text>
<text class="key-tag" x="418" y="74">code, then LLM judge</text>
<rect class="fold-train" x="599" y="30" width="141" height="62" rx="8" />
<text class="table-name" x="611" y="54">Dashboards</text>
<text class="key-tag" x="611" y="74">pass rate, cost</text>
<rect class="dimension-head" x="406" y="190" width="160" height="62" rx="8" />
<rect class="table-outline" x="406" y="190" width="160" height="62" rx="8" />
<text class="table-name" x="418" y="214">Human review</text>
<text class="key-tag" x="418" y="234">error analysis, labels</text>
<rect class="fold-train" x="213" y="190" width="160" height="62" rx="8" />
<text class="table-name" x="225" y="214">Offline test set</text>
<text class="key-tag" x="225" y="234">versioned tasks, outcomes</text>
<rect class="fold-test" x="20" y="190" width="160" height="62" rx="8" />
<text class="table-name" x="32" y="214">CI eval gate</text>
<text class="key-tag" x="32" y="234">blocks a regression</text>
<path class="key-link" d="M180,61 L213,61" /><path class="key-link" d="M207,57 L213,61 L207,65" />
<path class="key-link" d="M373,61 L406,61" /><path class="key-link" d="M400,57 L406,61 L400,65" />
<path class="key-link" d="M566,61 L599,61" /><path class="key-link" d="M593,57 L599,61 L593,65" />
<path class="key-link" d="M456,92 L456,190" /><path class="key-link" d="M452,184 L456,190 L460,184" />
<text class="note" x="448" y="145" text-anchor="end">failures</text>
<path class="key-link" d="M526,190 L526,92" /><path class="key-link" d="M522,98 L526,92 L530,98" />
<text class="note" x="534" y="138">labels calibrate</text>
<text class="note" x="534" y="154">the judge</text>
<path class="key-link" d="M406,221 L373,221" /><path class="key-link" d="M379,217 L373,221 L379,225" />
<path class="key-link" d="M213,221 L180,221" /><path class="key-link" d="M186,217 L180,221 L186,225" />
<path class="key-link" d="M100,190 L100,92" /><path class="key-link" d="M96,98 L100,92 L104,98" />
<text class="note" x="108" y="145">release</text>
</svg>
</div>
<figcaption>Online and offline evaluation as one loop. Shaded boxes are automated scoring; the amber box is people. Human labels both grow the test set and calibrate the judge.</figcaption>
</figure>

**In an interview**

- *How do you know your LLM judge is right?* I treat it as a classifier: experts label a few hundred real trajectories, and I measure the judge's true positive and true negative rates on a held-out part, not just raw agreement. I tune the prompt on the rest, pin the judge model, and re-calibrate when it changes. I report pass rates corrected with those rates, and check outcomes with code wherever I can.
- *How do you stop a prompt change from breaking the agent in production?* Every change to prompts, tools, or model runs a regression suite in CI, several trials per task, compared with the baseline on the same tasks, and safety tasks are hard gates at 100%. After release, online evaluation samples live traces, and each new failure becomes a test case, so the suite grows from real use.

Sources: [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) · [Zheng et al., Judging LLM-as-a-Judge](https://arxiv.org/abs/2306.05685) · [Lee et al., How to correctly report LLM-as-a-judge evaluations](https://arxiv.org/abs/2511.21140) · [Rogan & Gladen, Estimating prevalence from the results of a screening test](https://doi.org/10.1093/oxfordjournals.aje.a112510) · [scikit-learn — cohen_kappa_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.cohen_kappa_score.html) · [Yao et al., τ-bench (pass^k)](https://arxiv.org/abs/2406.12045) · [Spring AI — Evaluation testing](https://docs.spring.io/spring-ai/reference/api/testing.html) · [AgentCore Evaluations is generally available](https://aws.amazon.com/about-aws/whats-new/2026/03/agentcore-evaluations-generally-available)
