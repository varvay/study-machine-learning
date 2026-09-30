---
title: Vector search
---

Keyword search matches the words in a query. Vector search matches its meaning: "how do I reset my password" finds a passage titled "Recovering account access" with no word in common.

- **Embedding** — a list of numbers (a vector), often hundreds or thousands long, that an embedding model computes from a piece of text, an image, or audio. The model places similar meanings near each other: "cat" lands near "kitten" and far from "invoice".
- **Similarity** — a score for how close two vectors are:
  - **cosine similarity** measures the angle between them and ignores their length: 1 means the same direction, 0 unrelated;
  - **dot product** multiplies matching numbers and adds them up, so length counts too; for vectors scaled to length 1 it equals cosine;
  - **Euclidean distance** is the straight-line distance between the two points; smaller means closer.

  Use the metric the embedding model was trained with. Many models output vectors of length 1, and then all three rank results in the same order.
- **Exact nearest-neighbor search** — compare the query vector with every stored vector and keep the closest. The answer is always right, but the work grows with every vector added.
- **Approximate nearest-neighbor (ANN) search** — an index that finds close vectors without comparing all of them. **HNSW** (Hierarchical Navigable Small World), the common choice, is a graph whose name lists its three ideas:
  - **small world** — a graph where each vector links to a few of its closest vectors, yet any vector is reachable in a few hops;
  - **navigable** — a greedy search can find its way through the graph. It starts from a fixed entry point, because the index cannot look a vector up by its location: finding the stored vector nearest a location is the problem it solves. From there it moves greedily, computing distances and hopping to whichever neighbor is closer to the query, until none is;
  - **hierarchical** — the graph has several layers, and they nest. Every vector is on layer 0, and each layer above holds a small share of the one below, picked at random when vectors are inserted; most vectors live on layer 0 only. Each layer has its own links, drawn only among the vectors on that layer. On a sparse upper layer, even a vector's nearest neighbors are far away, so one hop crosses a long distance. A search uses those shortcuts to get near the query, then finishes on layer 0, where every vector can be reached.

  It is much faster than exact search and occasionally misses a true neighbor.
- **Hybrid search** — a search that runs keyword search and vector search on the same query and merges their results. The two find different documents: keyword search (usually **BM25**, which scores documents by the query words they contain, rare words counting more) catches exact terms such as product codes, and vector search catches the same meaning in other words.
  - Each search returns its own top results; the application sets how many, such as `LIMIT 20`.
  - Their scores use different scales, so they cannot simply be added. **Reciprocal Rank Fusion (RRF)** ignores the scores and uses only ranks: each document scores Σ 1/(k + rank) over the lists it appears in. Here k is a constant, usually 60, that controls how much rank 1 outweighs rank 2; it is unrelated to the number of results.

How RAG uses it: split documents into **chunks** (short passages) → embed each chunk → store the vectors → embed the user's question → fetch the nearest chunks → pass them to the LLM as context for its answer.

Sources: [pgvector README](https://github.com/pgvector/pgvector) · [Malkov & Yashunin, HNSW paper](https://arxiv.org/abs/1603.09320) · [Cormack et al., RRF paper](https://dl.acm.org/doi/10.1145/1571941.1572114)
