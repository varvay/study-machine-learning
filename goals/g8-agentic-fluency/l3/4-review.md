---
title: Verification at scale, and keeping your skills
---

L2 built a review routine for one diff (G8.4 L2). When agents write most of a team's code, review becomes the bottleneck and the main control. This level looks at the evidence on quality, the system that keeps it up, and the effect on the reviewers' own skills.

**The evidence on quality.**

- **Delivery.** Google's DORA research measures software delivery with throughput (how fast changes ship) and stability (how often they fail). In the 2024 report, each 25% rise in AI adoption went with an estimated 1.5% drop in throughput and 7.2% drop in stability. In 2025, AI adoption related positively to throughput but still negatively to stability. DORA's summary: "AI doesn't fix a team; it amplifies what's already there."
- **Maintainability.** GitClear's analysis of 211 million changed lines found blocks of duplicated code grew eightfold during 2024, while "moved" lines, a sign of refactoring and reuse, fell 39.9%. Its 2026 follow-up reports refactoring down to 3.8% of changes. Both are correlations across the industry; they do not prove AI caused the change (the 2026 figures come from a secondary summary).
- **Security.** Veracode: 45% of samples from over 100 models failed security tests, and results did not improve with newer or larger models (G8.4 L1).
- **Practice.** Thoughtworks put **complacency with AI-generated code** on Hold in November 2025: "AI-driven confidence often comes at the expense of critical thinking." Its April 2026 Radar adds **codebase cognitive debt**, "the growing gap between a system's implementation and a team's shared understanding of how and why it works."

**Verification as a system.** Böckeler's harness model (G8.2 L3) orders the checks by certainty:

1. **Computational sensors, on every change** — compiler and types, tests, linters, static security analysis (SAST), dependency and licence checks. Thoughtworks lists **mutation testing** under Trial: it changes the code on purpose and checks that a test fails, which catches tests that assert nothing, a pattern agents produce when tests are weakened.
2. **Inferential sensors** — an AI reviewer with a fresh context (G8.4 L2), aimed at what the machines cannot judge: design, naming, intent.
3. **A human**, on what is left: whether the change is the right one, and the critical path.

Around them, the delivery practices DORA ties to AI benefit: small batches, strong version control, and a quality internal platform. Measure the outcome with DORA's five delivery metrics (G8.6 L3); change fail rate and rework rate show quality problems that a rising pull request count hides.

**Review capacity.** Agents multiply the number of pull requests; reviewers do not multiply. Signs of an overloaded review: approvals in minutes on large diffs, and comments only on style. The responses:

- **Smaller changes** — stacked pull requests, one concern each (G8.3 L3).
- **Evidence in the pull request** — test output and the criteria each test covers, so the reviewer checks claims, not code alone.
- **Review effort by risk** — full reading for security boundaries, data migrations, and the critical path; sampling for mechanical changes behind strong tests.
- **First-pass acceptance** — Thoughtworks suggests tracking how often an agent's change is accepted without rework, over raw throughput, which it lists under Caution as a productivity measure.

**Keeping your own skills.** Review needs the skills that delegation stops exercising. Anthropic's engineers named this the **paradox of supervision**: overseeing Claude takes the very skills that heavy use may erode.

- **The evidence.** In a 2026 randomized trial by Anthropic, 52 mostly junior engineers learned Trio, a Python library for asynchronous code. The group with AI help scored 50% on the follow-up quiz, against 67% for the group that coded by hand, a gap of 17 percentage points; the largest gap was in debugging questions. The AI group was about 2 minutes faster, not a significant difference.
- **How they used it mattered.** Participants who asked conceptual questions, asked for code with explanations, or generated code and then worked to understand it scored 65% or more. Those who delegated the task, relied on AI more and more, or debugged by pasting errors back scored under 40%.
- **Outside coding.** A field experiment with nearly 1,000 high-school maths students found that plain ChatGPT access raised practice grades by 48%, but once access was removed those students scored 17% below students who never had it; a tutor version that gave hints in place of answers largely removed that harm.

Practices that follow:

- Write the parts you must understand deeply, and the first version of anything you are learning, yourself.
- Ask Claude to explain before it implements, and to leave the implementation to you when learning is the point.
- Apply Willison's rule (G8.4 L1): you can explain every line you ship. When you cannot, that is the part to study.
- Debug by reading first. Paste the error back only after you have a hypothesis.

**In an interview**

- *Agents now write most of your team's code. How do you keep quality up?* Treat verification as a system. Every change passes the computational checks first: types, tests, linters, security scans, dependency checks, ideally mutation testing to catch empty tests. Then an AI reviewer with a fresh context, then a human on the decision and the critical path. Keep changes small, put the evidence in the pull request, and watch change fail rate and rework rate, not pull request counts. DORA's finding is that AI amplifies what is there, so the delivery basics matter more.
- *Doesn't relying on AI make engineers worse?* It can. Anthropic's trial found 17 points lower mastery when people delegated while learning, but those who used AI to ask questions and understand the code kept their learning. So I delegate what I already understand, use the agent as a tutor for what I am learning, and never ship a line I cannot explain.

Sources: [Google Cloud — Announcing the 2024 DORA report](https://cloud.google.com/blog/products/devops-sre/announcing-the-2024-dora-report) · [Google Cloud — Announcing the 2025 DORA report](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report) · [Google Cloud — DORA AI Capabilities Model](https://cloud.google.com/blog/products/ai-machine-learning/introducing-doras-inaugural-ai-capabilities-model) · [DevClass — GitClear 2025 code quality report](https://www.devclass.com/ai-ml/2025/02/20/ai-is-eroding-code-quality-states-new-in-depth-report/1626250) · [GitClear — The AI code quality maintainability gap (2026)](https://www.gitclear.com/the_ai_code_quality_maintainability_gap) · [Veracode — 2025 GenAI code security report](https://www.veracode.com/blog/genai-code-security-report/) · [Thoughtworks Radar — Complacency with AI-generated code](https://www.thoughtworks.com/en-us/radar/techniques/complacency-with-ai-generated-code) · [Thoughtworks Radar — Codebase cognitive debt](https://www.thoughtworks.com/radar/techniques/codebase-cognitive-debt) · [Thoughtworks Radar — Techniques (mutation testing)](https://www.thoughtworks.com/radar/techniques) · [Thoughtworks Radar — Coding throughput as a measure of productivity](https://www.thoughtworks.com/radar/techniques/coding-throughput-as-a-measure-of-productivity) · [Birgitta Böckeler — Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html) · [Anthropic — How AI is transforming work at Anthropic](https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic) · [Anthropic — How AI assistance impacts the formation of coding skills](https://www.anthropic.com/research/AI-assistance-coding-skills) · [Bastani et al., Generative AI without guardrails can harm learning (PNAS)](https://pubmed.ncbi.nlm.nih.gov/40560616/)
