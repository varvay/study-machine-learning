---
title: Knew when to seek guidance
---

The story shows judgment about when to ask (G7.2 L1). Written down, the Action must carry the moment of decision: what you tried, the signal, and what you brought to the person you asked.

**Template: knew when to seek guidance.**

- **Situation** — The problem, and why it was complex: ___. What was at stake for the client or team: ___.
- **Task** — What I was responsible for solving: ___. By when: ___.
- **Action**:
  - What I tried first on my own, and the timebox I set: ___
  - The signal that told me to ask (timebox spent, not my decision, someone already knew, costly to get wrong): ___
  - Whom I asked, and why them: ___
  - What I brought: what I had tried, the evidence, my best guess, the options: ___
  - What I did with the answer: ___
- **Result** — How fast it was solved after asking, or what it avoided: ___. What I now do earlier or later: ___.

Results that suit this story: time to resolve against the timebox, a delay or incident avoided and its likely cost, a practice the team adopted afterwards. Run the checklist in G7.1 over it.

**Illustrative example** — fictional, set in AI engineering to show the shape. It is not the owner's story.

**Situation.** I was preparing a dataset to fine-tune a small model that routes insurance claims for a client. Two days before the training run, I found that about 6% of the 12,000 examples contained policyholder names and phone numbers in free-text fields.

**Task.** I owned the dataset and the training schedule.

**Action.** I spent half a day on what I could settle myself: I scanned every example to count the affected rows, and tested a redaction step on a sample. Whether redacted personal data could be used for training at all was not my call; it depended on the client's data agreement. So I went to my lead that afternoon with a one-page note: what I found, how many rows, the redaction I had tested, and two options: train on redacted data, or drop the rows and lose 6% of the examples. She took it to the client's data protection officer, the person accountable for its handling of personal data, who chose redaction with a written sign-off.

**Result.** Training started one day late, with approval on record, and the model scored within one point of the planned baseline. I now scan every dataset for personal data before the schedule is agreed.
