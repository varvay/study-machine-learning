---
title: OLTP, OLAP, and warehousing
---

### Slowly changing dimensions

A **slowly changing dimension (SCD)** is a dimension whose attributes change now and then, such as a customer moving from the North region to the South. The question is what past facts should say: were last year's sales made in the North or the South? Each **SCD type** is one answer.

- **Type 1 — overwrite.** Update the attribute in place. History is lost: every past sale of that customer now reports under South. Use it for corrections (a misspelled name) and attributes nobody reports history on.
- **Type 2 — add a row.** Keep the old row, close it, and insert a new one. Each row is one *version* of the customer and gets its own **surrogate key**, a meaningless integer, alongside the **natural key** from the source system (`customer_id`). Each row also carries the period it was valid and a current-row flag. Use it whenever reports must show facts as they were at the time.

Type 2 `dim_customer` after the customer moved on 2026-04-01; `valid_to` is exclusive:

| customer_key | customer_id | region | valid_from | valid_to | is_current |
|---|---|---|---|---|---|
| 101 | C7 | North | 2024-01-01 | 2026-04-01 | false |
| 245 | C7 | South | 2026-04-01 | 9999-12-31 | true |

- **Facts store the surrogate key** of the version valid when the event happened. A sale on 2025-06-10 holds `customer_key = 101`, so revenue by region keeps it in the North forever, with no date logic at query time.
- **Loading a fact** looks up that key by natural key and event time: `sold_at >= valid_from AND sold_at < valid_to`. The same lookup handles late-arriving facts, which arrive after the dimension has already changed.
- **Joining facts to the dimension on `customer_id` with `is_current = true`** is the classic bug: it silently turns Type 2 back into Type 1.

A Type 2 load closes changed rows, then inserts a new current row for every customer that has none:

```sql
UPDATE dim_customer d
SET valid_to = s.changed_at, is_current = false
FROM staging_customer s
WHERE d.customer_id = s.customer_id
  AND d.is_current
  AND d.region IS DISTINCT FROM s.region;

INSERT INTO dim_customer (customer_id, region, valid_from, valid_to, is_current)
SELECT s.customer_id, s.region, s.changed_at, DATE '9999-12-31', true
FROM staging_customer s
LEFT JOIN dim_customer d ON d.customer_id = s.customer_id AND d.is_current
WHERE d.customer_id IS NULL;
```

dbt **snapshots** implement the same Type 2 logic from a model definition, adding `dbt_valid_from` and `dbt_valid_to` columns; they detect changes by an `updated_at` column (`timestamp` strategy) or by comparing listed columns (`check` strategy).

The cost of Type 2 is growth: an attribute that changes daily, such as a loyalty score, multiplies the dimension's rows. Keep such attributes out of the Type 2 dimension, for example as a measure on the fact table.

### Partitioning and clustering to cut scan cost

Warehouse bills track how much data a query reads. BigQuery on-demand pricing and Amazon Athena ($5 per TB scanned) bill the bytes read directly; Snowflake (credits, its unit of compute billing, charged per second with a 60-second minimum per start) and Redshift Serverless (RPU-hours, where an RPU, Redshift Processing Unit, is its unit of compute capacity; 60-second minimum) bill compute time, which also grows with the data read. Three levers cut what a query reads:

- **Columnar storage** reads only the columns named. `SELECT *` on a 200-column table reads all 200.
- **Partitioning** splits a table into separate physical pieces by one column's value, usually a date. A query that filters on that column reads only the matching pieces; skipping the rest is **partition pruning**.
- **Clustering** (or sorting) stores rows with similar values of chosen columns in the same blocks. Each block keeps the minimum and maximum of each column, so a filter skips every block whose range cannot match. Redshift's docs give the example of five years of data sorted by date, where a one-month query skips up to 98% of blocks.

Partition on a low-cardinality column (one with few distinct values) that almost every query filters on, typically the event date. Cluster on the high-cardinality columns that queries also filter on, such as `customer_id`. Partitioning by a high-cardinality column produces many tiny partitions and files, which slows everything.

| Platform | Partitioning | Clustering / sorting |
|---|---|---|
| BigQuery | by a date/timestamp column, by ingestion time, or by integer range | up to 4 clustering columns, re-clustered automatically in the background; the bytes a query will read are known only after it runs |
| Snowflake | automatic micro-partitions of 50–500 MB uncompressed, each with min/max metadata | optional clustering key for very large tables; automatic clustering is a serverless feature billed in credits |
| Redshift | no partitioning inside a table; the distribution style (AUTO, EVEN, KEY, ALL) decides which node holds each row | sort key (`SORTKEY AUTO` recommended); 1 MB blocks with min/max metadata |
| Databricks (Delta Lake) | liquid clustering replaces partitioning for new tables | `CLUSTER BY (cols)`; keys can change without rewriting existing data; `CLUSTER BY AUTO` lets Databricks choose |
| Apache Iceberg | hidden partitioning: the table derives the partition from a column by a transform such as `day(event_time)`, and the layout can evolve | table sort order |

Two failures to check first when a scan costs too much:

- **The filter does not reach the partition column.** In Hive-style tables, which store each partition as a folder named by a column value such as `event_date=2026-10-01/`, filtering on `event_time` does not prune partitions on a separate `event_date` column. Iceberg's hidden partitioning removes this trap, because the engine knows how the partition was derived.
- **Small files.** Streaming writes create many small files, and every file costs overhead to open. Compaction merges them: `OPTIMIZE` on Delta Lake, automatic in Amazon S3 Tables (managed Iceberg).

### Medallion architecture

The **medallion architecture** is a layering convention for a lakehouse, in which data improves in quality as it moves through three layers:

- **Bronze** — raw data as it arrived from each source, plus load metadata (source, load time). Nothing is cleaned or dropped.
- **Silver** — data matched, merged, cleaned, and conformed into the business's entities: one customer table, deduplicated, with consistent types and keys.
- **Gold** — consumption-ready tables for one use, such as a star schema for a sales dashboard, denormalized and read-optimized.

Why keep bronze when silver is better? Because a bug in the cleaning logic is fixed by re-running it over bronze; without the raw copy the damaged data is gone. Each hop is also a place to put data-quality checks, and consumers only ever read gold. The costs are extra storage and pipeline latency for each layer, so a simple source may go straight to silver.

For an AI application the same layers map onto the ingestion pipeline (G1.8): bronze holds raw crawled or uploaded documents, silver holds extracted, deduplicated, PII-redacted text with metadata, and gold holds chunks with embeddings and the evaluation datasets.

### Choosing a platform for a client

Decide from five facts about the client, in this order:

1. **Where the data and the team already are.** A client on AWS pays egress (the cloud's fee for data moved out of it) and learns a second console for a warehouse elsewhere.
2. **Workload.** SQL reporting for many BI (business intelligence: dashboards and reports) users, ad-hoc exploration of lake files, or Spark and ML pipelines.
3. **Load shape.** Steady all-day load suits provisioned or reserved capacity; spiky or rare queries suit per-query or per-second billing.
4. **Governance.** Who may see which rows and columns, audit of access, lineage (which sources and jobs each table was derived from), and data residency (which country the data is stored in).
5. **Openness.** Keeping data in an open table format (Iceberg, Delta) lets several engines read it and keeps a way out.

An AWS-first shortlist:

| Client situation | Choice | Why |
|---|---|---|
| Data already in S3; occasional, ad-hoc queries | Amazon Athena over Iceberg or Parquet, AWS Glue Data Catalog (AWS's shared registry of table definitions) | serverless, pay per TB scanned; nothing runs when idle |
| Many BI users, steady SQL workload | Amazon Redshift, provisioned or Serverless | columnar warehouse with sort keys and distribution; reservations cut steady-state cost |
| Spark, data science, ML feature pipelines | Databricks on AWS with Delta Lake and Unity Catalog | one platform for SQL, notebooks, and ML |
| Several clouds, many teams needing isolated compute | Snowflake | a separate virtual warehouse per team, per-second billing |
| Governance across the lake | AWS Lake Formation over the Glue Data Catalog | grants at database, table, column, row, and cell level, enforced in Athena, Redshift Spectrum (Redshift querying files in S3), EMR (AWS's managed clusters for Spark and similar engines), and Glue; access logged to CloudTrail (AWS's audit log of account activity) |

Amazon S3 Tables store Iceberg tables in a dedicated bucket type with automatic compaction and snapshot cleanup, readable by Athena, Redshift, and Spark, so the lake layer can stay open while the engine choice changes.

**In an interview**

- *A customer moves region. How do your sales-by-region reports stay correct?* — Model the customer as a Type 2 slowly changing dimension: close the old row and insert a new one with a new surrogate key and a validity period. Each fact stores the surrogate key valid at the time of the sale, so old sales stay in the old region with no date logic in the report. I load facts by looking up the key by natural key and event time, which also handles late-arriving facts.
- *A daily BigQuery query costs too much. What do you change?* — First the query: select only needed columns and filter on the partition column so pruning applies. Then the table: partition by event date, cluster by the columns queries filter on, and check the partition filter is not wrapped in a function or applied to a derived column. If the same aggregate runs daily, materialize it once in a gold table.

Sources: [Kimball Group — Type 2 SCD](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/type-2/) · [dbt — Snapshots](https://docs.getdbt.com/docs/build/snapshots) · [BigQuery — Clustered tables](https://docs.cloud.google.com/bigquery/docs/clustered-tables) · [BigQuery — Controlling costs](https://docs.cloud.google.com/bigquery/docs/best-practices-costs) · [Databricks — OPTIMIZE](https://docs.databricks.com/aws/en/delta/optimize) · [Amazon Athena — Pricing](https://aws.amazon.com/athena/pricing/) · [Snowflake — Compute cost](https://docs.snowflake.com/en/user-guide/cost-understanding-compute) · [Snowflake — Micro-partitions and clustering](https://docs.snowflake.com/en/user-guide/tables-clustering-micropartitions) · [Redshift Serverless — Billing](https://docs.aws.amazon.com/redshift/latest/mgmt/serverless-billing.html) · [Redshift — Distribution styles](https://docs.aws.amazon.com/redshift/latest/dg/c_choosing_dist_sort.html) · [Redshift — Sort keys](https://docs.aws.amazon.com/redshift/latest/dg/t_Sorting_data.html) · [Databricks — Liquid clustering](https://docs.databricks.com/aws/en/delta/clustering) · [Apache Iceberg — Partitioning](https://iceberg.apache.org/docs/latest/partitioning/) · [Databricks — Medallion architecture](https://www.databricks.com/glossary/medallion-architecture) · [AWS Lake Formation](https://docs.aws.amazon.com/lake-formation/latest/dg/what-is-lake-formation.html) · [Amazon S3 Tables](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-tables.html)
