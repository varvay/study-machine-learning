---
title: Relational modeling
---

### BCNF, and when 3NF is enough

Two terms make the normal forms precise:

- **Functional dependency** X → Y — knowing the value of column set X fixes the value of Y. In `customers`, `id → city`.
- **Candidate key** — a minimal set of columns whose values identify each row; any superset of one is a **superkey**. A table can have several candidate keys; the one chosen as the primary key is just one of them.

**Boyce–Codd normal form (BCNF)** — for every non-trivial dependency X → Y in the table, X is a superkey. In words: the only things that decide other columns are keys.

3NF is looser in one case. It also allows X → Y when Y is part of some candidate key. So a table in 3NF can break BCNF only when it has two or more candidate keys that overlap.

Example: a tutoring table `tutoring(student, course, tutor)` with two rules — each tutor teaches exactly one course (`tutor → course`), and a student has one tutor per course (`(student, course) → tutor`).

- Candidate keys: `(student, course)` and `(student, tutor)`. They overlap on `student`.
- It is in 3NF: `course` is part of a candidate key, so `tutor → course` is allowed.
- It breaks BCNF: `tutor` alone is not a superkey, yet it decides `course`. So a tutor's course is repeated for every student they teach; changing it means updating many rows, and a tutor with no students cannot be recorded.
- The BCNF split is `tutors(tutor, course)` and `tutor_students(student, tutor)`. Every fact now lives once.
- The split loses a rule: "one tutor per student per course" spans both tables, so no single key enforces it. It needs a trigger (a function the database runs automatically on each insert, update, or delete of a table) or a check in the application.

That loss is the whole trade-off. A 3NF design can always be reached without losing data (lossless) and with every dependency still enforceable inside one table (dependency-preserving). BCNF is always lossless but sometimes loses a dependency.

- **Go to BCNF** when the repeated fact changes often or must be recorded on its own, as with the tutor's course.
- **Stay at 3NF** when the BCNF split would move a business rule out of the database's keys and into code.
- **In practice** most 3NF tables are already in BCNF, because overlapping candidate keys are rare. Check for them when a table has more than one natural key.

### Denormalizing read-heavy paths

A read path is **read-heavy** when it runs far more often than its data changes, such as a dashboard total read thousands of times a minute from orders that change a few times a second. Recomputing a join or an aggregate on every read wastes work, so the result is stored instead. The stored copy then has to be kept consistent with its source. Three ways to store it:

| | Materialized view | Summary table kept by triggers | Read model updated from events |
|---|---|---|---|
| What it is | a query whose result PostgreSQL stores as a table | a table the database updates in the same transaction as each source write | a table a separate consumer updates after each change event (G1.3 outbox) |
| Freshness | stale until the next `REFRESH` | always current | seconds behind |
| Write cost | none per write; the refresh recomputes everything | every source write also updates the summary | none on the write path |
| Main risk | heavy refreshes; stale reads | lock contention on hot summary rows | lost or duplicated events |

- **Materialized view.** `REFRESH MATERIALIZED VIEW` recomputes the whole result and takes an `ACCESS EXCLUSIVE` lock, which blocks reads while it runs. `REFRESH MATERIALIZED VIEW CONCURRENTLY` keeps reads running (it takes a weaker `EXCLUSIVE` lock) but needs a `UNIQUE` index on plain columns, with no expression and no `WHERE`. PostgreSQL has no automatic or incremental refresh: run it from a scheduled job and accept staleness up to the interval.
- **Trigger-maintained summary.** Exact, but it moves cost to writes. If every order updates the same `daily_totals` row, every order transaction waits for that one row lock, so writes serialize. Spread the hot row: keep several counter rows per day (e.g. by `order_id % 8`) and sum them on read.
- **Event-driven read model.** Keeps the write path fast and can live in another store, such as a search index. It is eventually consistent (reads can trail the source, and catch up once the events are applied), and its consumer must be idempotent (processing an event twice leaves the same result as once) because events can arrive twice.

Whatever the method, keep three rules:

- One table is the **source of truth**; the copy is derived and disposable.
- The copy can be **rebuilt from scratch** by a script, so a bug is fixed by rebuilding, not by patching rows.
- A **reconciliation job** compares the copy with the source (row counts, totals) and alerts on drift.

### Schema migrations without downtime

A **schema migration** is a versioned script that changes the schema, run in order by a tool that records which scripts have run.

- **Flyway** — plain SQL files named `V<version>__<description>.sql`, run in version order. It records each applied file with a checksum in `flyway_schema_history`, and refuses to run if an applied file was edited.
- **Liquibase** — a changelog (XML, YAML, JSON, or SQL) of **changesets**, each identified by id, author, and file. It records them in `DATABASECHANGELOG` and uses `DATABASECHANGELOGLOCK` so only one instance migrates at a time. Changesets can declare a rollback.
- **Spring Boot** runs either tool automatically at startup when its dependency is on the classpath.

The tool orders the changes; it does not make them safe. Two things cause downtime:

- **Locks.** Most `ALTER TABLE` forms take an `ACCESS EXCLUSIVE` lock, which blocks every read and write on the table. While the `ALTER` waits for that lock behind a long query, later queries queue behind it too (unsourced: observed PostgreSQL lock-queue behavior), so a one-millisecond change can stall traffic for minutes. Set `lock_timeout` (default 0, meaning wait forever) to a few seconds in migrations and retry on failure.
- **Incompatible versions.** During a rolling deploy, old and new application instances run at the same time against one schema. Renaming or dropping a column breaks the instances that still use the old name.

**Expand–contract** (also called **parallel change**) splits a breaking change into steps that each keep both application versions working. Example: rename `customers.name` to `full_name`.

| Step | Schema | Application |
|---|---|---|
| 1. Expand | add nullable `full_name` | old version, unchanged |
| 2. Dual write | — | new version writes both columns, still reads `name` |
| 3. Backfill | copy `name` into `full_name` in batches of a few thousand rows, each its own transaction | — |
| 4. Switch reads | add `NOT NULL` once every row is filled | reads `full_name`, still writes both |
| 5. Contract | drop `name`, in a later release | writes only `full_name` |

Each step can be deployed and rolled back on its own, and at no point does a running instance see a schema it does not understand. Batching the backfill keeps each transaction short, so it holds few locks and does not block VACUUM (G1.3).

PostgreSQL features that keep individual steps cheap:

- `ADD COLUMN` with a non-volatile default, one with a single value for the whole statement such as a constant or `now()` (unlike `random()`, which differs per row), does not rewrite the table (since PostgreSQL 11).
- `CREATE INDEX CONCURRENTLY` builds an index without blocking writes. It cannot run inside a transaction block, and both tools wrap each migration in one by default, so switch that off for that one script: `executeInTransaction=false` in a Flyway script configuration file (`V7__add_index.sql.conf`), `runInTransaction: false` on a Liquibase changeset. If it fails, it leaves an `INVALID` index to drop and retry.
- `ADD CONSTRAINT … NOT VALID` adds a foreign key or check for new rows only; `VALIDATE CONSTRAINT` then checks old rows while holding only a `SHARE UPDATE EXCLUSIVE` lock, which lets reads and writes continue.
- `SET NOT NULL` skips its full-table scan when a valid `CHECK (col IS NOT NULL)` constraint already proves it (since PostgreSQL 12).

**In an interview**

- *When would you stop at 3NF instead of going to BCNF?* — When the BCNF decomposition would lose a dependency, so a business rule the key used to enforce would move into a trigger or application code. BCNF only differs from 3NF when a table has overlapping candidate keys, which is rare, so most 3NF schemas are already BCNF. I go to BCNF when the repeated fact changes often enough to cause update anomalies.
- *How do you rename a column on a table that serves traffic 24/7?* — Expand–contract: add the new column, deploy code that writes both, backfill in small batches, switch reads, then drop the old column in a later release. Each step is backward compatible, so old and new instances coexist during rolling deploys. I also set `lock_timeout` so a DDL statement that cannot get its lock fails fast instead of queuing traffic behind it.

Sources: [Boyce–Codd normal form](https://en.wikipedia.org/wiki/Boyce%E2%80%93Codd_normal_form) · [PostgreSQL — REFRESH MATERIALIZED VIEW](https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html) · [PostgreSQL — Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html) · [PostgreSQL — ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html) · [PostgreSQL — CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html) · [PostgreSQL — lock_timeout](https://www.postgresql.org/docs/current/runtime-config-client.html) · [Flyway — Versioned migrations](https://documentation.red-gate.com/fd/versioned-migrations-273973333.html) · [Flyway — Script configuration](https://documentation.red-gate.com/fd/script-configuration-277578847.html) · [Liquibase — DATABASECHANGELOG table](https://docs.liquibase.com/concepts/tracking-tables/databasechangelog-table.html) · [Liquibase — runInTransaction](https://docs.liquibase.com/concepts/changelogs/attributes/run-in-transaction.html) · [Spring Boot — Database initialization](https://docs.spring.io/spring-boot/how-to/data-initialization.html) · [Martin Fowler — Parallel change](https://martinfowler.com/bliki/ParallelChange.html)
