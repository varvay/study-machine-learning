---
title: Vector search
---

### Tuning HNSW and IVF against recall and latency

**Recall@k** is the share of the true k nearest neighbors that an approximate search returns: if exact search's top 10 and the index's top 10 share 9 IDs, recall@10 is 0.9. Every ANN parameter trades recall against latency, memory, or build time. The pgvector parameters:

**HNSW** (G1.7 L1, L2):

| Parameter | Set at | What it is | Higher value |
|---|---|---|---|
| `m` (default 16) | `CREATE INDEX … WITH (m = 16)` | the most links each vector keeps per layer | better recall and more robust graph; larger index, slower build |
| `ef_construction` (default 64) | index build | how many candidates the build keeps while choosing each vector's links | better graph, better recall; slower build and inserts |
| `hnsw.ef_search` (default 40) | query time, `SET LOCAL hnsw.ef_search = 100` | how many candidates the search keeps while walking layer 0 | better recall; slower queries |

- `ef_search` is the knob to tune in production, because it changes per query with no rebuild. Raise `m` or `ef_construction` only when recall stays too low at an `ef_search` whose latency is acceptable.
- **`ef_search` also caps the result count.** The search returns at most `ef_search` rows, so `LIMIT 100` with the default of 40 returns at most 40. Set `ef_search` ≥ the `LIMIT`.
- Builds are much faster while the graph fits in `maintenance_work_mem`, the memory PostgreSQL allows one maintenance task such as an index build; pgvector prints a notice when it no longer fits. Parallel workers (`max_parallel_maintenance_workers`, 2 by default) speed builds further.
- The graph lives in memory to be fast: size the instance so the index stays cached.

**IVFFlat** clusters the vectors with k-means (an algorithm that splits points into k groups, each around its average point, the centroid) into `lists` groups at build time, then searches only the groups whose centers are nearest the query:

| Parameter | Set at | Starting point | Higher value |
|---|---|---|---|
| `lists` | index build | rows / 1000 up to 1 million rows, √rows above | smaller groups: faster per probe, lower recall at the same `probes` |
| `ivfflat.probes` (default 1) | query time | √lists | more groups searched: better recall, slower; `probes = lists` is exact search |

- IVFFlat learns its clusters from the data present at build time. Build it only after loading data, and rebuild it when the data drifts, such as after a large new corpus arrives.
- Per pgvector's README, HNSW has a better speed–recall trade-off; IVFFlat builds faster and uses less memory. HNSW can be built on an empty table because it has no training step.

### Measuring recall against exact search

Recall is measured, never assumed. pgvector's README: compare approximate results with exact ones, getting the exact ones by turning index scans off for one transaction.

```sql
BEGIN;
SET LOCAL enable_indexscan = off;                 -- exact: scan and sort every row
SELECT id FROM chunks ORDER BY embedding <=> $1 LIMIT 10;
COMMIT;

BEGIN;
SET LOCAL hnsw.ef_search = 40;                    -- approximate, at the setting under test
SELECT id FROM chunks ORDER BY embedding <=> $1 LIMIT 10;
COMMIT;
```

The procedure:

1. **Sample real queries**, a few hundred, embedded with the production model. Random vectors do not behave like real queries.
2. **Compute the exact top k** for each once, and store it as ground truth.
3. **Sweep the parameter** (`ef_search` 20, 40, 80, 160 …), recording mean recall@k and p95 latency at each.
4. **Pick the smallest value** that meets the recall target, such as 0.95, within the latency budget.
5. **Re-run after changes** in data volume, filters, or the embedding model, and on a schedule, since recall drifts as data grows.

Recall@k measures the index against exact search. It says nothing about whether the nearest chunks answer the question; that is measured with labeled queries and retrieval metrics (G2.2).

### Metadata filtering: before or after the search

Most RAG queries carry a filter: this tenant, these documents, this date range. Where the filter runs decides both correctness and speed.

- **Post-filtering** — the ANN index returns its candidates, then `WHERE` removes the ones that do not match. This is what pgvector does with an approximate index. The failure is a short result: pgvector's README notes that if a condition matches 10% of rows, HNSW at the default `ef_search` of 40 returns only about 4 matching rows on average.
- **Iterative index scans** (pgvector 0.8.0+) fix the short result: `SET hnsw.iterative_scan = relaxed_order` (or `strict_order`) makes the index keep scanning until enough rows pass the filter, up to `hnsw.max_scan_tuples` (default 20,000). `relaxed_order` gives better recall and may return rows slightly out of distance order; wrap the query in a materialized CTE (a `WITH … AS MATERIALIZED (…)` subquery, computed once as its own result) and re-sort to get strict order back.
- **Pre-filtering** — apply the filter first, then compute exact distances only on matching rows. With a B-tree on the filter column, PostgreSQL does this on its own when the filter is selective, and the result is exact. It becomes slow when the filter matches a large share of rows.
- **Partial index** — one HNSW index per common filter value: `CREATE INDEX … USING hnsw (embedding vector_cosine_ops) WHERE (category_id = 123)`. Good for a few distinct values.
- **Partitioning** — `PARTITION BY LIST (tenant_id)` gives each tenant its own table and index. pgvector's README recommends partitions or separate tables for tenant isolation, because in a shared approximate index one tenant's vectors affect another tenant's recall and speed.
- **Filter-aware indexes** in dedicated stores: Qdrant adds graph links based on indexed payload values so the filtered graph stays connected, and its planner switches to a full scan when a filter matches few points.

Choose by the filter's **selectivity**, the share of rows it keeps: a filter keeping under a few percent favors pre-filtering with exact search; a broad filter favors the ANN index with iterative scans; a tenant boundary favors partitions.

### Quantization

**Quantization** stores each vector in fewer bits, trading some accuracy for a smaller index that stays in memory and scans faster.

- **Scalar quantization to half precision** — each 4-byte float becomes a 2-byte float, halving size; measure the recall change with the procedure above. pgvector's `halfvec` type stores it, and an expression index quantizes only the index: `CREATE INDEX ON chunks USING hnsw ((embedding::halfvec(1024)) halfvec_cosine_ops)`. `halfvec` also raises the indexable dimension limit from 2,000 to 4,000.
- **Binary quantization** — each dimension becomes 1 bit, its sign, so a 1024-dimension vector shrinks from 4 KB to 128 bytes (32×). Distance becomes Hamming distance, the count of differing bits. Recall drops, so search the binary index for extra candidates, then **re-rank** them with the full vectors:

  ```sql
  SELECT * FROM (
      SELECT * FROM chunks
      ORDER BY binary_quantize(embedding)::bit(1024) <~> binary_quantize($1)
      LIMIT 100
  ) AS candidates
  ORDER BY embedding <=> $1
  LIMIT 10;
  ```

- **Product quantization (PQ)** — split each vector into m sub-vectors; run k-means separately in each sub-space to learn a codebook of, typically, 256 centroids; store each sub-vector as the 1-byte ID of its nearest centroid. A 1024-dimension float vector (4,096 bytes) with m = 64 becomes 64 bytes. Distances to a query come from summing precomputed per-sub-space lookup tables, never decompressing. FAISS, Meta's open-source vector-search library, combines it with IVF as `IndexIVFPQ` (the IVFADC method of Jégou et al.). pgvector's README offers `halfvec`, binary quantization, and subvector indexing, not PQ.

### Cross-encoder re-ranking

Embedding search uses a **bi-encoder**: query and document are embedded separately, so document vectors are computed once and searched fast. A **cross-encoder** reads the query and one document *together* in a single transformer pass (one run of the neural network type behind LLMs and embedding models; G3.1) and outputs one relevance score. Seeing both texts at once makes it more accurate, and it is far slower, because nothing can be precomputed: each query–document pair is a model call.

So the two run in stages: retrieval (vector or hybrid, G1.7 L2) returns about 50–100 candidates, the cross-encoder re-scores them, and the top 5–10 go to the LLM. Latency grows with the candidate count, which is the knob to tune. On AWS, Amazon Bedrock's `Rerank` API (Agents for Amazon Bedrock Runtime) serves Amazon Rerank 1.0 and Cohere Rerank 3.5, with up to 1,000 sources per call; which model is available depends on the region.

### Re-indexing when the embedding model changes

Vectors from two embedding models live in different spaces: their distances mean nothing to each other, even at the same dimension. Changing the model therefore means re-embedding every chunk and building a new index, while the old one keeps serving. A blue–green plan, which builds the new version beside the live one and then switches traffic to it:

1. **Record the model on every row** from day one, in an `embedding_model` column holding the model ID and dimension, so it is always known which vectors are comparable.
2. **Add the new column or table** (`embedding_v2 vector(n)`); a different dimension needs a new column type.
3. **Backfill in batches**, within the embedding API's rate limits, and budget the cost: total tokens in the corpus × the price per token.
4. **Dual-write** new and changed chunks with both models during the backfill.
5. **Build the new index** with `CREATE INDEX CONCURRENTLY` once the backfill completes.
6. **Evaluate before switching**: run the labeled retrieval set against both and compare recall and answer quality; shadow live queries if possible.
7. **Switch reads** behind a flag (a configuration switch the application checks at run time), keep the old column for rollback for a while, then drop it and its index.

The query must be embedded with the same model as the column it searches, so the flag switches the query embedding and the column together.

**In an interview**

- *A tenant filter makes RAG return 3 chunks instead of 10. Why?* — pgvector applies the `WHERE` after the HNSW scan, and the scan only collects `ef_search` candidates, 40 by default. If the tenant owns 10% of vectors, about 4 survive. Fixes: enable iterative index scans, raise `ef_search`, or better, partition by tenant so each tenant searches its own index, which also stops tenants affecting each other's recall.
- *How do you choose `ef_search`?* — Empirically. I sample real queries, compute exact top-k once with index scans disabled, then sweep `ef_search` and record recall@k and p95 latency, and pick the smallest value that meets the recall target inside the latency budget. I keep it at least the `LIMIT`, and re-measure as the data grows.

Sources: [pgvector README](https://github.com/pgvector/pgvector) · [Malkov & Yashunin, HNSW (arXiv 1603.09320)](https://arxiv.org/abs/1603.09320) · [FAISS — Faster search (IVF, nprobe)](https://github.com/facebookresearch/faiss/wiki/Faster-search) · [Jégou, Douze & Schmid, Product quantization for nearest neighbor search (TPAMI 2011)](https://inria.hal.science/inria-00514462) · [Qdrant — Indexing](https://qdrant.tech/documentation/concepts/indexing/) · [Sentence Transformers — Retrieve & re-rank](https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html) · [Amazon Bedrock — Rerank API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_Rerank.html) · [Amazon Bedrock — Supported rerank models](https://docs.aws.amazon.com/bedrock/latest/userguide/rerank-supported.html)
