---
title: Improved performance or accuracy through analysis
---

This is the most technical of the six stories: the job description's "analyze recurring patterns in model performance" (goal.md) makes it likely, and follow-ups tend to turn it into a technical discussion of metrics (G2.2) and error analysis (G2.5). The interviewer tests whether the analysis was rigorous, so every number you say is one you may have to defend.

**Delivery.** Spend the Action on the diagnosis, in its order: baseline, how you searched, the largest cause, the fix, how you verified. Say at most three numbers in the two minutes, rounded: the baseline, the size of the largest cause, and the result. A listener cannot hold more. The headline carries the before and after; for the L2 illustrative example: "I raised a RAG assistant's accuracy from 71% to 81% by finding that half its failures were retrieval misses on part numbers."

**Where this story goes wrong:**

- **A result with no baseline.** "Accuracy improved a lot" cannot be checked.
- **A guess justified afterwards.** The fix came first and the data was found to support it, so the story shows no analysis.
- **All the credit.** Claiming the whole gain when other changes shipped at the same time; a follow-up on causation exposes it.
- **Measuring on the data you tuned on.** The gain is then partly memorization (G2.3), and an interviewer who knows ML will ask.
- **Only the technical metric.** Leaving out what the gain meant for the client: cost, trust, time saved.

**In an interview** — likely follow-ups, and what a strong answer does:

- **"How did you measure it, and on what data?"** — Name the metric, the eval set and its size, and that it was held out from tuning or taken from production.
- **"How do you know your change caused the gain?"** — Same data before and after, one change at a time, or an A/B test in production. Mention anything else that changed in the period and why it does not explain the gain.
- **"What did you try that didn't work?"** — A hypothesis the data ruled out. It shows the method was real.
- **"What was left, and what would you do next?"** — The next largest failure group from your tags, and why you stopped where you did: the target was met, or the next fix cost more than it returned.
- **"How did you present the findings?"** — The table of causes and counts you showed the team or client, and the decision it led to (G2.5 L3).
