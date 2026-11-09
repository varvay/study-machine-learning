---
title: Data layer of an AI app
---

### Multi-tenancy: row-level security or schema per tenant

A **tenant** is one customer organization whose data must stay invisible to every other customer sharing the application. AWS names three ways to place tenants in a database:

| | Pool: shared tables + row-level security | Bridge: schema per tenant | Silo: instance per tenant |
|---|---|---|---|
| How | every row carries `tenant_id`; the database filters by it | same database server, one schema (or database) per tenant | a separate database instance per tenant |
| Isolation | a policy bug exposes other tenants | a wrong `search_path` (the setting that picks which schema an unqualified table name refers to) exposes other tenants | strongest; separate credentials and resources |
| Noisy neighbor (one tenant's load slowing the others) | shared everything | shared CPU and memory | none |
| Schema migrations | run once | run once per tenant: N× the time, and partial failures | once per tenant |
| Per-tenant restore or deletion | row by row | drop one schema | delete one instance |
| Fits | many small tenants | a moderate number of mid-size tenants | a few large or regulated tenants |

Mixed designs are common: pool for most tenants, silo for the few that pay for it or require it.

**Row-level security (RLS)** makes PostgreSQL itself apply a filter to every query on a table, so a forgotten `WHERE tenant_id = …` in application code cannot leak data.

```sql
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON chunks
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

Each request sets the tenant inside its transaction, from the authenticated user, never from user input:

```sql
BEGIN;
SELECT set_config('app.tenant_id', '6f1c…', true);   -- true: only for this transaction
SELECT id, content FROM chunks ORDER BY embedding <=> $1 LIMIT 10;
COMMIT;
```

- **`USING`** filters the rows a query can see; **`WITH CHECK`** rejects inserts and updates that would write another tenant's `tenant_id`.
- **Who bypasses it.** Superusers and roles with `BYPASSRLS` always bypass RLS, and a table's owner does too unless `FORCE ROW LEVEL SECURITY` is set. The application must connect as a separate role that owns nothing.
- **Fail closed.** With RLS enabled and no matching policy, a query sees no rows. `current_setting('app.tenant_id')` raises an error when the setting is missing, which is safer than a default.
- **Connection pools.** PgBouncer in transaction pooling mode hands each transaction a possibly different server connection, and does not support session-level `SET`. `set_config(…, true)` scopes the value to the transaction, so it works; a session-level `SET` would leak one tenant's ID into another tenant's transaction.
- **Indexes lead with `tenant_id`**, since every query filters on it.
- **Vector search under RLS is post-filtered** whenever the planner uses the shared HNSW index: the scan returns candidates from all tenants and the policy then removes other tenants' rows, which causes the short results of G1.7. pgvector's README recommends list partitions or separate tables per tenant for isolation; partition the vector table by `tenant_id` for large tenants.

### Document versioning and lineage

**Lineage** is the recorded path from a piece of output back to the data and processing that produced it. In a RAG app, it answers: which exact version of which document did this answer cite, and what turned that document into the chunks retrieved?

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 372" role="img" aria-labelledby="ai-data-layer-lineage-title">
<title id="ai-data-layer-lineage-title">Lineage tables: documents have versions, versions have chunks, and each assistant message links through message_citations to the chunks it used</title>
<path class="key-link" d="M190,72 C225,72 225,96 260,96" />
<path class="key-link" d="M470,72 C505,72 505,96 540,96" />
<path class="key-link" d="M190,302 L290,302" />
<path class="key-link" d="M490,326 C640,326 640,260 640,180" />
<rect class="table-body" x="20" y="30" width="170" height="102" rx="8" />
<rect class="dimension-head" x="20" y="30" width="170" height="30" rx="8" />
<rect class="dimension-head" x="20" y="48" width="170" height="12" />
<rect class="table-outline" x="20" y="30" width="170" height="102" rx="8" />
<text class="table-name" x="32" y="50">documents</text>
<text class="key-column" x="32" y="76">id</text><text class="key-tag" x="178" y="76" text-anchor="end">PK</text>
<text x="32" y="100">tenant_id</text>
<text x="32" y="124">source_uri</text>
<rect class="table-body" x="260" y="30" width="210" height="150" rx="8" />
<rect class="dimension-head" x="260" y="30" width="210" height="30" rx="8" />
<rect class="dimension-head" x="260" y="48" width="210" height="12" />
<rect class="table-outline" x="260" y="30" width="210" height="150" rx="8" />
<text class="table-name" x="272" y="50">document_versions</text>
<text class="key-column" x="272" y="76">id</text><text class="key-tag" x="458" y="76" text-anchor="end">PK</text>
<text class="key-column" x="272" y="100">document_id</text><text class="key-tag" x="458" y="100" text-anchor="end">FK</text>
<text x="272" y="124">content_hash</text>
<text x="272" y="148">valid_from</text>
<text x="272" y="172">superseded_at</text>
<rect class="table-body" x="540" y="30" width="200" height="150" rx="8" />
<rect class="fact-head" x="540" y="30" width="200" height="30" rx="8" />
<rect class="fact-head" x="540" y="48" width="200" height="12" />
<rect class="table-outline" x="540" y="30" width="200" height="150" rx="8" />
<text class="table-name" x="552" y="50">chunks</text>
<text class="key-column" x="552" y="76">id</text><text class="key-tag" x="728" y="76" text-anchor="end">PK</text>
<text class="key-column" x="552" y="100">document_version_id</text><text class="key-tag" x="728" y="100" text-anchor="end">FK</text>
<text x="552" y="124">content</text>
<text x="552" y="148">embedding</text>
<text x="552" y="172">embedding_model</text>
<rect class="table-body" x="20" y="260" width="170" height="102" rx="8" />
<rect class="dimension-head" x="20" y="260" width="170" height="30" rx="8" />
<rect class="dimension-head" x="20" y="278" width="170" height="12" />
<rect class="table-outline" x="20" y="260" width="170" height="102" rx="8" />
<text class="table-name" x="32" y="280">messages</text>
<text class="key-column" x="32" y="306">id</text><text class="key-tag" x="178" y="306" text-anchor="end">PK</text>
<text x="32" y="330">conversation_id</text>
<text x="32" y="354">content</text>
<rect class="table-body" x="290" y="260" width="200" height="78" rx="8" />
<rect class="dimension-head" x="290" y="260" width="200" height="30" rx="8" />
<rect class="dimension-head" x="290" y="278" width="200" height="12" />
<rect class="table-outline" x="290" y="260" width="200" height="78" rx="8" />
<text class="table-name" x="302" y="280">message_citations</text>
<text class="key-column" x="302" y="306">message_id</text><text class="key-tag" x="478" y="306" text-anchor="end">FK</text>
<text class="key-column" x="302" y="330">chunk_id</text><text class="key-tag" x="478" y="330" text-anchor="end">FK</text>
<text class="note" x="380" y="225" text-anchor="middle">each answer records the chunks it was given</text>
</svg>
</div>
<figcaption>A document is a stable identity; each ingested version is an immutable row; chunks belong to one version and record the model that embedded them. Citations tie every answer to those chunks, so the exact source text of any past answer can be recovered.</figcaption>
</figure>

- **A version is immutable.** Re-ingesting a document computes a hash of its content: an unchanged hash does nothing, which makes re-ingestion idempotent; a new hash creates a new version with new chunks and sets `superseded_at` on the old version.
- **Retrieval reads current versions** (`superseded_at IS NULL`), while old versions stay long enough to explain past answers, then are purged by the retention policy.
- **Chunks record how they were made**: the embedding model (G1.7) and, when chunking rules change, a chunker version, so a re-chunk or re-embed can target exactly the affected rows.
- **Citations are stored, not recomputed.** Retrieval is non-deterministic across index changes, so the list of chunk IDs given to the model is written with the answer, in the same transaction as the message.

### Retention and the right to be forgotten

A **retention policy** states how long each kind of data is kept and what happens after. The **right to erasure** (GDPR Article 17, "right to be forgotten") entitles a person to have their personal data erased "without undue delay" on valid grounds; where the data was made public, the controller (the organization that decides why and how the data is processed) must also take reasonable steps to tell others processing it to erase their links, copies, and replications.

In an AI app, one person's data spreads into many places, and **embeddings count**: Morris et al. (2023) reconstructed 92% of 32-token texts exactly from their embeddings alone, so an embedding must be treated with the same care as its text. The inventory to walk:

- source documents and every stored version of them;
- chunks and their embeddings, in PostgreSQL or any external vector store;
- conversations, messages, and agent memory;
- traces and logs, which often capture prompts and retrieved text verbatim;
- evaluation datasets built from real conversations;
- caches, including semantic caches of past answers (caches that return a stored answer to a question with a similar meaning);
- read replicas, warehouse copies, and backups;
- fine-tuning datasets (examples used to train an existing model further; G4), and any model trained on them.

Design for deletion from day one:

- **Carry a subject key** (`user_id`, or a data-subject ID for people mentioned in documents) on every row derived from personal data, so deletion is a query, not a search.
- **Delete through one job** that walks every store in the inventory and writes a ledger entry per store: what was deleted, when, by which request. The ledger is the proof.
- **Physical removal lags logical deletion.** A deleted PostgreSQL row stays on disk as a dead version until VACUUM (G1.3), and HNSW index entries go with it; backups hold it until they expire. Let backups age out on a short, documented retention period instead of editing them (unsourced: common practice; confirm with the client's data protection officer).
- **Expire by partition.** Partition traces and messages by month (G1.5 L2) and drop whole partitions past their retention period, which is instant and leaves no dead rows.
- **Model weights cannot forget one person.** Keep personal data out of fine-tuning sets (G4), because removing it later means retraining.
- **Crypto-shredding** — encrypting each subject's data with its own key and deleting the key — makes every copy unreadable at once, including backups (unsourced: established technique, not verified against a standard for this page).

### Audit logs

An **audit log** is an append-only record of who did what to which data, when, and from where, kept so access can be proven after the fact.

- **Database level: pgAudit.** The PostgreSQL extension logs statements by class (`read`, `write`, `ddl`, `role`, `function`, `misc`) through the normal PostgreSQL log, per session or per object. It is supported on Amazon RDS for PostgreSQL and Aurora PostgreSQL, and it redacts sensitive values such as cleartext passwords.
- **Application level: an audit table** with actor, tenant, action, resource, request ID, and time. The database cannot know which end user a pooled connection acts for; the application can.
- **Retrieval audit, specific to RAG:** log which chunk IDs were retrieved for which user and request. It proves the access controls held, and it is the evidence when a user claims to have seen another tenant's data.
- **Tamper resistance.** The application role gets `INSERT` only on the audit table (`REVOKE UPDATE, DELETE`). Ship copies to Amazon S3 with Object Lock, a write-once-read-many store; in compliance mode no user, not even the account root, can delete an object before its retention date.
- **Audit logs contain personal data too**: log IDs, not prompt text, and give the log its own retention period.

### Encryption at rest and in transit

**In transit** — TLS (the encryption protocol behind HTTPS) between application and database, and between database nodes.

- PostgreSQL's `ssl` setting is off by default, and the default `sslmode=prefer` of libpq, PostgreSQL's client library used by `psql` and many drivers, falls back to plain text and never verifies the server. Only `sslmode=verify-full` protects against both eavesdropping and a server impersonating the database.
- On Amazon RDS for PostgreSQL, `rds.force_ssl` rejects non-TLS connections; it defaults to on for PostgreSQL 15 and later. RDS for PostgreSQL 16 and later supports TLS 1.3.

**At rest** — encryption of data files, logs, and backups on disk.

- Core PostgreSQL has no built-in transparent data encryption (the database encrypting its own files, invisibly to queries); its docs point to file-system or block-device encryption.
- Amazon RDS and Aurora encrypt storage, logs, automated backups, read replicas, and snapshots with AES-256 under an AWS KMS (Key Management Service) key. Encryption must be chosen when the instance is created. An existing unencrypted instance is encrypted by snapshotting it, copying the snapshot with encryption on, and restoring from the copy. Disabling the KMS key makes the database inaccessible, so the key's policy is part of the availability design.

**Column level** — encrypting individual fields inside the database, with `pgcrypto` (PostgreSQL's extension of encryption functions) or in the application with KMS-managed keys, so even a database administrator sees ciphertext. The price is that the database can no longer index, filter, or search the column. That rules it out for embeddings: pgvector computes distances on the stored values, so an encrypted embedding cannot be searched. Reserve it for fields such as national ID numbers that are displayed, never queried.

**In an interview**

- *How do you isolate tenants in a shared RAG database?* — Shared tables with a `tenant_id` column and PostgreSQL row-level security, with the tenant set per transaction from the authenticated identity through `set_config(…, true)`, so it is safe behind PgBouncer. The application role owns nothing and has no `BYPASSRLS`, and `FORCE ROW LEVEL SECURITY` covers the owner too. For vectors I partition by tenant, because RLS post-filters the HNSW results, which cuts recall and lets tenants affect each other's search. Large or regulated tenants get their own database.
- *A user invokes the right to be forgotten. What do you delete?* — Everything derived from their data, not just the source rows: chunks and embeddings, since embeddings can be inverted back to text, messages, agent memory, traces, eval sets, caches, and every external copy. A subject key on each row makes it one deletion job per store, recorded in a ledger. Physical removal follows through VACUUM and backup expiry, and personal data stays out of fine-tuning sets, because weights cannot be selectively erased.

Sources: [AWS — Multi-tenant data isolation with PostgreSQL row-level security](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security) · [PostgreSQL — Row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) · [PostgreSQL — CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html) · [PostgreSQL — Configuration functions (current_setting, set_config)](https://www.postgresql.org/docs/current/functions-admin.html) · [PgBouncer — Features](https://www.pgbouncer.org/features.html) · [pgvector README (multitenancy)](https://github.com/pgvector/pgvector) · [GDPR Article 17](https://gdpr-info.eu/art-17-gdpr/) · [Morris et al., Text embeddings reveal (almost) as much as text (EMNLP 2023)](https://arxiv.org/abs/2310.06816) · [Amazon RDS — pgAudit](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.pgaudit.html) · [Amazon S3 — Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html) · [PostgreSQL — SSL support in libpq](https://www.postgresql.org/docs/current/libpq-ssl.html) · [PostgreSQL — Connection settings](https://www.postgresql.org/docs/current/runtime-config-connection.html) · [PostgreSQL — Encryption options](https://www.postgresql.org/docs/current/encryption-options.html) · [Amazon RDS — SSL with PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html) · [Amazon RDS — Encrypting resources](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html)
