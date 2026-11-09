---
title: Choosing a database
---

### Deciding from the workload

A database choice is a bet on which operations must be cheap. Write the workload down first, then match it:

1. **Access patterns** — the actual queries, with their frequency: point lookups by key, range scans, ad-hoc filters and joins, full scans for aggregates, graph traversals, similarity search. A few known queries at huge volume suit a key-value or wide-column store designed around them; unknown future queries suit SQL.
2. **Consistency needs** — which rules must never break, and whether they span several records. "An order's lines, payment, and stock change together" needs multi-row transactions. "A like counter may be off by a few for a second" does not.
3. **Scale** — data size and growth, peak reads and writes per second, and whether one well-sized server with replicas can carry it. Most applications fit on one PostgreSQL primary for years; sharding is a cost to pay only when forced.
4. **Latency** — the p99 budget per request, and whether data must be close to users in several regions.
5. **Team and operations** — what the team already runs, backs up, monitors, and can debug at 3 a.m., and whether a managed service exists on the chosen cloud.

Worked mapping:

| Workload | Choice | Deciding reason |
|---|---|---|
| orders, payments, inventory | PostgreSQL | multi-row transactions and constraints; queries not all known up front |
| session store, rate limits, hot cache | Redis | in-memory get/set by key; data can be rebuilt if lost |
| device telemetry at 100k writes/s, read by device and time | Cassandra or DynamoDB | writes spread by partition key; one known query shape |
| product catalog with varied attributes per category | PostgreSQL with `jsonb`, or MongoDB | flexible fields per record; PostgreSQL keeps joins to orders |
| "customers who bought X also bought", fraud rings | Neo4j, or recursive SQL at small scale | many-hop traversals are cheap in a graph |
| semantic search over document chunks | pgvector, or a dedicated vector store | nearest-neighbor search; see below |

The default is PostgreSQL, and each move away needs a named reason from the list above. Every extra database adds a backup, an upgrade path, a security review, and a sync pipeline between stores.

### Defending Postgres + pgvector against a dedicated vector database

The question comes up in every RAG design review. The case for **pgvector**:

- **One transaction.** A chunk, its embedding, its metadata, and its document version commit together. With a separate vector store, the two stores drift apart whenever a sync fails, and fixing that needs an outbox or change data capture (G1.3).
- **SQL around the vectors.** Filters, joins to documents and permissions, and hybrid search with PostgreSQL full-text search run in one query (G1.7 L2).
- **Security in one place.** Row-level security (PostgreSQL adding a per-tenant filter to every query on a table; G1.8) applies to vector queries like any other query, so a tenant cannot retrieve another tenant's chunks.
- **Operations already solved.** Backups, point-in-time recovery (restoring the database to any past moment from a backup plus the WAL), replicas, monitoring, and encryption are the ones the team already runs. Amazon Aurora PostgreSQL supports pgvector and can serve as the vector store behind Amazon Bedrock Knowledge Bases, AWS's managed RAG service (Bedrock is AWS's service for calling hosted LLMs and embedding models).
- **Enough scale for most RAG corpora.** HNSW indexes up to 2,000 dimensions (`vector`) or 4,000 (`halfvec`); binary quantization (storing each number as one bit, G1.7) shrinks the index further; read replicas scale query throughput, and Citus, a PostgreSQL extension that spreads tables across servers, can shard.

The case for a **dedicated vector database** (Qdrant, Milvus, Pinecone, Weaviate, OpenSearch):

- **Filtered search built into the index.** Qdrant, for example, adds extra graph links per indexed payload value, so a filtered HNSW search stays connected; pgvector filters after the index scan and needs iterative scans, which keep the index scanning until enough rows pass the filter, to fill the result (G1.7).
- **Horizontal scaling of the vector index itself**, with sharding and replication designed around it, when the index outgrows one machine's memory.
- **Isolation of load.** Heavy vector traffic does not compete with transactional queries for the same CPU and memory.
- **Managed, serverless options** such as Pinecone, where nothing is sized in advance.

The decision rule to defend: **start with pgvector when vectors live beside relational data and the index fits in one server's memory; move when a measured limit is hit** — p95 latency at the target recall no longer fits the budget, filtered queries lose recall even with iterative scans, or vector load starts to hurt transactional queries. Every one of those is a number from monitoring, not a guess at design time.

### Operational cost and migration paths

The price of a database is mostly not its license or instance:

- **Direct cost** — instances or serverless units, storage, backups, and cross-zone or cross-region data transfer.
- **People cost** — upgrades, on-call, tuning, and the knowledge to debug it. A second database the team knows poorly costs more in incidents than in invoices.
- **Integration cost** — the sync pipeline between stores, its monitoring, and the reconciliation job that proves the stores agree.
- **Compliance cost** — each store holding personal data needs access control, audit, encryption, and deletion (G1.8).

Design so a later move is cheap:

- **Put the store behind an interface.** Spring AI's `VectorStore` exposes `add`, `delete`, and `similaritySearch(SearchRequest)` with a portable metadata filter language, over more than twenty backends, among them PGvector, Qdrant, Pinecone, Milvus, OpenSearch, and Amazon Bedrock Knowledge Base. Switching stores is then a configuration and data change, not a rewrite.
- **Keep the source of truth outside the index.** Store chunk text and metadata in PostgreSQL even when vectors live elsewhere, so any index can be rebuilt from it.
- **Migrate with dual writes and shadow reads.** Backfill the new store, write to both, send a copy of live queries to the new store and compare results and latency, then switch reads, then stop the old writes.
- **Moving vectors needs no re-embedding** as long as the embedding model stays the same. Changing the model does (G1.7).
- **Leaving PostgreSQL for a NoSQL store** (any of the non-relational families of G1.6: document, key-value, wide-column, graph) means redesigning tables around queries (G1.6 L1): the relational schema does not carry over.

**In an interview**

- *Why not just use Pinecone for the RAG app?* — Because the chunks already live beside documents, users, and permissions in PostgreSQL. pgvector gives one transaction for text, metadata, and embedding, row-level security on retrieval, and hybrid search in one query, with no sync pipeline to keep two stores in step. I would move to a dedicated store when measurements show a limit: the index outgrows memory, filtered recall drops, or vector load hurts transactional queries. And I keep the store behind Spring AI's `VectorStore` so that move is cheap.
- *When would you choose DynamoDB or Cassandra over PostgreSQL?* — When the workload is a few known access patterns at a write volume or availability target one primary cannot meet, such as telemetry or event logs read by key and time. I would design each table around its query, with a partition key that spreads writes. I would not choose them for data that needs multi-row transactions or ad-hoc queries.

Sources: [pgvector README](https://github.com/pgvector/pgvector) · [Amazon Aurora — PostgreSQL as a Bedrock knowledge base](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.VectorDB.html) · [Qdrant — Indexing (filterable HNSW)](https://qdrant.tech/documentation/concepts/indexing/) · [Spring AI — Vector databases](https://docs.spring.io/spring-ai/reference/api/vectordbs.html)
