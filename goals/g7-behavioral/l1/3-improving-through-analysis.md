---
title: Improved performance or accuracy through analysis
---

**What this question tests.** **Improving through analysis** means finding from evidence why a system is slow or wrong, fixing the largest cause, and proving the gain. The evidence is measurements, logs, or a sample of failures. The job description asks for someone who can "analyze recurring patterns in model performance" (goal.md), which is error analysis: collecting the model's failures, grouping them by cause, and fixing the largest group first (G2.5). The interviewer listens for method: a baseline, a measurement, a cause found in the data, a targeted change, and a before-and-after number.

Either kind of improvement fits:

- **Performance** — speed, throughput (work done per second), or cost: query latency (the time one request takes), pipeline runtime, the monthly cloud bill.
- **Accuracy** — how often the output is right: a model metric, an error rate, data quality.

The system need not be a model. A slow SQL query fixed by reading its query plan, the steps the database chose to run it (G1.2), uses the same method.

**How it is asked:**

- "Tell me about a time you improved a system's performance."
- "Describe how you found the root cause of a quality problem."
- "Give an example of using data to decide what to fix."

**Questions to find your story:**

- What did I make faster, cheaper, or more accurate, and do I know the numbers before and after?
- How did I find the cause: what did I measure, slice by segment (split the metric by user group or input type), profile (measure where the time goes), or read?
- Was there an obvious fix I skipped because the data pointed elsewhere?
- Did I check that the gain held, on new data or in production weeks later?
- Who benefited: users, the client, the team's costs?

**A strong pick** has a number before and after, and a cause you found in the data before changing anything. A fix with no measurement shows delivery, which is G7.1.
