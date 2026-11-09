---
title: Improved performance or accuracy through analysis
---

The story shows a gain found through evidence (G7.3 L1). Written down, it needs a before-and-after number and the analysis between them; error analysis (G2.5) gives the steps.

**Template: improved through analysis.**

- **Situation** — The system and the problem, with its number: ___. Who felt it: ___.
- **Task** — My goal and the target: ___.
- **Action**:
  - The baseline I measured, and how: ___
  - How I searched for the cause (sliced by segment, tagged failures, profiled, read the query plan): ___
  - What the data showed as the largest cause: ___
  - The fix, and the obvious fix I skipped, and why: ___
  - How I checked the gain was real (the same eval set, held-out data the system was never tuned on, an A/B test that serves two versions to split traffic and compares them, production): ___
- **Result** — Before and after: ___. The effect on users, the client, or cost: ___. What was left for later: ___.

Results that suit this story: the metric before and after on the same data, p95 latency, cost per request, the share of failures removed. Run the checklist in G7.1 over it, and make sure your share of the gain is separate from other changes shipped at the same time.

**Illustrative example** — fictional, set in AI engineering to show the shape. It is not the owner's story.

**Situation.** A RAG (retrieval-augmented generation) assistant I maintained for an electronics manufacturer, which retrieves relevant document passages and has an LLM answer from them (G4.1), answered 71% of our 300-question eval set correctly, and the client's engineers had stopped trusting it.

**Task.** I had a month to raise accuracy above 80%. The team's first idea was a larger model.

**Action.** Before changing anything, I tagged all 87 failed answers by cause. Almost half, 42, were retrieval misses, where the passage holding the answer was never retrieved, and most of those asked about part numbers such as "XR-450", which vector search matched poorly. Only 13 were answers that ignored good context, the kind a larger model would fix. So I kept the model and added keyword search next to vector search, merging the two result lists with Reciprocal Rank Fusion, which scores each passage by its rank in both lists (G1.7). I reran the full eval and checked that no question type got worse.

**Result.** Retrieval misses fell from 42 to 12, and accuracy rose from 71% to 81%. Cost per question stayed flat because we kept the smaller model. The tagged failures became our regression set, which the team runs on every change to catch answers that get worse.
