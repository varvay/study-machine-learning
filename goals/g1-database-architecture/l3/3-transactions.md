---
title: Transactions and isolation
---

### MVCC: how PostgreSQL isolates without read locks

**Multi-version concurrency control (MVCC)** keeps several versions of a row at once, so each transaction can read the version that matches its own point in time while others change the row. The result, in the PostgreSQL docs' words: reading never blocks writing, and writing never blocks reading.

- **Row version (tuple)** — one physical copy of a row. Every version carries two hidden system columns:
  - `xmin` — the ID of the transaction that created this version;
  - `xmax` — the ID of the transaction that deleted or replaced it, or 0 if none has.
- **UPDATE** never changes a version in place. It writes a new version with `xmin` = its own transaction ID and stamps the old version's `xmax` with the same ID. **DELETE** only stamps `xmax`.
- **Snapshot** — a record of which transactions had finished at one moment: `xmin` (the oldest transaction still running), `xmax` (one past the newest finished transaction), and the list of transaction IDs still in progress between them. `SELECT pg_current_snapshot();` prints it as `xmin:xmax:in-progress-list`, for example `10:20:10,14,15`.
- **Visibility rule** — a transaction sees a row version when the version's `xmin` had committed as of its snapshot, and its `xmax` is 0, aborted, or had not committed as of that snapshot. Every other version is invisible to it, so each snapshot sees at most one version of each row.

The isolation level only decides when the snapshot is taken:

- **Read Committed** (PostgreSQL's default) — a new snapshot at the start of each statement, so a second `SELECT` in the same transaction sees commits made in between.
- **Repeatable Read** and **Serializable** — one snapshot, taken at the first statement, for the whole transaction.

A rolled-back transaction erases nothing: the versions it wrote stay on disk, and its stamps are simply ignored because its ID is marked aborted. That makes rollback instant, and it leaves dead versions behind, the same as a committed update does.

The walkthrough below follows one row through several updates while a reader holds a snapshot.

### VACUUM, the cost of MVCC

A version is **dead** when no running or future transaction can see it: it was replaced by a committed transaction older than every open snapshot, or it was written by an aborted one. A version that is replaced but still visible to some open snapshot is **recently dead**, and must be kept. **VACUUM** removes dead versions and their index entries, and records the freed space for reuse by new rows in the same table. It does not shrink the file, except for empty pages at its end; `VACUUM FULL` rewrites the table compactly but takes an `ACCESS EXCLUSIVE` lock for the whole run.

- **Autovacuum** runs VACUUM on a table once its dead rows pass `autovacuum_vacuum_threshold` (50) + `autovacuum_vacuum_scale_factor` (0.2) × the table's row count, capped by `autovacuum_vacuum_max_threshold` (PostgreSQL 18).
- **The visibility map** keeps two bits per heap page: all-visible and all-frozen. VACUUM sets them, and an index-only scan uses them to skip reading heap pages whose rows are all visible. A table that is rarely vacuumed gets slow index-only scans.
- **Long transactions block VACUUM.** VACUUM cannot remove a version that the oldest open snapshot might still need, anywhere in the database. One session left `idle in transaction` for hours lets every busy table bloat. `idle_in_transaction_session_timeout` (default 0, off) ends such sessions; replication slots and `hot_standby_feedback` on replicas (the replica reporting its oldest running query to the primary) hold back VACUUM the same way.
- **Transaction ID wraparound.** Transaction IDs are 32-bit and compared modulo 2³², so each ID has about 2 billion IDs "in the past" and 2 billion "in the future". A version older than that would suddenly look like it came from the future and vanish. VACUUM prevents this by **freezing** old versions, marking them as visible to everyone. Autovacuum forces a freezing vacuum on a table whose oldest unfrozen ID is `autovacuum_freeze_max_age` (200 million) transactions old, even when autovacuum is otherwise disabled. If freezing falls too far behind, PostgreSQL stops accepting commands that assign new transaction IDs, to protect the data.

### Repeatable Read is snapshot isolation; Serializable is SSI

**Snapshot isolation** is the guarantee that a transaction reads from one consistent snapshot and cannot commit a write to a row that another transaction changed and committed after that snapshot. PostgreSQL's Repeatable Read implements it.

- It prevents dirty reads, non-repeatable reads, and, in PostgreSQL (stronger than the SQL standard requires), phantom reads.
- It prevents **lost updates** by "first updater wins": when two transactions update the same row, the second waits for the first to finish; if the first commits, the second's `UPDATE` fails with `ERROR: could not serialize access due to concurrent update` (SQLSTATE `40001`). At Read Committed the same `UPDATE` would instead re-check its `WHERE` against the new version and apply on top of it. The application must retry the whole transaction; PostgreSQL never retries by itself.
- It allows **write skew**: two transactions read an overlapping set of rows, each checks a rule, then each writes a *different* row, and together they break the rule. Example: a hospital requires at least one doctor on call. Alice and Bob are both on call; both open transactions, each counts 2 on-call doctors, each takes themself off call, and both commit, because they updated different rows. Nobody is on call.

**Serializable** in PostgreSQL is **Serializable Snapshot Isolation (SSI)**: snapshot isolation plus tracking of which transaction read data that another later wrote.

- Each read records an `SIReadLock` (visible in `pg_locks`). It never blocks anyone; it only records what was read, at row, page, or relation (whole table) level.
- A **read-write dependency** exists when T1 reads a version and T2 writes a newer one. A cycle of such dependencies means no serial order could produce the result. SSI aborts a transaction when it sees two consecutive read-write dependencies in a pattern that could close such a cycle, raising `could not serialize access due to read/write dependencies among transactions` (also `40001`).
- In the doctor example, both transactions read both rows and each wrote a row the other read, so one of them fails and retries, sees only one doctor on call, and refuses.
- It can abort transactions that would have been fine (false positives), and tracking costs memory. For a long read-only report, `BEGIN ISOLATION LEVEL SERIALIZABLE, READ ONLY, DEFERRABLE` waits for a safe snapshot and then runs with no risk of serialization failure.

Choosing a level:

- **Read Committed plus explicit locks** where a known invariant is at risk — `SELECT … FOR UPDATE` on the rows that decide it — is the common default.
- **Serializable** when invariants span many rows or are easy to miss, provided every transaction runs inside a retry loop on `40001`.

### Deadlocks

A **deadlock** is two or more transactions each waiting for a lock the other holds, so none can proceed. Example: transfer 1 locks account A then wants B; transfer 2 locks B then wants A.

- PostgreSQL checks for a cycle after a wait of `deadlock_timeout` (default 1 s), and aborts one of the transactions with SQLSTATE `40P01`; which one is not predictable. The other proceeds.
- **Avoid them by acquiring locks in one global order.** Lock both accounts in one statement ordered by key: `SELECT … FROM accounts WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`.
- **Keep transactions short** and never wait on a user or a network call while holding locks.
- **Queue workers** that pull jobs with `SELECT … FOR UPDATE SKIP LOCKED` skip rows other workers hold instead of waiting on them.
- **Retry** `40P01` like `40001`: the aborted transaction did nothing, so running it again is safe.

### Transactions across services: 2PC, saga, outbox

Once an operation spans two databases, or a database and a message broker (a service such as Kafka that receives events and delivers them to the services that subscribe), no single transaction covers it.

**Two-phase commit (2PC)** — a coordinator asks every participant to *prepare* (write everything durably and promise to commit), and only when all have promised tells them to *commit*. In PostgreSQL a participant runs `PREPARE TRANSACTION 'id'`, later `COMMIT PREPARED 'id'` or `ROLLBACK PREPARED 'id'`.

- It gives atomicity across systems, at the price of **blocking**: if the coordinator dies after the participants prepared, they keep holding their locks until it recovers or someone resolves the transaction by hand. A forgotten prepared transaction also stops VACUUM.
- PostgreSQL ships it disabled (`max_prepared_transactions` = 0), and its docs say `PREPARE TRANSACTION` is not intended for applications, only for writers of transaction managers. Most message brokers and HTTP services cannot take part at all.

**Saga** — a sequence of local transactions, one per service, where each step has a **compensating transaction** that semantically undoes it: an order saga reserves stock, charges the card, and books shipping; if shipping fails, it refunds the card and releases the stock.

- **Orchestration** — one orchestrator tells each service what to do next. The flow is in one place and easy to follow.
- **Choreography** — each service reacts to the previous service's events. There is no central component, and the flow is harder to see.
- A saga has no isolation: other transactions see the intermediate states, such as a charged order not yet shipped. Countermeasures include a status such as `PENDING` that other operations respect (a semantic lock), and compensations written to be idempotent and retried until they succeed.

**Transactional outbox** — the fix for the **dual-write problem**: a service that commits to its database and then publishes an event can crash in between, losing the event, or publish and then fail to commit, announcing something that never happened. With an outbox, the service writes the event into an `outbox` table *in the same local transaction* as the business change, and a separate relay publishes outbox rows to the broker.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 300" role="img" aria-labelledby="transactions-outbox-title">
<title id="transactions-outbox-title">Transactional outbox: the order service writes the order row and the outbox row in one transaction; a relay reads new outbox rows and publishes them to a broker; consumers skip event ids they have already processed</title>
<rect class="fold-train" x="200" y="44" width="230" height="240" rx="12" />
<text class="note" x="315" y="34" text-anchor="middle">PostgreSQL · one local transaction</text>
<path class="key-link" d="M160,140 C190,140 190,109 220,109" />
<path class="key-link" d="M160,156 C190,156 190,223 220,223" />
<path class="key-link" d="M410,223 L470,223" />
<path class="key-link" d="M590,223 L620,223" />
<path class="key-link" d="M680,196 L680,126" />
<rect class="table-body" x="20" y="120" width="140" height="56" rx="8" />
<rect class="table-outline" x="20" y="120" width="140" height="56" rx="8" />
<text class="table-name" x="90" y="145" text-anchor="middle">order service</text>
<text class="key-tag" x="90" y="163" text-anchor="middle">places an order</text>
<rect class="table-body" x="220" y="64" width="190" height="90" rx="8" />
<rect class="fact-head" x="220" y="64" width="190" height="30" rx="8" />
<rect class="fact-head" x="220" y="82" width="190" height="12" />
<rect class="table-outline" x="220" y="64" width="190" height="90" rx="8" />
<text class="table-name" x="232" y="84">orders</text>
<text class="key-column" x="232" y="116">id</text><text class="key-tag" x="398" y="116" text-anchor="end">PK</text>
<text x="232" y="140">status = 'placed'</text>
<rect class="table-body" x="220" y="178" width="190" height="90" rx="8" />
<rect class="dimension-head" x="220" y="178" width="190" height="30" rx="8" />
<rect class="dimension-head" x="220" y="196" width="190" height="12" />
<rect class="table-outline" x="220" y="178" width="190" height="90" rx="8" />
<text class="table-name" x="232" y="198">outbox</text>
<text class="key-column" x="232" y="230">event_id</text><text class="key-tag" x="398" y="230" text-anchor="end">PK</text>
<text x="232" y="254">payload: OrderPlaced</text>
<rect class="table-body" x="470" y="196" width="120" height="56" rx="8" />
<rect class="table-outline" x="470" y="196" width="120" height="56" rx="8" />
<text class="table-name" x="530" y="220" text-anchor="middle">relay</text>
<text class="key-tag" x="530" y="238" text-anchor="middle">polls or reads WAL</text>
<rect class="table-body" x="620" y="196" width="120" height="56" rx="8" />
<rect class="table-outline" x="620" y="196" width="120" height="56" rx="8" />
<text class="table-name" x="680" y="220" text-anchor="middle">broker</text>
<text class="key-tag" x="680" y="238" text-anchor="middle">e.g. Kafka</text>
<rect class="table-body" x="620" y="70" width="120" height="56" rx="8" />
<rect class="table-outline" x="620" y="70" width="120" height="56" rx="8" />
<text class="table-name" x="680" y="94" text-anchor="middle">consumers</text>
<text class="key-tag" x="680" y="112" text-anchor="middle">skip seen event_id</text>
</svg>
</div>
<figcaption>One <code>COMMIT</code> writes the order and its event, so both exist or neither does. The relay publishes each outbox row at least once; consumers make the duplicates harmless.</figcaption>
</figure>

- **The relay** either polls the table (`SELECT … FOR UPDATE SKIP LOCKED`, publish, mark sent) or tails the write-ahead log with change data capture (CDC: reading each committed change from the log as it is written), such as the outbox event router of Debezium, an open-source CDC tool, which adds no polling load.
- **Delivery is at least once.** A relay that crashes after publishing but before marking the row sent publishes it again. Each consumer therefore records processed `event_id`s, in the same transaction as its own change, and skips repeats. That makes it an **idempotent consumer**.
- **Ordering** holds per aggregate (the business object an event belongs to, such as one order) when the broker partitions by the aggregate's ID, such as `order_id`.

The outbox and a saga combine: each saga step is a local transaction that also writes the event triggering the next step.

**In an interview**

- *How does PostgreSQL give each transaction a consistent view without read locks?* — MVCC: an update writes a new row version stamped with the writer's transaction ID in `xmin`, and marks the old version's `xmax`. Each transaction reads with a snapshot of which transactions had committed, and sees only versions whose creator committed and whose deleter had not, as of that snapshot. The cost is dead versions, which VACUUM removes, and VACUUM is held back by the oldest open transaction.
- *Your service writes an order and must publish an OrderPlaced event. How do you keep them consistent?* — Transactional outbox: insert the event into an outbox table in the same transaction as the order, then a relay, polling or CDC with Debezium, publishes it. Delivery is at least once, so consumers deduplicate by event ID. I avoid 2PC because the broker usually cannot take part and a dead coordinator leaves participants holding locks.

Sources: [PostgreSQL — MVCC introduction](https://www.postgresql.org/docs/current/mvcc-intro.html) · [PostgreSQL — System columns](https://www.postgresql.org/docs/current/ddl-system-columns.html) · [PostgreSQL — Snapshot functions](https://www.postgresql.org/docs/current/functions-info.html) · [PostgreSQL — Routine vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html) · [PostgreSQL — Vacuum settings](https://www.postgresql.org/docs/current/runtime-config-vacuum.html) · [PostgreSQL — Visibility map](https://www.postgresql.org/docs/current/storage-vm.html) · [PostgreSQL — Client settings (idle_in_transaction_session_timeout)](https://www.postgresql.org/docs/current/runtime-config-client.html) · [PostgreSQL — Transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html) · [PostgreSQL — Serialization failure handling](https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html) · [PostgreSQL — SET TRANSACTION](https://www.postgresql.org/docs/current/sql-set-transaction.html) · [PostgreSQL — Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html) · [PostgreSQL — Lock settings](https://www.postgresql.org/docs/current/runtime-config-locks.html) · [PostgreSQL — SELECT (locking clause)](https://www.postgresql.org/docs/current/sql-select.html) · [PostgreSQL — PREPARE TRANSACTION](https://www.postgresql.org/docs/current/sql-prepare-transaction.html) · [Ports & Grittner, SSI in PostgreSQL (VLDB 2012)](https://arxiv.org/abs/1208.4179) · [Cahill et al., Serializable isolation for snapshot databases (SIGMOD 2008)](https://people.eecs.berkeley.edu/~kubitron/courses/cs262a-F13/handouts/papers/p729-cahill.pdf) · [Garcia-Molina & Salem, Sagas (SIGMOD 1987)](https://dl.acm.org/doi/10.1145/38713.38742) · [microservices.io — Saga](https://microservices.io/patterns/data/saga.html) · [microservices.io — Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html) · [Debezium — Outbox event router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html)
