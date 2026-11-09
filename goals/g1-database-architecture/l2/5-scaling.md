---
title: Scaling and distribution
---

Recap (G1.5 L1): replication copies the whole database to more servers, and partitioning splits a table into pieces. Here you set both up for PostgreSQL, add a cache (a fast in-memory store that answers repeated reads so they skip the database), and add the connection pooler that most PostgreSQL deployments need first.

**Streaming replication.** In **streaming replication**, the primary sends its write-ahead log (WAL, the log of every change, G1.3 L1) over a network connection to each **standby**, which replays it to stay a copy of the primary. With `hot_standby = on`, the default, a standby also answers read-only queries: it is then a **read replica**.

On the primary, allow replication and create a role (PostgreSQL's name for a user account, or a group of them) for it:

```ini
# postgresql.conf
wal_level = replica            # the default; writes enough WAL for a standby
max_wal_senders = 10           # at most 10 standbys streaming at once
```

```text
# pg_hba.conf: let the replicator role connect for replication from the standby's address
host  replication  replicator  10.0.1.20/32  scram-sha-256
```

```sql
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'change-me';
```

On the standby, copy the primary with an empty data directory as the target, then start PostgreSQL:

```bash
pg_basebackup -h 10.0.1.10 -U replicator -D /var/lib/postgresql/data -R -X stream -C -S replica_1 -P
```

- `-R` writes `standby.signal` and the connection settings (`primary_conninfo`) into the copy, so the server starts as a standby.
- `-X stream` streams the WAL written during the copy, so the copy is consistent.
- `-C -S replica_1` creates a **replication slot**: the primary keeps WAL until this standby has received it, so a standby that falls behind can catch up. A slot whose standby is gone keeps WAL forever and can fill the primary's disk, so drop unused slots with `pg_drop_replication_slot`.

**Watch the lag.** Replication is asynchronous by default: the primary confirms a commit without waiting for the standby, so the standby is usually under a second behind.

```sql
-- on the primary: one row per standby
SELECT application_name, state, sent_lsn, replay_lsn, replay_lag FROM pg_stat_replication;

-- on the standby
SELECT pg_is_in_recovery(), now() - pg_last_xact_replay_timestamp() AS replay_delay;
```

An LSN (log sequence number) is a position in the WAL, so `sent_lsn` and `replay_lsn` show how far the standby has received and applied it; `pg_is_in_recovery()` is true on a standby, which is always replaying. `replay_lag` is how long a change committed on the primary took to become visible on the standby. For zero data loss on failover (a standby taking over when the primary fails), list standbys in `synchronous_standby_names`; every commit then waits for them, which adds at least one network round trip to each commit.

**Using read replicas.** Send read-only queries to replicas and every write to the primary. Because of lag, a user who just saved something and reads it back from a replica may not see it; send reads that must see the user's own writes to the primary (G1.5 L3 covers read-your-writes in depth). On AWS, RDS for PostgreSQL (Amazon's managed PostgreSQL service) creates read replicas for you on PostgreSQL's native replication; a replica is read-only until you promote it to a standalone instance, which cannot be undone.

**Declarative partitioning.** A **partitioned table** is a parent table that stores no rows itself; each row goes to the one **partition** whose bounds contain its **partition key**. PostgreSQL offers three ways to split:

```sql
-- RANGE: one partition per month; the upper bound is exclusive
CREATE TABLE events (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  occurred_at timestamptz NOT NULL,
  kind        text NOT NULL,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE events_2026_09 PARTITION OF events FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE events_2026_10 PARTITION OF events FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE events_default PARTITION OF events DEFAULT;   -- catches rows no partition covers
CREATE INDEX ON events (occurred_at);                       -- created on every partition, now and future

-- LIST: one partition per group of values
CREATE TABLE customers_by_region (id bigint, region text NOT NULL, PRIMARY KEY (id, region))
  PARTITION BY LIST (region);
CREATE TABLE customers_apac PARTITION OF customers_by_region FOR VALUES IN ('ID', 'SG', 'AU');

-- HASH: spread rows evenly when no natural range or list exists
CREATE TABLE carts (customer_id bigint NOT NULL, item text) PARTITION BY HASH (customer_id);
CREATE TABLE carts_0 PARTITION OF carts FOR VALUES WITH (MODULUS 4, REMAINDER 0);
-- … and carts_1, carts_2, carts_3 with REMAINDER 1, 2, 3
```

A primary key or unique constraint must include the partition key, which is why the key of `events` is `(id, occurred_at)`. `PRIMARY KEY (id)` alone fails with `unique constraint on partitioned table must include all partitioning columns`: each partition checks uniqueness only within itself.

**Partition pruning** is the planner skipping partitions that cannot hold matching rows. A query for one day of October reads one partition:

```sql
EXPLAIN SELECT count(*) FROM events WHERE occurred_at >= '2026-10-05' AND occurred_at < '2026-10-06';
```

```text
Aggregate
  ->  Bitmap Heap Scan on events_2026_10 events
        ->  Bitmap Index Scan on events_2026_10_occurred_at_idx
```

Pruning needs the partition key in the `WHERE` clause. A query filtering only on `kind` scans every partition. Retention becomes a metadata change instead of a large `DELETE`:

```sql
ALTER TABLE events DETACH PARTITION events_2026_09;
DROP TABLE events_2026_09;
```

A plain `DETACH` briefly blocks queries on `events`. `DETACH … CONCURRENTLY` (PostgreSQL 14+) avoids that, but it fails with `cannot detach partitions concurrently when a default partition exists`, so tables that detach this way go without a default partition.

Create next month's partition ahead of time, by a scheduled job or an extension such as [`pg_partman`](https://github.com/pgpartman/pg_partman); without it, new rows land in the default partition, or fail with no partition to go to.

**Redis caching: cache-aside with a TTL.** In **cache-aside** (also called lazy loading), the application checks the cache first. On a **hit** it returns the cached value. On a **miss** it reads the database, stores the result in the cache, and returns it. A **TTL** (time to live) makes each cached value expire after a set time, which bounds how stale it can get.

```text
SET product:42 '{"name":"Gel pen","price":2.5}' EX 300   # store for 300 seconds
GET product:42                                            # the value, or nil after it expires
TTL product:42                                            # seconds left
DEL product:42                                            # drop it now
```

```python
import json
import redis

cache = redis.Redis(host="localhost", port=6379, decode_responses=True)
PRODUCT_TTL_SECONDS = 300

def get_product(product_id: int) -> dict:
    key = f"product:{product_id}"
    cached = cache.get(key)
    if cached is not None:
        return json.loads(cached)
    product = load_product_from_postgres(product_id)
    cache.set(key, json.dumps(product), ex=PRODUCT_TTL_SECONDS)
    return product

def update_product(product_id: int, changes: dict) -> None:
    save_product_to_postgres(product_id, changes)
    cache.delete(f"product:{product_id}")
```

`update_product` deletes the key after writing, so the next read loads the new value; the TTL is the safety net for any write path that forgets to. Each miss costs three trips (cache, database, cache), and a key that nobody deletes stays stale until its TTL ends. In Spring, `@Cacheable("products")` on a method gives the same pattern, with the TTL set on the cache manager:

```java
@Bean
RedisCacheManager cacheManager(RedisConnectionFactory connectionFactory) {
    RedisCacheConfiguration defaults = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(5));
    return RedisCacheManager.builder(connectionFactory).cacheDefaults(defaults).build();
}
```

On AWS, Amazon ElastiCache runs Redis-compatible caches (Valkey, an open-source fork of Redis, or Redis OSS) as a managed service.

**Connection pooling with PgBouncer.** PostgreSQL starts one server process per client connection, so thousands of connections cost thousands of processes, and most sit idle. A **connection pooler** sits between the application and PostgreSQL: many client connections share a small pool of server connections.

```ini
# pgbouncer.ini
[databases]
app = host=10.0.1.10 port=5432 dbname=app

[pgbouncer]
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 2000
default_pool_size = 20
```

The application connects to port 6432 instead of 5432. `pool_mode` sets when a server connection returns to the pool:

| Pool mode | Server connection returns to the pool | Trade-off |
|---|---|---|
| `session` (default) | when the client disconnects | every PostgreSQL feature works; saves only reconnect cost |
| `transaction` | when each transaction ends | the usual choice: many clients share few connections |
| `statement` | after each statement | multi-statement transactions are not allowed |

Transaction mode gives each transaction whichever server connection is free, so anything that lives in a session breaks: `SET` (use `SET LOCAL` inside the transaction), `LISTEN` (waiting for notifications), session advisory locks (locks the application takes on a number of its choosing), `WITH HOLD` cursors (cursors kept open after their transaction ends), SQL-level `PREPARE`, and temporary tables that outlive a transaction. Protocol-level prepared statements, which JDBC and most drivers use, work when `max_prepared_statements` is above 0 (default 200). On AWS, RDS Proxy is the managed pooler; it connects only to the writer instance, not to read replicas.

Sources: [PostgreSQL — Log-Shipping Standby Servers](https://www.postgresql.org/docs/current/warm-standby.html) · [pg_basebackup](https://www.postgresql.org/docs/current/app-pgbasebackup.html) · [Replication settings (`hot_standby`)](https://www.postgresql.org/docs/current/runtime-config-replication.html) · [Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html) · [ALTER TABLE — DETACH PARTITION](https://www.postgresql.org/docs/current/sql-altertable.html) · [How Connections Are Established](https://www.postgresql.org/docs/current/connect-estab.html) · [RDS for PostgreSQL read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PostgreSQL.Replication.ReadReplicas.html) · [Redis — SET](https://redis.io/docs/latest/commands/set/) · [redis-py commands](https://redis.readthedocs.io/en/stable/commands.html) · [ElastiCache — Caching strategies](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Strategies.html) · [Spring Data Redis — Cache](https://docs.spring.io/spring-data/redis/reference/redis/redis-cache.html) · [PgBouncer — Configuration](https://www.pgbouncer.org/config.html) · [PgBouncer — Features](https://www.pgbouncer.org/features.html) · [Amazon RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html)
