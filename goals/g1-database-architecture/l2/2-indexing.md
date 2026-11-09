---
title: Indexes and query plans
---

Recap (G1.2 L1): an index is a sorted structure beside the table that turns a full scan into a short search, at the cost of slower writes. Here you create PostgreSQL's main index shapes and read the plans that prove they work.

Every plan below is real output from PostgreSQL 14 on a laptop, trimmed, against this table of one million support tickets. Your timings will differ; the plan shapes will not.

```sql
CREATE TABLE tickets (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint      NOT NULL,       -- 10,000 customers, ~100 tickets each
  status      text        NOT NULL,       -- 2% 'open', the rest 'closed'
  created_at  timestamptz NOT NULL,
  subject     text        NOT NULL,
  tags        text[]      NOT NULL,       -- 1% carry 'urgent'
  payload     jsonb       NOT NULL        -- {"channel": "chat", "priority": 2}
);
```

**Reading `EXPLAIN ANALYZE`.** `EXPLAIN` prints the plan the planner chose; `EXPLAIN ANALYZE` also runs the query and adds what really happened. The plan is a tree: each `->` node feeds rows to the node above it, so read it from the most indented line outward. On each node:

- `cost=4.88..175.34` — the planner's estimate in arbitrary units (reading one page in sequence costs 1.0): the cost before the first row comes out, then the cost to return all rows.
- `rows=44` — the **estimated** number of rows this node returns; `width` is their average size in bytes.
- `actual time=0.133..0.494 rows=57 loops=1` — the **measured** time in milliseconds to the first and last row, the actual rows, and how many times the node ran. Time and rows are per loop, so multiply by `loops`.
- `Filter:` with `Rows Removed by Filter:` — a condition tested row by row after reading, and how many rows it threw away. A large count means the query read far more than it kept.

`EXPLAIN ANALYZE` executes the statement. For an `UPDATE` or `DELETE`, wrap it in `BEGIN; … ROLLBACK;`. Add `BUFFERS` (`EXPLAIN (ANALYZE, BUFFERS)`) to see how many pages came from memory (`shared hit`) and how many from disk (`read`).

**The scan types:**

- **Seq Scan** — reads every page of the table. `Parallel Seq Scan` splits that work across worker processes, and the `Gather` node above it collects their rows.
- **Index Scan** — walks the index to each match, then fetches that row from the table. Best for a few rows, or when the index order saves a sort.
- **Bitmap Index Scan + Bitmap Heap Scan** — the **heap** is PostgreSQL's name for the table's own storage, as opposed to its indexes. This pair first collects the locations of all matches from the index into a bitmap, sorted by page, then reads those pages in physical order. Best for more rows than an index scan suits and fewer than a full scan. `Recheck Cond` is the index condition re-tested on each row read.
- **Index Only Scan** — answers from the index alone, never touching the table. It needs every column the query uses to be in the index.

**Composite index and the leftmost-prefix rule.** A **composite index** is one index on several columns, sorted by the first column, then by the second within equal firsts, like a phone book sorted by surname, then first name. The **leftmost-prefix rule** follows from that order: the index can narrow the search on the first column, on the first two, and so on, but not on a later column alone. PostgreSQL's exact rule: equality conditions on the leading columns, plus a range condition on the first column without an equality, limit the part of the index scanned.

Without an index, one customer's recent tickets cost a full scan:

```sql
EXPLAIN ANALYZE
SELECT * FROM tickets WHERE customer_id = 42 AND created_at >= '2026-06-01';
```

```text
Gather  (cost=1000.00..27197.40 rows=44 width=125) (actual time=4.104..173.940 rows=57 loops=1)
  Workers Planned: 2
  ->  Parallel Seq Scan on tickets  (cost=0.00..26193.00 rows=18 width=125) (actual time=2.458..125.446 rows=19 loops=3)
        Filter: ((created_at >= '2026-06-01 00:00:00+07') AND (customer_id = 42))
        Rows Removed by Filter: 333314
Execution Time: 174.010 ms
```

Three processes (the leader and two workers, so `loops=3`) each discarded about 333,000 rows to keep about 19. Add a composite index, equality column first:

```sql
CREATE INDEX tickets_customer_created ON tickets (customer_id, created_at);
```

```text
Bitmap Heap Scan on tickets  (cost=4.88..175.34 rows=44 width=125) (actual time=0.133..0.494 rows=57 loops=1)
  Recheck Cond: ((customer_id = 42) AND (created_at >= '2026-06-01 00:00:00+07'))
  Heap Blocks: exact=57
  ->  Bitmap Index Scan on tickets_customer_created  (cost=0.00..4.87 rows=44 width=0) (actual time=0.104..0.105 rows=57 loops=1)
        Index Cond: ((customer_id = 42) AND (created_at >= '2026-06-01 00:00:00+07'))
Execution Time: 0.545 ms
```

174 ms became 0.5 ms, and both conditions moved into `Index Cond`. The same index serves `WHERE customer_id = 42` alone (a leftmost prefix), and it removes the sort from "latest ten tickets of a customer":

```sql
EXPLAIN ANALYZE
SELECT id, created_at FROM tickets WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 10;
```

```text
Limit  (cost=0.42..41.00 rows=10 width=16) (actual time=0.015..0.029 rows=10 loops=1)
  ->  Index Scan Backward using tickets_customer_created on tickets  (actual time=0.014..0.026 rows=10 loops=1)
        Index Cond: (customer_id = 42)
Execution Time: 0.051 ms
```

It does not serve `WHERE created_at >= '2026-09-26'` alone: without `customer_id`, the matching dates are spread across every customer's part of the index, and the plan is back to `Parallel Seq Scan`. So order the columns by the queries: equality columns first, then the range or sort column.

**Partial index.** A **partial index** indexes only the rows that match its `WHERE` clause. Only 2% of tickets are open, and the support queue only asks about open ones:

```sql
CREATE INDEX tickets_open_created ON tickets (created_at) WHERE status = 'open';

EXPLAIN ANALYZE
SELECT id FROM tickets WHERE status = 'open' AND created_at >= '2026-09-20';
```

```text
Bitmap Heap Scan on tickets  (actual time=0.319..2.817 rows=563 loops=1)
  ->  Bitmap Index Scan on tickets_open_created  (actual time=0.178..0.179 rows=563 loops=1)
        Index Cond: (created_at >= '2026-09-20 00:00:00+07')
Execution Time: 2.927 ms
```

The index is 456 kB, against 30 MB for the full composite index, and writes to closed tickets never touch it. The planner uses it only when the query's `WHERE` clearly implies the index's predicate, its own `WHERE` clause. A prepared statement (a query sent once with placeholders `$1`, `$2`, then run many times with values filled in) with `status = $1` does not qualify, because the planner cannot know `$1` will be `'open'`.

**Covering index (`INCLUDE`).** A **covering index** holds every column a query needs, so the answer comes from the index alone. `INCLUDE` adds columns as payload: stored in the index's leaf entries (the bottom level of the B-tree, one entry per row), never used to search or sort. `VACUUM` below is PostgreSQL's cleanup pass: it removes row versions no transaction can see any more and records which pages hold only visible rows (in depth: G1.3 L3).

```sql
CREATE INDEX tickets_customer_covering ON tickets (customer_id) INCLUDE (status);
VACUUM tickets;

EXPLAIN ANALYZE
SELECT customer_id, status FROM tickets WHERE customer_id BETWEEN 42 AND 45;
```

```text
Index Only Scan using tickets_customer_covering on tickets  (actual time=0.043..0.129 rows=431 loops=1)
  Index Cond: ((customer_id >= 42) AND (customer_id <= 45))
  Heap Fetches: 0
```

`Heap Fetches: 0` means no table page was read. The count rises when many rows changed since the last `VACUUM`: the index does not know whether a changed row is visible to this transaction, so PostgreSQL checks the table page, which the **visibility map** (one bit per page: "every row here is visible to everyone") lets it skip. Autovacuum, a background process that runs `VACUUM` on each table as rows change, keeps that map current.

**GIN index.** A **GIN** (generalized inverted index) indexes the elements inside a value: each array element, each JSON key and value (`jsonb` is PostgreSQL's binary JSON column type), each word of a document. Each element points to the list of rows that contain it, like a book's index pointing from a word to its pages. A B-tree indexes a value as a whole, so it cannot answer "which rows' `tags` contain `'urgent'`".

```sql
CREATE INDEX tickets_tags_gin    ON tickets USING gin (tags);
CREATE INDEX tickets_payload_gin ON tickets USING gin (payload jsonb_path_ops);

SELECT id FROM tickets WHERE tags @> ARRAY['urgent'];                                -- array contains
SELECT id FROM tickets WHERE payload @> '{"channel": "email", "priority": 3}';       -- JSON contains
```

Both plans show `Bitmap Index Scan on tickets_tags_gin` / `tickets_payload_gin` with the condition in `Index Cond`. GIN plans are always bitmap scans: GIN returns a set of row locations, not rows one by one in order. With bitmap scans switched off (`SET enable_bitmapscan = off`), the same query falls back to a sequential scan.

An **operator class** tells an index which operators it can answer for a column type; `jsonb_path_ops` above picks one.

| Operator class | Indexed operators | Choose it when |
|---|---|---|
| `array_ops` (default for arrays) | `@>` (contains), `<@` (is contained by), `&&` (overlaps), `=` | filtering by array elements |
| `jsonb_ops` (default for `jsonb`) | `@>`, `?` (key exists), `?\|` / `?&` (any / all of these keys exist), `@?` / `@@` (JSON path match) | you also test key existence (`payload ? 'priority'`) |
| `jsonb_path_ops` | `@>`, `@?`, `@@` | containment only; smaller and faster |
| `tsvector_ops` | `@@` (text matches a search) | full-text search (G1.7) |

**Estimated vs actual rows.** The planner picks a plan from its estimates, so a big gap between `rows=` estimated and `rows=` actual is the first thing to look for in a slow plan:

```sql
EXPLAIN ANALYZE SELECT id FROM tickets WHERE lower(subject) = 'subject 5';
```

```text
Gather  (cost=1000.00..27693.00 rows=5000 width=8) (actual time=1.892..2973.927 rows=1 loops=1)
  ->  Parallel Seq Scan on tickets  (actual time=1950.175..2931.856 rows=0 loops=3)
        Filter: (lower(subject) = 'subject 5'::text)
```

The planner guessed 5,000 rows and got 1. It keeps statistics per column, not for `lower(subject)`, so it fell back to a fixed guess: 0.5% of the rows (`DEFAULT_EQ_SEL` in the PostgreSQL source). An **expression index**, an index on a computed value, fixes both the path and the estimate: after `CREATE INDEX ON tickets (lower(subject))` and `ANALYZE` (the command that re-samples the table to refresh the planner's statistics), the same query plans `rows=1`, runs as an `Index Scan`, and takes 5 ms instead of 3 s. When the gap is on a plain column, run `ANALYZE tickets` first: its statistics may be stale.

Sources: [PostgreSQL — Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html) · [Multicolumn Indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html) · [Partial Indexes](https://www.postgresql.org/docs/current/indexes-partial.html) · [Index-Only Scans and Covering Indexes](https://www.postgresql.org/docs/current/indexes-index-only-scans.html) · [GIN Indexes](https://www.postgresql.org/docs/current/gin.html) · [Indexes on Expressions](https://www.postgresql.org/docs/current/indexes-expressional.html) · [PostgreSQL source — `DEFAULT_EQ_SEL`](https://github.com/postgres/postgres/blob/master/src/include/utils/selfuncs.h)
