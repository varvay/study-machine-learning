---
title: CI/CD and evaluation gates
---

An offline eval gate (L2) tests a change on saved questions. Production traffic holds questions the eval set lacks, so the release itself must also limit how many users a bad change can reach, and how fast it can be undone.

**What a release is.** In an LLM app, the unit that ships is not only the code; it is a **release manifest**: every setting that changes answers, pinned together and versioned as one.

```yaml
release: 2026-10-01.3
model: eu.anthropic.<pinned model version from the Bedrock console>
prompt: claims-assistant@v14
retrieval:
  index: chunks_titan_v2_2026_09
  top_k: 5
  similarity_threshold: 0.6
guardrail: claims-guardrail@version-7
eval_run: evals/2026-10-01.3.json
```

Rolling back means pointing production at the previous manifest. Anything the manifest does not pin, such as a model alias the provider can move, is a change that ships without a gate.

**Shadow deployment.** The candidate receives a copy of live requests, and its answers are logged but never shown. SageMaker AI shadow tests do this for endpoints: they route a copy of each request to a shadow variant and return only the production variant's response. For a Bedrock-backed app, the app itself sends a sampled copy of each request to the candidate manifest, off the user's path. Three rules make shadowing safe and useful:

- **No side effects** — the shadow must not call tools that act: no emails, no tickets, no database writes. Give it read-only tools or stubs (stand-ins that return a canned result and act on nothing), or a shadowed agent sends every email twice.
- **Compare offline** — shadow answers have no user feedback, so an LLM judge compares each shadow answer with the production answer to the same question, pairwise.
- **Budget it** — each shadowed request is billed again. Sample, such as 10% for a day, not 100% for a week.

Shadowing finds crashes, latency, cost, and format breaks at full scale with no user risk. It cannot measure user reactions; the canary does.

**Canary deployment.** A **canary** sends a small share of real users to the candidate while the current version (the **control**) serves the rest, and widens the share in stages if nothing degrades. Both groups run at the same time, so a comparison between them cancels out whatever else changed that hour; a before/after comparison cannot. The gate watches three kinds of signal:

- **Service health** — error rate, throttles, time to first token, p95 latency. These are fast and low-noise, and catch a broken release in minutes.
- **Quality** — the share of sampled answers an LLM judge passes, groundedness (whether each answer is supported by its retrieved chunks), the refusal rate, the thumbs-down rate (G6.6). These are what an LLM release changes most, and they are noisy.
- **Cost** — tokens per request. A prompt that doubles answer length passes on quality and fails on the bill.

Quality is a pass rate estimated from a sample, so each window's difference between canary and control comes with a **confidence interval**, the range the true difference most likely lies in. With a pass rate p and n judged answers per version, the interval for the difference is about ±1.96 × √(p₁(1−p₁)/n₁ + p₂(1−p₂)/n₂). Two consequences drive the design:

- **A small canary cannot see quality.** At 5% of 2,000 judged answers, the canary contributes 100, and its interval is about ±7 points wide: a drop from 85% to 78% hides inside it. Early stages therefore catch only large or certain harm, and quality is proven at a larger share.
- **Proving "no worse" takes volume.** To detect a 2-point drop from 85% with 80% power (an 80% chance of catching a real drop) at the 5% level (a 5% chance of a false alarm) takes about (1.96 + 0.84)² × (2 × 0.85 × 0.15) / 0.02² ≈ 5,000 judged answers per version. At the G6.1 client's 30,000 questions a day, a 50% split gets there in under a day only if the judge scores a third of all answers; sampling fewer means a longer canary.

So the gate states a **margin**, the largest drop the client accepts, and asks a different question per stage: at 5% and 25%, "is it confidently worse by more than the margin?" (roll back if yes); at 50%, "is it proven to be within the margin?" (promote only if yes). At 100% there is no control left, so the proof has to come before it. The walkthrough below runs this gate.

Three practical rules:

- **Sticky assignment** — assign by user or conversation, hashed, not by request. A conversation that switches prompt versions mid-way gives the user inconsistent answers and makes the judge's scores meaningless.
- **Automate the rollback** — SageMaker AI deployment guardrails shift traffic in canary or linear steps, watch CloudWatch alarms for a baking period (a wait after each step), and roll back automatically when one fires. On Kubernetes, Argo Rollouts (a controller that runs staged releases) runs `AnalysisTemplate` queries (for example against Prometheus) between `setWeight` steps, and aborts to the stable version when the analysis fails. Publish the judge's pass rate as a metric, and the same machinery gates on quality.
- **One canary at a time** — two overlapping canaries contaminate each other's control group.

**Rollback, and what does not roll back.** Pointing traffic back at the old manifest takes seconds. Some effects outlive it:

- **State written by the bad version** — chat memory holding its answers, and cache entries (G6.8). Key caches by release, so a rollback leaves the bad version's entries behind.
- **The index** — a new embedding model or chunking means a new index. Keep the old one until the new release has fully passed; rolling back to a deleted index means a multi-hour re-ingestion (G6.3).
- **Actions** — emails sent and tickets filed by a bad agent release stay done. Agent tools with side effects need human approval during a canary (G5.5).
- **Provider changes** — a managed model version is eventually marked legacy and retired; Bedrock's `LegacyModelInvocations` metric counts calls to legacy models. The replacement goes through the same gate and canary as any other change.

**Eval gate thresholds by change type.** Each kind of change breaks different things, so each gets its own checks and its own bar:

| Change | Checks before release | Bar to pass |
|---|---|---|
| **Model** (new model or version) | full answer eval set, safety and prompt-injection set, format and tool-call tests, latency and cost per request | no drop beyond the margin on quality; zero new failures on safety; cost and p95 within budget. Then a canary. |
| **Prompt** | full answer eval set, paired against the current prompt on the same questions, plus the regression cases from past incidents | the paired difference is not significantly negative (McNemar's test or a bootstrap, both ways to test whether paired pass/fail results really differ; G2.2 L3); no previously fixed case fails again |
| **Retrieval** (chunking, embedding model, top-k, reranker) | retrieval metrics first, on questions labeled with their correct documents: recall@k (the share of correct documents found in the top k), MRR (mean reciprocal rank: 1 divided by the rank of the first correct document, averaged over questions); then the answer eval | recall@k not lower; answer quality within the margin. An embedding model change is gated on the new index before the switch (G6.3). |
| **Documents** (new or changed content) | a smoke test: known questions about the changed documents, and access-control checks | the smoke questions answer correctly, and no chunk is retrievable by a user outside its ACL groups (G6.7) |

Setting the numbers:

- **Measure the noise first.** Run the unchanged release through the eval twice; the judge and the model are stochastic, so scores move by themselves. A threshold tighter than that run-to-run spread fails good releases at random.
- **Relative and absolute bars together.** A relative bar ("no worse than production minus the margin") stops regressions; an absolute floor ("never below 80%") stops slow drift across many small, individually acceptable drops.
- **Zero tolerance where harm is certain** — a single answer that leaks personal data or follows an injected instruction fails the release, whatever the average.
- **Calibrate the judge** — an LLM judge agrees with human raters at about the rate humans agree with each other in one well-known study (over 80%), but it is swayed by the order the answers are listed in (position bias), by longer answers (verbosity bias), and by answers from its own model (self-enhancement bias). Check it against a set of human labels, and randomize answer order in pairwise comparisons.

Sources: [SageMaker AI shadow tests](https://docs.aws.amazon.com/sagemaker/latest/dg/shadow-tests.html) · [SageMaker AI deployment guardrails](https://docs.aws.amazon.com/sagemaker/latest/dg/deployment-guardrails.html) · [Argo Rollouts analysis](https://argo-rollouts.readthedocs.io/en/stable/features/analysis/) · [Google SRE Workbook — Canarying releases](https://sre.google/workbook/canarying-releases/) · [Sample size for comparing two proportions](https://select-statistics.co.uk/calculators/sample-size-calculator-two-proportions/) · [Two-proportion z-test](https://en.wikipedia.org/wiki/Two-proportion_Z-test) · [Bedrock runtime metrics (`LegacyModelInvocations`)](https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-runtime-metrics.html) · [Zheng et al., Judging LLM-as-a-Judge](https://arxiv.org/abs/2306.05685) · [Langfuse evaluation (experiments in CI)](https://langfuse.com/docs/evaluation/overview)

**In an interview**

- *How do you roll out a new prompt safely when quality is what might break?* I ship it as a new release manifest behind the offline gate, then canary it with sticky assignment per conversation, and have an LLM judge score a sample from both groups. Small stages only roll back on confident harm, because at 5% the interval is several points wide; promotion to 100% requires proof at 50% that it is within an agreed margin of the control. Latency, errors, and cost per request are gated at every stage, and rollback is automatic.
- *Your eval gate blocks a release that looks fine by hand. What do you check?* First the noise: I rerun the current production release through the same eval, because a stochastic model and judge move scores by a point or two on their own. If the threshold is tighter than that spread, the gate is flipping coins. Then I look at the failing cases paired against production, since a real regression shows up as specific questions that flipped, not as a small average drop.
