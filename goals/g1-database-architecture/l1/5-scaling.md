---
title: Scaling and distribution
---

When one database server can no longer keep up, there are two ways to grow.

- **Vertical scaling** — move to a bigger server: more CPU, memory, faster disks. Nothing in the application changes, but the biggest server sets a ceiling, and it is still one machine that can fail.
- **Horizontal scaling** — add more servers and spread the work across them. It has no fixed ceiling, but the servers must coordinate.

Ways to spread a database across servers:

- **Replication** — keep a full copy of the data on several servers. One **primary** accepts all writes and streams each change to the **replicas**. Replicas answer reads, which spreads the read load, and one can become the primary if the primary fails. A replica applies changes a moment after the primary, so a read from it can briefly return old data. That delay is **replication lag**.
- **Partitioning** — split one large table into smaller pieces by a column, such as one partition per month of `created_at`. A query for March reads only the March partition, and deleting last year's data drops whole partitions.
- **Sharding** — partitioning across servers. Each server (shard) holds only some of the rows, chosen by a **shard key** such as `customer_id`. A query for one customer goes to one shard; a query across all customers must ask every shard.

Partitioning and sharding decide where rows are stored, not how data is modeled or queried. Relational and non-relational databases both use them: PostgreSQL partitions tables, and Cassandra (G1.6) shards every table by design.

- **CAP theorem** — a distributed database cannot guarantee both consistency and availability while a **network partition** lasts, a network fault that cuts its servers off from each other. Each side must choose: stay **consistent**, refusing requests it cannot confirm are up to date, or stay **available**, answering with data that may be stale. CAP's consistency means every read sees the latest write, which differs from the C in ACID (G1.3), where it means the schema's rules hold.
