---
title: Scaling and distribution
---

### Choosing a shard key, and hot spots

The **shard key** is the column whose value decides which shard stores a row (G1.5 L1). It is the hardest decision in a sharded design, because changing it later means moving most of the data. A good shard key has four properties:

- **High cardinality** — many distinct values, so rows can spread over many shards. `country` has too few; `customer_id` has enough.
- **Even load** — reads and writes spread evenly, not only row counts. A key can split data evenly and still send most traffic to one shard.
- **Matches the main access path** — the most frequent queries name one key value, so each goes to one shard. Queries that do not name the key must ask every shard and merge the answers (**scatter-gather**), and get slower as shards are added.
- **Keeps related rows together** — rows that change in one transaction live on one shard. In a multi-tenant SaaS (software as a service), `tenant_id` puts each tenant's orders, invoices, and users on one shard, so joins and transactions stay local.

A **hot spot** is a shard receiving far more load than the others. Three common causes:

- **A monotonic key with range sharding** (each shard holds one range of key values). Keys such as a timestamp or an auto-increment ID always fall in the newest range, so every insert lands on the last shard. Hash the key, or lead with another column.
- **A skewed value.** One huge tenant, one celebrity account, one viral product. Give the largest tenants their own shards, or split a hot key across several.
- **Time.** All writes for "today" share one date key.

**Write sharding** splits one hot key into several by adding a suffix: the guide for DynamoDB, AWS's managed key-value database, appends a number 1–200 to a date key, so `2014-07-09` becomes `2014-07-09.1` … `2014-07-09.200`. A random suffix spreads writes best but forces reads to query all 200 keys and merge them. A suffix calculated from another attribute, such as a hash of the order ID, spreads writes as well and still lets a read of one order compute its key.

Resharding moves data while the system serves traffic. Plain `hash(key) mod N` makes that expensive; consistent hashing does not.

### Consistent hashing

**Consistent hashing** is a way to assign keys to nodes such that adding or removing a node moves only the keys that must move.

- **The ring** — the output range of a hash function, bent into a circle so the largest value is followed by 0.
- **Placement** — each node is hashed to a point on the ring, and each key is hashed to a point. A key belongs to the first node clockwise from it, so each node owns the arc between the previous node and itself.
- **A join** — a new node takes over part of one arc, the one it lands in, from that arc's owner. Every other key stays put. With n nodes, a join moves about 1/(n + 1) of the keys.
- **Compared with `hash mod N`** — changing N changes almost every key's remainder, so about N/(N + 1) of the keys move: going from 3 to 4 servers moves about three quarters of the data.
- **Virtual nodes** — with one point per node, the arcs have random lengths, so load is uneven, and a node that leaves dumps its whole arc on one neighbor. Dynamo, Amazon's key-value store described in a 2007 paper, gives each physical node many points on the ring (virtual nodes). Load then averages out, a leaving node's arcs spread over many neighbors, and a bigger machine can take more points. Cassandra sets this with `num_tokens`.
- **Replication** — Dynamo stores each key on the first N distinct nodes clockwise (its **preference list**), with a typical configuration of N = 3 copies, writes acknowledged by W = 2, reads answered by R = 2.

The walkthrough below adds a node to a ring and counts the keys that move, beside `hash mod N` for the same keys.

### Replication lag and read-your-writes

**Replication lag** is how far a replica's applied changes trail the primary's. With asynchronous replication it is usually short and grows under write load: Amazon Aurora, AWS's managed MySQL- and PostgreSQL-compatible database, documents replica lag as "usually much less than 100 milliseconds", rising during heavy writes.

The visible symptom: a user saves their profile, the next page reads from a replica that has not applied the change yet, and the old profile appears. The fix is **read-your-writes consistency** — a guarantee that a session always sees its own earlier writes, one of the four session guarantees defined by Terry et al. (1994). Ways to get it:

- **Route by recency.** For a few seconds after a user writes, send that user's reads to the primary. Simple, and it costs primary capacity.
- **Wait for a position in the log.** After the write, read the primary's current position with `pg_current_wal_lsn()` and keep it in the session. Serve a later read from a replica only if `pg_last_wal_replay_lsn()` on that replica has reached it; otherwise use the primary. Exact, and the application carries the log position.
- **Synchronous apply.** `synchronous_commit = remote_apply` makes each commit wait until the synchronous standbys have applied it and it is visible to queries there. Every read is fresh, at the cost of commit latency, and commits stall when the standby does.
- **Monotonic reads.** Pin each session to one replica, so a user never sees data go backwards by switching to a replica further behind.

Replicas have a second trade-off. A long query on a hot standby can conflict with cleanup replayed from the primary. PostgreSQL cancels such queries after `max_standby_streaming_delay` (default 30 s); turning on `hot_standby_feedback` avoids the cancels by holding back VACUUM on the primary, which bloats it.

### PACELC

**PACELC** extends CAP (G1.5 L1): if there is a **P**artition, a system chooses between **A**vailability and **C**onsistency; **E**lse, in normal operation, it chooses between **L**atency and **C**onsistency. The second half matters more day to day, because partitions are rare and every request pays the latency choice. Keeping replicas consistent means waiting for other nodes before answering.

| Class | Behavior | Examples (Abadi's classification) |
|---|---|---|
| PA/EL | stays available in a partition; answers fast from any replica otherwise | Dynamo, Cassandra, Riak |
| PC/EC | refuses rather than be inconsistent, and pays latency for consistency always | VoltDB/H-Store, Megastore |
| PA/EC | consistent normally, available in a partition | MongoDB |
| PC/EL | fast normally, consistent in a partition | PNUTS |

Many systems move between classes by configuration. A PostgreSQL primary with asynchronous replicas answers replica reads with low latency and possibly stale data, an EL choice; with `synchronous_commit = remote_apply` it pays commit latency for consistent replica reads, an EC choice.

### Consensus: Raft, at a high level

**Consensus** is getting several servers to agree on one ordered sequence of decisions, even when some fail. It is how a cluster agrees on which node is the leader and on the order of writes, without a split brain (two nodes both acting as primary). **Raft** is a consensus algorithm designed to be easier to understand than the older Paxos.

- **Roles.** Each server is a leader, a follower, or a candidate. Time is divided into numbered **terms**, each with at most one leader.
- **Leader election.** A follower that hears nothing from a leader within its **election timeout**, chosen at random (the paper suggests 150–300 ms), becomes a candidate and asks the others for votes. A majority of votes makes it leader. The randomness makes split votes rare.
- **Log replication.** The leader appends each client command to its log and sends it to the followers. An entry is **committed** once a majority stores it, and only then applied.
- **Fault tolerance.** A majority must survive, so 2f + 1 servers tolerate f failures: 3 tolerate 1, 5 tolerate 2. An even count adds cost without adding tolerance.

Where it shows up in database work: etcd stores configuration with Raft; Patroni, a high-availability manager for PostgreSQL, keeps its leader lock in a store such as etcd, ZooKeeper, or Consul, so only one PostgreSQL node can be primary; CockroachDB, a distributed SQL database, runs a Raft group per range of data and commits each write on a majority of that range's replicas.

### Cache invalidation and cache stampede

**Cache invalidation** is removing or updating cached values when the source data changes. The common pattern in front of a database is a look-aside cache (cache-aside, G1.5 L2): read from the cache, and on a miss read the database and fill the cache. For writes:

- **Delete, do not update, on write.** After the database commit, delete the cache key; the next read refills it. Facebook's memcache, its in-memory cache tier built on memcached, uses demand-filled look-aside with deletes, because deletes are idempotent: a repeated or reordered delete does no harm, while two cache updates applied in the wrong order leave the older value cached.
- **Stale set race.** A reader misses, reads the old row, and pauses; a writer commits and deletes the key; the reader then writes its old value into the cache, where it stays until the TTL. Facebook's fix is a **lease**: on a miss the cache hands the reader a token, a delete invalidates that token, and a set with an invalidated token is refused.
- **Always set a TTL.** It bounds how long any missed invalidation can serve stale data.

A **cache stampede** (thundering herd) happens when a hot key expires and many requests miss at once, all recomputing the same value and hitting the database together, possibly taking it down. Remedies:

- **Request coalescing.** Only one request recomputes; the others wait for its result or are served the stale value meanwhile. Facebook's leases do this by granting one lease per key per 10 seconds.
- **Probabilistic early expiration (XFetch).** Each reader recomputes early with a probability that rises as expiry approaches: recompute if `now − delta × beta × ln(random()) ≥ expiry`, where `delta` is how long the recompute takes and `beta` > 0 tunes eagerness. Since `ln` of a number in (0, 1) is negative, the left side is `now` plus a random head start, longer for slow recomputes and for a larger `beta`. One reader usually refreshes the value before it expires, with no locks.
- **TTL jitter.** Add a random spread to TTLs so keys written together do not expire together.

**In an interview**

- *How would you shard a multi-tenant SaaS database?* — Shard by `tenant_id`, so each tenant's rows and transactions stay on one shard and most queries hit one shard. Place tenants with consistent hashing and virtual nodes, or a lookup table, so shards can be added without moving everything. Watch for skew: move the largest tenants onto dedicated shards, and keep cross-tenant analytics in a warehouse instead of scatter-gather queries.
- *A user updates their profile, refreshes, and sees the old one. Why, and how do you fix it?* — The read went to an asynchronous replica that had not applied the write yet. I need read-your-writes: route that user's reads to the primary for a short window, or record the commit's log position and read from a replica only once it has replayed past it. `synchronous_commit = remote_apply` also works but charges every commit the latency.

Sources: [AWS — DynamoDB write sharding](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-sharding.html) · [Karger et al., Consistent hashing and random trees (STOC 1997)](https://www.cs.princeton.edu/courses/archive/fall09/cos518/papers/chash.pdf) · [DeCandia et al., Dynamo (SOSP 2007)](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) · [Cassandra — Production recommendations (num_tokens)](https://cassandra.apache.org/doc/latest/cassandra/getting-started/production.html) · [Amazon Aurora — Replication](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Replication.html) · [Terry et al., Session guarantees (1994)](https://www.semanticscholar.org/paper/Session-guarantees-for-weakly-consistent-replicated-Terry-Demers/cbcc3efdefd644f7bf407a79567c0763bdfe560a) · [PostgreSQL — WAL settings (synchronous_commit)](https://www.postgresql.org/docs/current/runtime-config-wal.html) · [PostgreSQL — Administration functions (WAL LSN)](https://www.postgresql.org/docs/current/functions-admin.html) · [PostgreSQL — Replication settings](https://www.postgresql.org/docs/current/runtime-config-replication.html) · [Abadi, PACELC (IEEE Computer 2012)](https://www.cs.umd.edu/~abadi/papers/abadi-pacelc.pdf) · [PACELC classifications](https://en.wikipedia.org/wiki/PACELC_design_principle) · [Ongaro & Ousterhout, Raft (USENIX ATC 2014)](https://raft.github.io/raft.pdf) · [etcd](https://etcd.io/) · [Patroni](https://patroni.readthedocs.io/en/latest/) · [CockroachDB — Replication layer](https://docs.cockroachlabs.com/docs/stable/architecture/replication-layer) · [Nishtala et al., Scaling Memcache at Facebook (NSDI 2013)](https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf) · [Vattani et al., Optimal probabilistic cache stampede prevention (VLDB 2015)](https://www.vldb.org/pvldb/vol8/p886-vattani.pdf)
