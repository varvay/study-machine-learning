---
title: Gave or received tough feedback
---

The story shows feedback that was hard to hear, and what changed because of it (G7.4 L1). The template has two Action variants; fill in the one for your direction.

**Template: gave or received tough feedback.**

- **Situation** — The work under review, and who gave or got the feedback: ___. Why it mattered (client deadline, production): ___.
- **Task** — My role: the one receiving it, or the one who had to raise it: ___.
- **Action, if received**:
  - The feedback, close to its own words: ___
  - My first reaction, and what I did with it: ___
  - How I checked whether it was right: ___
  - What I changed: ___
- **Action, if given**:
  - What I saw, and my evidence: ___
  - How I said it, where, and when (the SBI structure below): ___
  - How they reacted, and how I responded: ___
  - How I followed up: ___
- **Result** — What changed in the work, with a number if one exists: ___. The working relationship afterwards: ___. What I do differently now: ___.

**SBI** (Situation–Behavior–Impact) is a structure for giving feedback, from the Center for Creative Leadership. Name the specific **situation**, describe the observable **behavior** without judging it, and say its **impact**. The extended form, **SBII**, adds a fourth step: ask about the person's **intent**, which turns the talk into a conversation. For example: "In Tuesday's review (situation), the retry change merged without tests (behavior), so Thursday's outage took two hours to trace (impact). What was your plan for testing it? (intent)". Use it in the Action when you gave the feedback.

Results that suit this story: a quality number after the change, a defect or delay avoided, a practice adopted by you or the team. Run the checklist in G7.1 over it.

**Illustrative example** — fictional, set in AI engineering to show the shape. It is not the owner's story.

**Situation.** I had fine-tuned a small model to extract fields from invoices for a client, and I reported 94% field accuracy at a team review two weeks before the client demo.

**Task.** I owned the model and its evaluation.

**Action.** A senior engineer said, in front of the team, that she did not believe the number: my test invoices came from the same suppliers as the training set, so the model might be memorizing layouts. My first reaction was to defend the result, but I asked for a day to check instead. I rebuilt the test set from suppliers the model had never seen, and accuracy fell to 79%. I told the team and the client lead that day, then added 300 invoices from new suppliers to the training data.

**Result.** At the demo we showed 88% on unseen suppliers, and it held at 86% in the first month of production. I thanked her at the next review, and I now split test sets by supplier or customer before the first training run, so none appears in both training and test data (a group split, G2.3).

Source: [Center for Creative Leadership — SBI and SBII](https://www.ccl.org/articles/leading-effectively-articles/closing-the-gap-between-intent-vs-impact-sbii/)
