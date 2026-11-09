---
title: Vector search
---

Recap (G1.7 L1): an embedding places meaning in space, similarity scores closeness, HNSW finds near vectors without comparing all of them, and hybrid search merges keyword and vector results. Here are the formulas, the pgvector SQL, how HNSW builds its graph, chunking, BM25, and Reciprocal Rank Fusion.

**Cosine similarity**

cos(a, b) = a·b / (‖a‖ ‖b‖)

- **a**, **b** — the two vectors, each a list of n numbers.
- **a·b** — the dot product: multiply matching positions and add up, a₁b₁ + a₂b₂ + … + aₙbₙ.
- **‖a‖** — the length of a: the square root of the sum of its squared numbers, √(a₁² + … + aₙ²).

Dividing by both lengths leaves only the angle. Example: a = (1, 2, 2) and b = (2, 1, 2) give a·b = 2 + 2 + 4 = 8, ‖a‖ = ‖b‖ = √9 = 3, so cos = 8 / 9 ≈ 0.89. The result runs from −1 (opposite) through 0 (unrelated) to 1 (same direction). When every vector has length 1, the denominator is 1, and cosine equals the dot product.

**pgvector.** The pgvector extension adds a `vector(n)` column type, distance operators, and two approximate indexes to PostgreSQL.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE items (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content   text NOT NULL,
  embedding vector(1024) NOT NULL          -- Amazon Titan Text Embeddings V2 outputs 1,024 numbers
);

INSERT INTO items (content, embedding) VALUES ('Recovering account access', '[0.012, -0.034, …]');

SELECT id, content, 1 - (embedding <=> $1) AS cosine_similarity
FROM items
ORDER BY embedding <=> $1                  -- $1: the query's embedding, same model, same length
LIMIT 5;
```

The operators return a **distance**, where smaller means closer, so `ORDER BY … LIMIT k` returns the k nearest:

| Operator | Distance | Index operator class |
|---|---|---|
| `<->` | Euclidean (L2) | `vector_l2_ops` |
| `<#>` | negative inner product, the dot product above (negated so that smaller is closer) | `vector_ip_ops` |
| `<=>` | cosine distance = 1 − cosine similarity | `vector_cosine_ops` |
| `<+>` | L1 (taxicab) | `vector_l1_ops` (HNSW only) |

An index serves only the operator its class was built for: an index with `vector_cosine_ops` speeds up `ORDER BY embedding <=> $1`, never `<->`. If the embedding model outputs vectors of length 1, cosine and inner product rank alike, and the README recommends inner product (`<#>`, `vector_ip_ops`) as the faster of the two.

```sql
-- HNSW: builds a layered graph; usable on an empty table; better speed and recall, slower build, more memory
CREATE INDEX ON items USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON items USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);   -- the defaults, spelled out
SET hnsw.ef_search = 40;             -- candidates kept per query; the default is 40

-- IVFFlat: clusters the vectors into lists and searches the nearest lists; build it after loading data
CREATE INDEX ON items USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
SET ivfflat.probes = 1;              -- lists searched per query; the default is 1
```

- **IVFFlat** (inverted file with flat lists) splits the vectors into `lists` clusters when the index is built and, at query time, searches only the `probes` clusters whose centers are nearest the query. It learns the clusters from the rows present at build time, so build it after loading data. The README suggests `lists` = rows / 1000 up to 1 million rows, and √rows above that.
- How `m`, `ef_construction`, `ef_search`, `lists`, and `probes` trade recall (the share of the true nearest neighbors a search returns) against speed is G1.7 L3.
- Both index types accept up to 2,000 dimensions for `vector`; `halfvec`, which stores each number in half precision (2 bytes instead of 4), allows 4,000.
- The index applies only when the query has an `ORDER BY` on a distance operator, ascending, and a `LIMIT`. A filter alone, such as `WHERE (embedding <=> $1) < 0.3`, compares against every row.

**How HNSW builds its graph.** L1 showed a search walking down the layers. An insert walks the same way to find where the new vector belongs, then links it in. Four settings drive it:

- **M** — how many links a new vector gets on each layer (pgvector's `m`, default 16).
- **Mmax** — the most links any vector may keep on a layer: M on the upper layers, and 2·M on layer 0 in the HNSW paper, because layer 0 holds every vector.
- **ef_construction** — how many nearest candidates the insert keeps while searching a layer (default 64). More candidates find better neighbors and slow the build.
- **mL** — the level multiplier, set to 1 / ln(M).

The insert, step by step:

1. **Draw the top layer at random:** l = ⌊−ln(U) · mL⌋, where U is a random number between 0 and 1 and ⌊ ⌋ rounds down. The chance of reaching layer k or higher is M⁻ᵏ: with M = 16, one vector in 16 reaches layer 1 and one in 256 reaches layer 2. That is why upper layers are sparse without anyone choosing which vectors go there.
2. **Walk down to layer l + 1.** Above the new vector's top layer it needs no links, only a starting point: from the entry point, hop greedily to whichever neighbor is closer to the new vector, and drop a layer when none is.
3. **On each layer from l down to 0:** search from where the walk arrived, keeping the ef_construction closest vectors found. Link the new vector to the M closest of them, in both directions. The next layer's search starts from the closest one found.
4. **Trim.** A neighbor that now has more than Mmax links keeps its closest Mmax and drops the rest. The paper also gives a heuristic that prefers neighbors lying in different directions over the strictly closest ones; the walkthrough uses the simple closest-first rule.
5. **Promote.** If l is above the graph's current top layer, the new vector becomes the entry point for all later searches and inserts.

The walkthrough below inserts one vector into a 16-vector graph with three layers, using small settings so each link is visible: M = 2, Mmax = 2 on layers 1 and 2 and 4 on layer 0, and ef_construction = 4. Pick a position and a top layer to see which links the insert chooses and which old links it trims. The links are fixed once made: an HNSW graph is never rebuilt on its own, so the order of inserts shapes it.

**Chunking.** A **chunk** is the passage of a document that gets its own embedding and is returned by retrieval. Its size is a trade-off: a small chunk matches a precise question well but may lack the context the answer needs; a large chunk carries context but blends several topics into one vector, which then matches none of them sharply.

- **Fixed-size with overlap** — cut every N tokens, repeating the last few tokens of each chunk at the start of the next so a sentence cut at the boundary appears whole in one of them.
- **Recursive (text structure)** — split on the largest separator that yields small enough pieces: paragraphs first, then sentences, then words. Chunks end at natural boundaries.
- **Document structure** — split on the document's own markup, such as Markdown headings or HTML sections, and keep the heading path ("Install › Linux") with the chunk as metadata and context.
- **Semantic** — split where the topic shifts, measured by the embedding similarity of neighboring sentences (unsourced; tooling varies).

Spring AI, Spring's framework for building LLM applications (G6.2), offers `TokenTextSplitter`, which cuts by token count (default 800 tokens) and then backs up to the last `.`, `?`, `!`, or newline so chunks end at a sentence:

```java
TokenTextSplitter splitter = TokenTextSplitter.builder()
        .withChunkSize(500)
        .withMinChunkSizeChars(350)
        .withKeepSeparator(true)
        .build();
vectorStore.write(splitter.split(pdfReader.read()));
```

In Python, the recursive splitter of LangChain, a library for building LLM applications, counts characters by default:

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(chunk_size=2000, chunk_overlap=200)
chunks = splitter.split_text(document_text)
```

Treat chunk size as a parameter to tune: build a set of questions with known source passages and measure how often retrieval returns them (G2, G6.5).

**BM25** scores how well a document matches the query words:

score(D, Q) = Σ over terms t in Q of IDF(t) · f(t, D) · (k₁ + 1) / ( f(t, D) + k₁ · (1 − b + b · |D| / avgdl) )

- **f(t, D)** — how many times term t occurs in document D. The fraction grows with it but levels off, so the tenth "database" adds far less than the first.
- **k₁** — how fast that levelling happens; the default in Lucene, the search library under Elasticsearch and OpenSearch, is 1.2.
- **|D| / avgdl** — D's length over the average document length. A match in a short document counts more than the same match in a long one.
- **b** — how much length matters, from 0 (not at all) to 1; default 0.75.
- **IDF(t)** — inverse document frequency, how rare t is across all N documents: ln(1 + (N − n(t) + 0.5) / (n(t) + 0.5)), where n(t) is the number of documents containing t. A rare word such as a product code outweighs a common one.

OpenSearch, an open-source search engine, scores full-text queries with BM25 by default:

```json
GET chunks/_search
{
  "query": { "match": { "content": "reset password" } }
}
```

**PostgreSQL full-text search** matches words, not meaning. A `tsvector` is a document reduced to its normalized words (lexemes) with positions; a `tsquery` is the search; `@@` tests a match, and a GIN index (G1.2) makes that fast.

```sql
ALTER TABLE items
  ADD COLUMN content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX ON items USING gin (content_tsv);

SELECT id, ts_rank_cd(content_tsv, query) AS rank
FROM items, websearch_to_tsquery('english', 'reset password') AS query
WHERE content_tsv @@ query
ORDER BY rank DESC
LIMIT 20;
```

`websearch_to_tsquery` accepts what users type (quotes, `or`, `-word`) and never raises a syntax error. Its ranking functions, `ts_rank` and `ts_rank_cd`, use only each document's own word counts and positions, with no IDF across the collection, so they are **not BM25**: a rare product code gets no extra weight. For true BM25 inside PostgreSQL, use an extension such as ParadeDB's `pg_search`; or rank with the built-in functions, which is often good enough once RRF uses only the rank order.

**Reciprocal Rank Fusion** merges the ranked lists from several searches:

RRF(d) = Σ over lists L containing d of 1 / (k + rank_L(d))

- **rank_L(d)** — d's position in list L, starting at 1. A list that does not contain d adds nothing.
- **k** — a constant, 60 in the original paper. It flattens the curve: with k = 60, rank 1 scores 1/61 and rank 2 scores 1/62, so one list's top spot cannot outweigh agreement between lists.

Example with k = 60: chunk X is 1st in vector search and 3rd in keyword search, so it scores 1/61 + 1/63 ≈ 0.0323. Chunk Y is 2nd in vector search only: 1/62 ≈ 0.0161. Chunk Z is 1st in keyword search only: 1/61 ≈ 0.0164. The order is X, Z, Y: found by both searches beats first place in one.

Hybrid search in one PostgreSQL query ($1 is the query embedding, $2 the query text):

```sql
WITH semantic AS (
  SELECT id, rank() OVER (ORDER BY embedding <=> $1) AS rank
  FROM items
  ORDER BY embedding <=> $1
  LIMIT 20
),
keyword AS (
  SELECT id, rank() OVER (ORDER BY ts_rank_cd(content_tsv, query) DESC) AS rank
  FROM items, websearch_to_tsquery('english', $2) AS query
  WHERE content_tsv @@ query
  ORDER BY ts_rank_cd(content_tsv, query) DESC
  LIMIT 20
)
SELECT coalesce(semantic.id, keyword.id) AS id,
       coalesce(1.0 / (60 + semantic.rank), 0) + coalesce(1.0 / (60 + keyword.rank), 0) AS rrf_score
FROM semantic
FULL OUTER JOIN keyword ON keyword.id = semantic.id
ORDER BY rrf_score DESC
LIMIT 5;
```

`rank() OVER (ORDER BY …)` numbers each list's rows 1, 2, 3 in that order. The `FULL OUTER JOIN` keeps chunks found by only one search, and `coalesce(…, 0)` gives the missing list no score. OpenSearch 2.19+ does the same fusion in a search pipeline (processing steps OpenSearch runs on a query and its results), with `rank_constant` as k.

Sources: [pgvector README](https://github.com/pgvector/pgvector) · [pgvector-python — hybrid search with RRF](https://github.com/pgvector/pgvector-python/blob/master/examples/hybrid_search/rrf.py) · [Malkov & Yashunin, HNSW paper (Algorithm 1; Mmax0 = 2·M; mL = 1/ln M)](https://arxiv.org/abs/1603.09320) · [Amazon Titan Text Embeddings](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html) · [Spring AI — ETL pipeline, TokenTextSplitter](https://docs.spring.io/spring-ai/reference/api/etl-pipeline.html) · [LangChain — Text splitters](https://docs.langchain.com/oss/python/integrations/splitters) · [Lucene — BM25Similarity](https://lucene.apache.org/core/9_12_0/core/org/apache/lucene/search/similarities/BM25Similarity.html) · [OpenSearch — Keyword search](https://docs.opensearch.org/latest/search-plugins/keyword-search/) · [OpenSearch — Reciprocal rank fusion](https://docs.opensearch.org/latest/vector-search/ai-search/hybrid-search/rrf/) · [PostgreSQL — Controlling Text Search](https://www.postgresql.org/docs/current/textsearch-controls.html) · [PostgreSQL — Tables and Indexes for text search](https://www.postgresql.org/docs/current/textsearch-tables.html) · [ParadeDB — pg_search](https://docs.paradedb.com/welcome/introduction) · [Cormack et al., RRF paper](https://dl.acm.org/doi/10.1145/1571941.1572114)
