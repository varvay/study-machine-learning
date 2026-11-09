---
title: Indexes and query plans
---

### Planner statistics and selectivity

The planner picks a plan by estimating the cost of each option, and every cost starts from a guess of how many rows each step returns. Those guesses come from **planner statistics**: a summary of each column's values, gathered by `ANALYZE` from a random sample of rows. Autovacuum runs `ANALYZE` on its own after enough rows change; a manual `ANALYZE` is needed after a bulk load.

The view `pg_stats` shows them per column:

- `null_frac` — the share of rows where the column is null.
- `n_distinct` — the number of distinct values; a negative number is a share of the row count (−1 means every value is unique).
- `most_common_vals` / `most_common_freqs` — the most common values and the share of rows each one holds.
- `histogram_bounds` — boundaries that cut the remaining values into buckets holding equal numbers of rows.
- `correlation` — from −1 to 1, how closely the table's physical row order follows the column's sort order.

`default_statistics_target` (default 100) caps the number of common values and histogram buckets kept; raise it for one skewed column with `ALTER TABLE … ALTER COLUMN … SET STATISTICS 500`.

**Selectivity** is the share of rows a condition keeps, from 0 to 1. The estimate is: rows = rows in table × selectivity.

- `status = 'shipped'`, a common value: selectivity is its frequency from `most_common_freqs`.
- `status = 'lost'`, a value outside the common list: the rows left after the common values are spread evenly over the remaining distinct values.
- `created_at > '2026-09-01'`: the share of histogram buckets above that bound.
- `a = 1 AND b = 2`: the two selectivities **multiplied**, because the planner assumes columns are independent.

The last assumption is the most common source of bad estimates. `city = 'Paris' AND country = 'France'` is estimated as rare, though every Paris row is in France. `CREATE STATISTICS … (dependencies) ON city, country FROM addresses` tells the planner the columns move together; the kinds are `ndistinct`, `dependencies`, and `mcv`.

### Why the planner skips an index

The planner chooses a sequential scan whenever it estimates that scan to be cheaper. It prices a page read in order at `seq_page_cost` = 1.0 and a random page read at `random_page_cost` = 4.0. An index scan jumps to a random heap page for each matching row, so past some share of the table, reading everything in order wins. Causes, from most to least common:

1. **The condition keeps too many rows.** `WHERE status = 'active'` on a table where 70% of rows are active is faster as a sequential scan. The index is correctly ignored.
2. **The estimate is wrong.** Statistics are stale (bulk load, no `ANALYZE` yet) or columns are correlated. The sign in `EXPLAIN ANALYZE` is estimated rows far from actual rows on a node, often by 10× or more. Fix the statistics, not the query.
3. **The query hides the column.** `WHERE lower(email) = …` cannot use an index on `email`; it needs an expression index on `lower(email)`. The same applies to casts from a type mismatch, such as comparing a `bigint` column with a `numeric` value.
4. **The pattern is not anchored.** A B-tree serves `LIKE 'abc%'` but never `LIKE '%abc'`, and outside the C locale (the locale that sorts text by plain byte order; other locales sort by a language's rules) even the prefix form needs an index built with the `text_pattern_ops` operator class. Substring and full-text search need a GIN index (trigram, from the `pg_trgm` extension, which indexes every three-character sequence; or `tsvector`).
5. **The table is small.** A few pages are cheaper to read whole than through an index.
6. **A generic plan.** A prepared statement runs its first five executions with plans built for the actual parameter values; after that, PostgreSQL may switch to one generic plan for all values if it does not look much costlier. A generic plan built for a typical value can be wrong for a rare one. `plan_cache_mode = force_custom_plan` switches this off for a session.
7. **Physical order.** An index scan over a column with `correlation` near 0 reads heap pages in random order, so the planner prices it higher than one over a column whose order matches the table's (correlation near ±1).

To confirm the planner's choice, compare plans in one session only: `SET enable_seqscan = off;` tells the planner to avoid sequential scans wherever another plan exists, so `EXPLAIN ANALYZE` shows the best index plan and its real time. If that plan is truly faster when run, the estimate was wrong (cause 2); if it is slower, the planner was right (cause 1). Never set it globally.

### Write amplification, HOT updates, bloat, and fillfactor

**Write amplification** is the extra physical writing caused by one logical change. PostgreSQL's MVCC (multi-version concurrency control: readers keep seeing old row versions while writers add new ones; in depth: G1.3) turns every `UPDATE` into a new row version, so one updated row normally costs a new heap tuple (a row version in the table's storage), a new entry in *every* index on the table, the WAL records for each, and later VACUUM work to remove the old ones. A table with 8 indexes pays about 9 writes per update. This is why unused indexes are pure cost: find them with `pg_stat_user_indexes.idx_scan = 0` (over a long enough period) and drop them.

A **HOT update** (heap-only tuple) avoids the index writes. It happens when two conditions hold:

- the update changes no indexed column, and
- the new version fits on the same page as the old one.

The new version is then chained from the old one inside the page, no index gets a new entry, and old versions in the chain can be pruned during normal reads, before VACUUM. Watch the ratio `n_tup_hot_upd / n_tup_upd` in `pg_stat_user_tables`.

**Fillfactor** is how full PostgreSQL packs each page on insert, in percent. Tables default to 100 (pages filled completely), which leaves no room for a HOT update on the same page. On a table with frequent updates to unindexed columns, such as a `status` or `last_seen_at`, `ALTER TABLE … SET (fillfactor = 80)` keeps 20% free for new versions. The cost is a table about 25% larger to scan. B-tree indexes default to fillfactor 90.

**Bloat** is space held by dead row versions and half-empty pages. VACUUM marks dead space reusable but rarely returns it to the operating system, so a table or index that once grew stays large; scans then read more pages for the same live rows. Index pages are the worst case, because only VACUUM reclaims them.

- **Measure:** `pgstattuple('orders')` gives the dead and free share of a table; `pgstatindex('orders_pkey')` gives `avg_leaf_density` (low density means bloat).
- **Fix an index:** `REINDEX INDEX CONCURRENTLY` (since PostgreSQL 12) rebuilds it without blocking writes.
- **Fix a table:** `VACUUM FULL` rewrites it compactly but holds an `ACCESS EXCLUSIVE` lock for the whole run, so it is an outage on a large table.
- **Prevent:** lower `autovacuum_vacuum_scale_factor` on large tables so vacuum runs after a smaller share of rows change (the default 0.2 lets a 100-million-row table collect 20 million dead rows first), and keep transactions short, since one old transaction stops VACUUM from removing anything newer than it (G1.3).

### Finding slow queries with `pg_stat_statements`

`pg_stat_statements` is an extension that records execution statistics for every distinct statement. It normalizes each query, replacing literal values with placeholders, so `WHERE id = 7` and `WHERE id = 8` count as one entry. It must be loaded at server start (`shared_preload_libraries = 'pg_stat_statements'`, then `CREATE EXTENSION pg_stat_statements`).

```sql
SELECT queryid,
       calls,
       round(total_exec_time) AS total_ms,
       round(mean_exec_time, 1) AS mean_ms,
       rows / calls AS rows_per_call,
       round(100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0), 1) AS cache_hit_pct,
       left(query, 80) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

- **Sort by `total_exec_time`** to find what costs the server the most: a 2 ms query called a million times outweighs a 5 s report run once.
- **Sort by `mean_exec_time`** to find what users feel as slow.
- **A low cache hit share** means the query reads from disk: it either scans too much or its data does not fit in memory.
- **Many rows per call** on an endpoint that shows ten items means filtering or paging happens in the application.

Then run `EXPLAIN (ANALYZE, BUFFERS)` on the top offenders. A query that is slow only sometimes, such as with one tenant's parameters (a tenant is one customer organization in an application that serves many from one database; G1.8), is caught with the `auto_explain` module: load it through `shared_preload_libraries`, set `auto_explain.log_min_duration` (default −1, off) to, say, `'500ms'`, and PostgreSQL logs the plan of every slower execution. Reset with `pg_stat_statements_reset()` after a fix and compare the next day's numbers.

**In an interview**

- *There is an index on the column, but PostgreSQL does a sequential scan. Why?* — The planner estimated the sequential scan to be cheaper. Either that is true, because the condition keeps a large share of rows and random index reads cost more than one ordered pass, or the estimate is wrong because statistics are stale or the filtered columns are correlated. I check `EXPLAIN ANALYZE` for a large gap between estimated and actual rows, and also rule out a query that hides the column behind a function or cast.
- *Updates on a busy table got slower over months. What do you look at?* — Bloat and write amplification: dead-tuple counts and last autovacuum time in `pg_stat_user_tables`, the HOT-update ratio, and index density with `pgstatindex`. Fixes are dropping unused indexes, lowering fillfactor so updates stay HOT, tuning autovacuum per table, finding long-running transactions, and `REINDEX CONCURRENTLY` for bloated indexes.

Sources: [PostgreSQL — Statistics used by the planner](https://www.postgresql.org/docs/current/planner-stats.html) · [PostgreSQL — pg_stats](https://www.postgresql.org/docs/current/view-pg-stats.html) · [PostgreSQL — Row estimation examples](https://www.postgresql.org/docs/current/row-estimation-examples.html) · [PostgreSQL — Planner cost constants](https://www.postgresql.org/docs/current/runtime-config-query.html) · [PostgreSQL — Index types](https://www.postgresql.org/docs/current/indexes-types.html) · [PostgreSQL — pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html) · [PostgreSQL — PREPARE](https://www.postgresql.org/docs/current/sql-prepare.html) · [PostgreSQL — Heap-only tuples](https://www.postgresql.org/docs/current/storage-hot.html) · [PostgreSQL — CREATE TABLE (fillfactor)](https://www.postgresql.org/docs/current/sql-createtable.html) · [PostgreSQL — Cumulative statistics views](https://www.postgresql.org/docs/current/monitoring-stats.html) · [PostgreSQL — pgstattuple](https://www.postgresql.org/docs/current/pgstattuple.html) · [PostgreSQL — REINDEX](https://www.postgresql.org/docs/current/sql-reindex.html) · [PostgreSQL — Routine vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html) · [PostgreSQL — pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html) · [PostgreSQL — auto_explain](https://www.postgresql.org/docs/current/auto-explain.html)
