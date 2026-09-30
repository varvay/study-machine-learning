---
title: Indexes and query plans
---

An **index** is a second structure, kept beside a table, that lists one column's values in sorted order, each with the location of its row. It works like the index at the back of a book: look up the word, get the page number, open that page.

- **Sequential scan** — reading every row of a table and testing each one against the condition. It is the only option when no index fits: with no index on `email`, `WHERE email = 'a@x.com'` reads the whole table.
- **Index scan** — searching the index for the matching entries, then reading only the rows they point to. With an index on `email`, the same query reads a few pages.
- **The cost of an index** — slower writes and more disk space: each insert, update, or delete must also change every index on the table. So index the columns that queries filter, join, or sort on, and leave the rest.
- **B-tree** — the default index type: a shallow tree whose nodes hold sorted values. Because the values are sorted, one B-tree answers equality (`=`), ranges (`<`, `>`, `BETWEEN`), and `ORDER BY`. Each level narrows the search, so finding one row among millions reads only a few **pages**, the fixed-size blocks (8 KB in PostgreSQL) a database reads from disk.
- **Hash index** — stores each value by its hash, a number computed from the value. Hashing scatters the order, so a hash index answers `=` only.
- **Query plan** — the steps the database picks to run one query: which table to read first, whether to scan or use an index, and how to join. You never tell it to use an index; its planner estimates the cost of each option and picks the cheapest. `EXPLAIN` before a query prints the plan it chose.

The walkthrough below draws the index as a sorted list searched by halving: read the middle value, then keep only the half that can still hold the target.

Source: [PostgreSQL — Index Types](https://www.postgresql.org/docs/current/indexes-types.html)
