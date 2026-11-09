---
title: Influenced a team decision
---

The story shows a decision you changed without owning it (G7.5 L1). Written down, the Action carries the other side's reasons, your evidence, and how you presented it.

**Template: influenced a team decision.**

- **Situation** — The decision, and who owned it: ___. What the team leaned toward, and why that was reasonable: ___.
- **Task** — My role, and why the outcome mattered to me: ___.
- **Action**:
  - How I learned the other side's reasons first: ___
  - The evidence I built (a prototype, a benchmark, a cost table, a written comparison): ___
  - How I presented it, and to whom: ___
  - The objection I had to answer, or the point where I changed my own view: ___
- **Result** — The decision made: ___. Its effect later on cost, time, or quality, with a number: ___. The relationship with those who disagreed: ___.

Results that suit this story: cost or time saved by the chosen option, a risk avoided, and whether the decision still stands. Run the checklist in G7.1 over it.

**Illustrative example** — fictional, set in AI engineering to show the shape. It is not the owner's story.

**Situation.** Our team was starting a document-search system for a bank, and the architect proposed a dedicated vector database, a separate system built only to store embeddings and search them by similarity, next to the bank's existing PostgreSQL.

**Task.** The decision was his, but I would build the data layer, and I thought a second database added cost and a security review the timeline could not absorb.

**Action.** I first asked the architect what worried him about Postgres: query speed at scale. So I ran a one-day benchmark with 5 million chunks in pgvector under an HNSW index, an approximate index that finds near neighbors fast by checking only part of the vectors. I measured recall (the share of the true nearest neighbors it found) and p95 latency against exact search, which compares the query with every vector (G1.7). I wrote a one-page comparison covering latency, cost, the bank's existing backups and access controls, and the point where a dedicated database would win. I presented it at the design review and proposed revisiting the choice at 50 million vectors.

**Result.** The team chose pgvector. Search ran at 40 ms p95 with 0.96 recall, the bank skipped a new security review, and we saved an estimated three weeks. The architect and I later wrote the revisit trigger into the design document together.
