---
title: Choosing a database
---

Databases come in families. Each family stores data in a shape that makes some queries fast and others slow.

| Family | Data shape | Fast at | Typical use | Example |
|---|---|---|---|---|
| Relational | tables with a fixed schema | joins, transactions, ad-hoc SQL | orders, billing, most applications | PostgreSQL, MySQL |
| Document | JSON-like documents, each with its own fields | reading or writing one whole record | product catalogs, user profiles | MongoDB |
| Key-value | one value stored under each key | get or set by key, in memory | caches, sessions | Redis |
| Wide-column | rows grouped by a partition key, spread across many servers | very high write volume | event logs, IoT (internet-connected device) readings | Cassandra |
| Graph | nodes linked by edges | following chains of links | fraud rings, recommendations | Neo4j |
| Time-series | values stamped with a time | ranges and roll-ups over time | metrics, sensor data | TimescaleDB, InfluxDB |
| Vector | embeddings (lists of numbers) | finding the most similar items | semantic search (search by meaning, G1.7), RAG (retrieval-augmented generation: fetch the passages closest to a question and hand them to an LLM, a large language model, so its answer draws on them; G1.7) | pgvector, Qdrant, Pinecone |

**Relational vs wide-column.** Both show tables with rows and columns, so the difference lies in what you can ask:

- A **relational** database lets a query filter on any column, join any tables, enforce foreign keys, and run one transaction across many rows and tables. You model the data first, then write whatever queries you need.
- A **wide-column** database places each row on servers by its **partition key**, and a query is designed to read as few partitions as possible. It has no joins, so each query gets its own table holding every column it needs, with data copied between tables: denormalized on purpose. You list the queries first, then design one table per query.
- "Wide" means one partition can hold very many rows, such as every reading of one sensor sorted by time. It is unrelated to the column storage of G1.4.

Choose from the **access pattern**: which queries run, how often, how much data they touch, and how up to date each answer must be. One application often uses several families, such as PostgreSQL for orders and Redis as a cache in front of it.

Source: [Cassandra — Data Modeling](https://cassandra.apache.org/doc/latest/cassandra/developing/data-modeling/intro.html)
