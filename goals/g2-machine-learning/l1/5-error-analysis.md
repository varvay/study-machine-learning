---
title: Error analysis
---

**Error analysis** is studying a model's failures one by one to find where it fails most, so the next fix targets the biggest problem. One overall score hides where errors cluster: 92% accuracy can hide 70% on one kind of input.

The routine:

1. **Collect** a sample of failures, such as 100 wrong answers.
2. **Tag** each with its cause, read from the failure itself.
3. **Count** the tags.
4. **Fix** the largest group first, then measure again.

A RAG assistant (retrieval-augmented generation: it fetches passages from documents and passes them to an LLM with the question; G1.7) might tag its 100 failed answers like this:

| Cause | Count | Where the fix goes |
|---|---|---|
| retrieval missed the right document | 46 | chunking, embeddings, hybrid search (G1.7) |
| answer ignored the retrieved text | 22 | prompt, or a stronger model |
| document out of date | 18 | data: re-ingest sources |
| wrong format | 14 | prompt, structured output (making the model answer in a fixed format such as JSON; G3.5) |

Here tuning the prompt first would address at most 36 of the 100; retrieval holds almost half.

**Slicing** — computing a metric separately for each segment of the data, such as each country, device, or document type. It finds weak segments without reading every failure, and tells error analysis where to sample.
