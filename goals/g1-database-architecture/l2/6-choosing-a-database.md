---
title: Choosing a database
---

Recap (G1.6 L1): each database family stores data in a shape that makes some queries fast, and you choose by access pattern. Here is one hands-on example per family, all for the same online shop, so the differences show.

**Relational — PostgreSQL.** Data lives in normalized tables (G1.1); any query can join them, and one transaction can change many rows in several tables at once. Revenue per city over the shop's orders:

```sql
SELECT c.city, sum(oi.quantity * oi.unit_price) AS revenue
FROM orders o
JOIN customers c    ON c.id = o.customer_id
JOIN order_items oi ON oi.order_id = o.id
WHERE o.ordered_on >= date '2026-09-01'
GROUP BY c.city
ORDER BY revenue DESC;
```

Nobody planned this query when the schema was designed, and it still runs. That freedom, plus multi-row transactions (G1.3), is why relational is the default for a system of record, the store that holds the authoritative copy of the business's data.

**Document — MongoDB.** A **document** is one JSON-like record (stored as BSON, a binary encoding of JSON) that can nest objects and arrays; a **collection** holds documents that need not share fields. The catalog fits well: a pen and a laptop have different attributes, and a product page reads the product with its latest reviews in one go.

```javascript
db.products.insertOne({
  sku: "PEN-01",
  name: "Gel pen",
  price: 2.5,
  attributes: { color: "blue", tipMm: 0.5 },
  recentReviews: [{ user: "ana", stars: 5, text: "Smooth" }]
})

db.products.find({ "attributes.color": "blue", price: { $lt: 5 } })

db.products.updateOne(
  { sku: "PEN-01" },
  { $set: { price: 2.75 }, $push: { recentReviews: { user: "budi", stars: 4, text: "Good" } } }
)

db.products.createIndex({ "attributes.color": 1, price: 1 })
```

- **Embed or reference.** Embed data that is read together and belongs to one parent, such as a product's recent reviews. Reference it by id when it is shared, many-to-many, or grows without limit, such as all reviews ever written: a document is capped at 16 MiB.
- **Atomicity.** A write to one document is atomic, so embedding related data also makes its update atomic. Changes across documents need a multi-document transaction, which MongoDB supports at a higher cost than single-document writes.

**Key-value — Redis.** Redis keeps data in memory under keys, each holding a string, hash, list, set, or sorted set, so a read by key never waits on disk. It suits data read by exact key, where losing a little on a crash is acceptable or the data can be rebuilt: sessions, counters, rate limits, leaderboards, and caches (G1.5).

```text
SET session:9f2c '{"userId":7,"cart":["PEN-01"]}' EX 1800   # session that expires in 30 minutes
INCR views:product:PEN-01                                    # atomic counter
ZADD bestsellers 120 PEN-01 45 INK-07                        # sorted set: member with a score
ZINCRBY bestsellers 1 INK-07
ZRANGE bestsellers 0 9 REV WITHSCORES                        # top 10, highest score first
```

There is no query by value: "all sessions of user 7" needs a second key you maintain yourself, such as a set `user:7:sessions`.

**Wide-column — Cassandra.** You design one table per query (G1.6 L1). The **partition key** decides which nodes (servers) store a row; **clustering columns** sort rows inside a partition. A **keyspace** groups tables and sets how many copies of their data to keep. The shop's product-view events, read as "views of one product on one day, newest first":

```sql
CREATE KEYSPACE shop
  WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 3};

CREATE TABLE shop.product_views_by_day (
  sku       text,
  day       date,
  viewed_at timestamp,
  user_id   bigint,
  PRIMARY KEY ((sku, day), viewed_at, user_id)
) WITH CLUSTERING ORDER BY (viewed_at DESC, user_id ASC);

INSERT INTO shop.product_views_by_day (sku, day, viewed_at, user_id)
VALUES ('PEN-01', '2026-10-01', '2026-10-01 09:15:00', 7) USING TTL 7776000;   -- expires after 90 days

SELECT viewed_at, user_id FROM shop.product_views_by_day
WHERE sku = 'PEN-01' AND day = '2026-10-01' LIMIT 50;
```

- `(sku, day)` in its own parentheses is a composite partition key. Adding `day` caps each partition at one day of views, so a popular product never grows one partition without bound.
- `'dc1': 3` keeps three copies of each partition in data center `dc1`, on three different nodes.
- A query that does not name the whole partition key is rejected, because it would scan every node. `ALLOW FILTERING` forces it anyway; its cost grows with the whole table, so a new query pattern gets a new table instead.
- CQL (Cassandra Query Language, the SQL-like language above) has no joins and no subqueries: each table holds every column its query returns.

**Graph — Neo4j.** Data is **nodes** (with labels and properties) joined by typed, directed **relationships**, and Cypher, Neo4j's query language, matches patterns drawn as ASCII art. "Customers who bought this also bought":

```cypher
MERGE (ana:Customer {id: 7})
MERGE (pen:Product {sku: 'PEN-01'})
MERGE (ana)-[:BOUGHT]->(pen);

MATCH (:Product {sku: 'PEN-01'})<-[:BOUGHT]-(buyer:Customer)-[:BOUGHT]->(other:Product)
WHERE other.sku <> 'PEN-01'
RETURN other.sku, count(DISTINCT buyer) AS buyers
ORDER BY buyers DESC LIMIT 5;

MATCH (a:Customer {id: 7})-[:REFERRED]->{1,3}(b:Customer)
RETURN b.id;
```

`MERGE` creates a pattern only if it does not exist yet; `CREATE` always creates. `-[:REFERRED]->{1,3}` (a quantified relationship, Neo4j 5 syntax) follows one to three hops, such as a referral chain in fraud checks. In SQL, each hop is another self-join (a table joined to itself), and a chain of unknown length needs a recursive query (`WITH RECURSIVE`, which repeats a join until it finds no new rows); the graph follows stored links directly.

**Vector — pgvector or a dedicated vector database.** A vector store keeps embeddings and returns the nearest ones to a query vector (G1.7 has the full pgvector walkthrough). In PostgreSQL:

```sql
SELECT sku FROM products ORDER BY embedding <=> $1 LIMIT 5;   -- $1: the query's embedding
```

The same search in Qdrant, a dedicated vector database, with a payload filter (a filter on the JSON fields stored with each vector):

```python
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, FieldCondition, Filter, MatchValue, PointStruct, VectorParams

client = QdrantClient(url="http://localhost:6333")
client.create_collection("products", vectors_config=VectorParams(size=1024, distance=Distance.COSINE))
client.upsert("products", points=[PointStruct(id=1, vector=pen_embedding, payload={"sku": "PEN-01", "category": "pens"})])

hits = client.query_points(
    collection_name="products",
    query=question_embedding,
    query_filter=Filter(must=[FieldCondition(key="category", match=MatchValue(value="pens"))]),
    limit=5,
).points
```

| Store | What it is | Choose it when |
|---|---|---|
| pgvector | a PostgreSQL extension: a `vector` column with HNSW and IVFFlat (a cluster-based approximate index, G1.7) indexes | vectors live next to relational data; one database to run |
| Qdrant | open-source vector database with filtering on JSON payloads | heavy filtered search, self-hosted or managed |
| Weaviate | open-source vector database with built-in hybrid search (BM25 plus vector, fused) | hybrid search out of the box |
| Milvus | open-source, distributed, compute separated from storage; managed as Zilliz Cloud | billions of vectors |
| Pinecone | fully managed service; indexes split into namespaces (separate groups of vectors in one index, such as one per customer), with metadata filters | no database to operate |

**Polyglot persistence** is using several database families in one system, each for the data it fits best. The shop above could run PostgreSQL for orders, MongoDB for the catalog, Redis for sessions, Cassandra for view events, and Neo4j for recommendations. Every added store is one more system to operate, back up, secure, and keep in sync: a product renamed in PostgreSQL must reach the catalog and the graph, usually through change events, a stream of every change made to a table that other stores consume (G1.3 L3). So start with PostgreSQL, and add a store only when a measured access pattern needs it. PostgreSQL itself covers several families: `jsonb` with GIN (G1.2) for documents, pgvector for vectors.

Sources: [MongoDB — CRUD](https://www.mongodb.com/docs/manual/crud/) · [MongoDB — Atomicity and transactions](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/) · [MongoDB — Data model design](https://www.mongodb.com/docs/manual/core/data-model-design/) · [MongoDB — Limits](https://www.mongodb.com/docs/manual/reference/limits/) · [MongoDB — createIndex](https://www.mongodb.com/docs/manual/reference/method/db.collection.createIndex/) · [Redis — SET](https://redis.io/docs/latest/commands/set/) · [Redis — ZRANGE](https://redis.io/docs/latest/commands/zrange/) · [Cassandra — CQL DDL](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/ddl.html) · [Cassandra — CQL DML (`ALLOW FILTERING`)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/dml.html) · [Neo4j — MERGE](https://neo4j.com/docs/cypher-manual/current/clauses/merge/) · [Neo4j — Variable-length patterns](https://neo4j.com/docs/cypher-manual/current/patterns/variable-length-patterns/) · [pgvector README](https://github.com/pgvector/pgvector) · [Qdrant — Quickstart](https://qdrant.tech/documentation/quickstart/) · [Weaviate — Hybrid search](https://docs.weaviate.io/weaviate/search/hybrid) · [Milvus — Overview](https://milvus.io/docs/overview.md) · [Pinecone — Indexing overview](https://docs.pinecone.io/guides/index-data/indexing-overview) · [Martin Fowler — Polyglot Persistence](https://martinfowler.com/bliki/PolyglotPersistence.html)
