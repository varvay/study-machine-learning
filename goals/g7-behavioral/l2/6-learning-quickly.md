---
title: Learned a new technology quickly
---

The story shows a technology learned under a deadline and put to use (G7.6 L1). Written down, the Action carries your learning method, and the Result carries what you built with it.

**Template: learned a new technology quickly.**

- **Situation** — The technology, why it was new to me, and why the project needed it: ___. The time available: ___.
- **Task** — What I had to deliver with it, and by when: ___.
- **Action**:
  - What I read first, and why that source: ___
  - The small thing I built to test my understanding: ___
  - What I got wrong at first, and how I found out: ___
  - Whom I asked, and what: ___
  - How I applied it to the real work: ___
- **Result** — What I delivered, and how fast: ___. Whether it is still used, and whether others reused my work: ___. How I learn new tools now: ___.

Results that suit this story: time from zero to a working deliverable, the deadline met, reuse by the team. Run the checklist in G7.1 over it.

**Illustrative example** — fictional, set in AI engineering to show the shape. It is not the owner's story.

**Situation.** A client wanted their Java support portal to answer questions from their product database. The team chose Spring AI and the Model Context Protocol (MCP), a standard way to connect a model to tools and data (G5.4). I had never used either, and the demo was ten days away.

**Task.** I had to build the tool layer, the functions the model can call to fetch data: an MCP server exposing three read-only database queries, called from the Spring AI chat service.

**Action.** I spent the first day on the official reference docs and the MCP specification, because the tutorials I found targeted older versions. On day two I built a throwaway app with a single tool, to learn how tool calls and their errors flow. It exposed my first mistake: I returned raw SQL errors, and the model retried the same bad call. I switched to short error messages the model could act on. I then asked a colleague who knew the client's schema to review my queries.

**Result.** The tool layer worked at the demo on day nine, and the client approved the next phase. My throwaway app became the team's starter template, reused on two later projects.
