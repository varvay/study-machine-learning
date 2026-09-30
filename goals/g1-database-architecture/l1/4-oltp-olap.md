---
title: OLTP, OLAP, and warehousing
---

Databases serve two kinds of work:

- **OLTP** (online transaction processing) — the day-to-day reads and writes of an application, each touching a few rows. It runs the business.
- **OLAP** (online analytical processing) — queries that scan and aggregate large amounts of history. It analyzes the business.

| | OLTP | OLAP |
|---|---|---|
| Example query | place order 1042 | total revenue per region per month, over 3 years |
| Shape | many small reads and writes, each touching a few rows | few large reads, each scanning millions of rows |
| Storage | row-oriented | column-oriented |
| Schema | normalized to 3NF | star schema, with denormalized dimension tables |

- **Row storage** keeps all columns of one row together on disk. Reading or updating one order is one small read.
- **Column storage** keeps all values of one column together. Summing `revenue` reads only the revenue column, never names or addresses. Values in one column look alike, so they also compress well.

So analytics usually runs on a separate copy of the data: a scan of millions of rows would slow the application's database, and its row storage makes such scans slow anyway.

- **Data warehouse** — a database built for OLAP. Data is copied into it from many OLTP systems, cleaned, and given one consistent structure. The copy job is **ETL**: extract from the sources, transform, load. Examples: Snowflake, BigQuery, Redshift.
- **Data lake** — cheap object storage, such as Amazon S3, that holds files in any format as they arrive: CSV, JSON, Parquet (a column-oriented file format), images, logs. Structure is decided later, when someone reads the data.
- **Lakehouse** — a data lake plus a **table format** such as Delta Lake or Apache Iceberg. The table format records which files make up a table and each version of it, so SQL engines can query and update the files like warehouse tables. One copy of the data then serves both raw storage and analytics.
- **Star schema** — a warehouse layout with one central table of events linked to several tables that describe them. The central **fact table** holds events with their numbers, such as one row per sale with amount and quantity. Each fact row holds keys to **dimension tables** that describe the event: date, product, store, customer.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 410" role="img" aria-labelledby="star-schema-title">
<title id="star-schema-title">Star schema: the fact table fact_sales in the middle, linked by foreign keys to four dimension tables</title>
<path class="key-link" d="M280,185 C240,185 240,62 200,62" />
<path class="key-link" d="M480,209 C520,209 520,62 560,62" />
<path class="key-link" d="M280,233 C240,233 240,332 200,332" />
<path class="key-link" d="M480,257 C520,257 520,332 560,332" />
<rect class="table-body" x="20" y="20" width="180" height="150" rx="8" />
<rect class="dimension-head" x="20" y="20" width="180" height="30" rx="8" />
<rect class="dimension-head" x="20" y="38" width="180" height="12" />
<rect class="table-outline" x="20" y="20" width="180" height="150" rx="8" />
<text class="table-name" x="32" y="40">dim_date</text>
<text class="key-column" x="32" y="66">date_id</text><text class="key-tag" x="188" y="66" text-anchor="end">PK</text>
<text x="32" y="90">day</text>
<text x="32" y="114">month</text>
<text x="32" y="138">quarter</text>
<text x="32" y="162">year</text>
<rect class="table-body" x="560" y="20" width="180" height="126" rx="8" />
<rect class="dimension-head" x="560" y="20" width="180" height="30" rx="8" />
<rect class="dimension-head" x="560" y="38" width="180" height="12" />
<rect class="table-outline" x="560" y="20" width="180" height="126" rx="8" />
<text class="table-name" x="572" y="40">dim_product</text>
<text class="key-column" x="572" y="66">product_id</text><text class="key-tag" x="728" y="66" text-anchor="end">PK</text>
<text x="572" y="90">name</text>
<text x="572" y="114">brand</text>
<text x="572" y="138">category</text>
<rect class="table-body" x="280" y="143" width="200" height="174" rx="8" />
<rect class="fact-head" x="280" y="143" width="200" height="30" rx="8" />
<rect class="fact-head" x="280" y="161" width="200" height="12" />
<rect class="table-outline" x="280" y="143" width="200" height="174" rx="8" />
<text class="table-name" x="292" y="163">fact_sales</text>
<text class="key-column" x="292" y="189">date_id</text><text class="key-tag" x="468" y="189" text-anchor="end">FK</text>
<text class="key-column" x="292" y="213">product_id</text><text class="key-tag" x="468" y="213" text-anchor="end">FK</text>
<text class="key-column" x="292" y="237">store_id</text><text class="key-tag" x="468" y="237" text-anchor="end">FK</text>
<text class="key-column" x="292" y="261">customer_id</text><text class="key-tag" x="468" y="261" text-anchor="end">FK</text>
<text x="292" y="285">amount</text><text class="key-tag" x="468" y="285" text-anchor="end">measure</text>
<text x="292" y="309">quantity</text><text class="key-tag" x="468" y="309" text-anchor="end">measure</text>
<rect class="table-body" x="20" y="290" width="180" height="102" rx="8" />
<rect class="dimension-head" x="20" y="290" width="180" height="30" rx="8" />
<rect class="dimension-head" x="20" y="308" width="180" height="12" />
<rect class="table-outline" x="20" y="290" width="180" height="102" rx="8" />
<text class="table-name" x="32" y="310">dim_store</text>
<text class="key-column" x="32" y="336">store_id</text><text class="key-tag" x="188" y="336" text-anchor="end">PK</text>
<text x="32" y="360">city</text>
<text x="32" y="384">region</text>
<rect class="table-body" x="560" y="290" width="180" height="102" rx="8" />
<rect class="dimension-head" x="560" y="290" width="180" height="30" rx="8" />
<rect class="dimension-head" x="560" y="308" width="180" height="12" />
<rect class="table-outline" x="560" y="290" width="180" height="102" rx="8" />
<text class="table-name" x="572" y="310">dim_customer</text>
<text class="key-column" x="572" y="336">customer_id</text><text class="key-tag" x="728" y="336" text-anchor="end">PK</text>
<text x="572" y="360">name</text>
<text x="572" y="384">segment</text>
<text class="note" x="380" y="40" text-anchor="middle">dimensions: when, what, where, who</text>
<text class="note" x="380" y="345" text-anchor="middle">fact: one row per sale</text>
</svg>
</div>
<figcaption>Each sale is one row of <code>fact_sales</code>. Its foreign keys point to the dimension rows that describe it; its measures are the numbers to add up.</figcaption>
</figure>

A report joins the fact table to the dimensions it groups by, then sums a measure:

```sql
SELECT s.region, d.month, SUM(f.amount) AS revenue
FROM fact_sales f
JOIN dim_store s ON s.store_id = f.store_id
JOIN dim_date d ON d.date_id = f.date_id
GROUP BY s.region, d.month;
```

**Is a star schema normalized?** Only partly.

- The **fact table** is normalized: each measure depends on the whole set of dimension keys and nothing else.
- The **dimension tables** break **3NF** on purpose. In `dim_store`, `region` depends on `city`, a non-key column, so every store in the same city repeats its region. In `dim_date`, `quarter` depends on `month`. They still meet 2NF: a one-column key has no part for a column to depend on.
- A **snowflake schema** normalizes the dimensions to 3NF. There, `dim_store` replaces `city` and `region` with a `city_id` that points to `dim_city(city_id, city, region_id)`, which points to `dim_region(region_id, region)`. Each region is stored once, and a report needs one more join per level.

The star is the usual choice. Dimension tables are small next to the fact table, so the repeats cost little, and they change rarely, so update anomalies are rare. In return, a report needs one join per dimension, which keeps SQL simple and queries fast. Snowflaking pays off when a dimension is very large or changes often.
