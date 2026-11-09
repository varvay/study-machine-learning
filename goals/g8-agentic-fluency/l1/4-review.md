---
title: Reviewing agent output
---

**Discernment** in the 4D framework is "evaluating AI outputs and behavior with a critical eye", in three parts: the **product** (is the code right?), the **process** (did the agent reach it soundly: read the right files, run the tests?), and the **performance** (how it behaved: did it stay in scope, did it say when it was unsure?).

**You own what ships.** The agent writes the code; the commit carries your name. Simon Willison's rule for himself: "I won't commit any code to my repository if I couldn't explain exactly what it does to somebody else."

**Vibe coding** is the opposite stance, named by Andrej Karpathy in February 2025: "fully give in to the vibes… and forget that the code even exists… I 'Accept All' always, I don't read the diffs anymore". He scoped it to "throwaway weekend projects". Willison draws the line: code an LLM wrote that you "reviewed, tested thoroughly and made sure you could explain how it works to someone else", is "not vibe coding, it's software development."

The errors a coding agent typically makes:

- **Invented APIs** — calls to functions, options, or packages that do not exist, blended from training data or remembered from an older version. In a study of 16 models and 576,000 code samples, 19.7% of the packages the models recommended did not exist: 5.2% for commercial models, 21.7% for open ones. Attackers register such names with malicious code, a practice called **slopsquatting** (G8.5).
- **Edits outside the task** — files or behavior the task never mentioned: a refactor on the side, a changed config, a new dependency.
- **Tests weakened to pass** — a failing test deleted, skipped, or loosened until it passes. Kent Beck lists "disabling or deleting tests" among the signs an agent is cheating.
- **"Done" without evidence** — the agent reports success without running the check, or after a check that never exercised the change. The Claude Code docs: "Have Claude show evidence rather than asserting success."
- **Insecure code** — Veracode tested over 100 models on 80 coding tasks in 2025; 45% of the generated samples failed its security checks.
- **Almost right** — code that looks plausible and is subtly wrong. In the 2025 Stack Overflow survey it was developers' top frustration with AI tools (66%): "AI solutions that are almost right, but not quite".

An agent also judges its own work too kindly. Anthropic found agents asked to grade their own output "confidently praising the work—even when… the quality is obviously mediocre", and that "separating the agent doing the work from the agent judging it proves to be a strong lever". So the review comes from you, or from a second agent with a fresh context (G8.4 L2).

Sources: [Claude Academy — A closer look at Discernment](https://academy.claude.com/courses/ai-fluency-framework-foundations/a-closer-look-at-discernment) · [Simon Willison — Not all AI-assisted programming is vibe coding (quotes Karpathy in full)](https://simonwillison.net/2025/Mar/19/vibe-coding/) · [Wikipedia — Vibe coding (date)](https://en.wikipedia.org/wiki/Vibe_coding) · [Spracklen et al., We have a package for you! (package hallucination)](https://arxiv.org/abs/2406.10279) · [Kent Beck — Augmented coding: beyond the vibes](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes) · [Claude Code — Best practices](https://code.claude.com/docs/en/best-practices) · [Veracode — 2025 GenAI code security report](https://www.veracode.com/blog/genai-code-security-report/) · [Stack Overflow Developer Survey 2025 — AI](https://survey.stackoverflow.co/2025/ai) · [Anthropic — Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
