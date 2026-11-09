---
title: OLTP, OLAP, and warehousing
---

Recap (G1.4 L1): OLTP runs the business on row storage, OLAP analyzes it on column storage, and a star schema puts events in a fact table surrounded by dimension tables. Here you model a star schema, build it with dbt, and meet the platforms and table formats that host it.

**Model a star schema in four steps.** The Kimball method designs one fact table at a time:

1. **Choose the business process** — the activity to measure. For the capstone assistant: answering users.
2. **Declare the grain** — exactly what one fact row represents: *one row per assistant reply*. Decide it before any column; every dimension and measure must be true at that grain.
3. **Identify the dimensions** — the who, what, when that describe one reply: the date, the user, the model, the prompt version.
4. **Identify the facts** — the numbers measured at that grain: input and output tokens, cost, latency, and the user's thumbs up or down.

```sql
CREATE TABLE dim_date (
  date_key  int  PRIMARY KEY,            -- 20260901
  full_date date NOT NULL UNIQUE,
  month     text NOT NULL,               -- '2026-09'
  quarter   text NOT NULL,               -- '2026-Q3'
  year      int  NOT NULL
);

CREATE TABLE dim_user (
  user_key int  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id  text NOT NULL,                -- the id in the application database
  company  text NOT NULL,
  plan     text NOT NULL,
  country  text NOT NULL
);

CREATE TABLE dim_model (
  model_key int  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider  text NOT NULL,
  model_id  text NOT NULL UNIQUE
);

CREATE TABLE dim_prompt (
  prompt_key     int  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prompt_version text NOT NULL UNIQUE    -- 'rag-answer@3'
);

CREATE TABLE fact_assistant_replies (
  date_key      int NOT NULL REFERENCES dim_date (date_key),
  user_key      int NOT NULL REFERENCES dim_user (user_key),
  model_key     int NOT NULL REFERENCES dim_model (model_key),
  prompt_key    int NOT NULL REFERENCES dim_prompt (prompt_key),
  message_id    bigint NOT NULL,          -- degenerate dimension: an id with no table of its own
  input_tokens  int NOT NULL,
  output_tokens int NOT NULL,
  cost_usd      numeric(12, 6) NOT NULL,
  latency_ms    int NOT NULL,
  thumbs_up     smallint CHECK (thumbs_up IN (0, 1))   -- NULL when the user gave no rating
);
```

- **Surrogate key** — a key the warehouse generates, such as `user_key`, kept apart from the source system's id (`user_id`). It lets two source systems with clashing ids share one dimension, and lets one user have several dimension rows as their attributes change over time (G1.4 L3).
- **Additive measure** — a number that can be summed along every dimension: tokens and cost. **Non-additive** ones cannot: summing latencies means nothing, so reports take an average or a percentile (the p95 latency is the value 95% of replies stay under).

A report joins the fact to the dimensions it groups by:

```sql
SELECT m.model_id, d.month,
       count(*)                                                 AS replies,
       sum(f.cost_usd)                                          AS cost_usd,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY f.latency_ms) AS p95_latency_ms,
       avg(f.thumbs_up)                                         AS thumbs_up_rate
FROM fact_assistant_replies f
JOIN dim_model m ON m.model_key = f.model_key
JOIN dim_date  d ON d.date_key  = f.date_key
GROUP BY m.model_id, d.month;
```

`avg` skips `NULL`s, so `thumbs_up_rate` is the share of *rated* replies that got a thumbs up.

**ETL vs ELT.** Both move data from the application databases into the warehouse; they differ in where the transform runs.

- **ETL** (extract, transform, load) — a separate engine, such as a job on Apache Spark (a framework that processes large data in parallel across a cluster of machines), cleans and reshapes the data, then loads only the result.
- **ELT** (extract, load, transform) — the raw data is loaded first, then transformed by SQL inside the warehouse. The raw copy stays, so a fixed transform can be rerun over all history.

**dbt** is the common tool for the T of ELT. A dbt **model** is one `SELECT` statement in a `.sql` file; dbt wraps it in `CREATE TABLE AS` or `CREATE VIEW AS` and runs it in the warehouse. The `{{ … }}` and `{% … %}` tags are Jinja, a template language dbt fills in before the SQL runs. `{{ ref('model') }}` points at another model: dbt swaps in its real table name and learns the dependency, so it builds models in the right order. `{{ source('app', 'messages') }}` points at a raw table that dbt does not build. Below, the `staging` model renames and joins the raw application tables, and the `marts` model builds the fact table from it.

```sql
-- models/staging/stg_assistant_replies.sql
select
    msg.id               as message_id,
    msg.created_at       as replied_at,
    conv.user_id,
    llm.model_id,
    llm.prompt_version,
    llm.input_tokens,
    llm.output_tokens,
    llm.cost_usd,
    llm.duration_ms      as latency_ms,
    msg.feedback         as thumbs_up
from {{ source('app', 'messages') }} as msg
join {{ source('app', 'conversations') }} as conv on conv.id = msg.conversation_id
join {{ source('app', 'traces') }} as llm on llm.message_id = msg.id and llm.span_name = 'llm.generate'
where msg.role = 'assistant'
```

```sql
-- models/marts/fact_assistant_replies.sql
{{ config(materialized='incremental', unique_key='message_id') }}

select
    to_char(r.replied_at, 'YYYYMMDD')::int as date_key,
    u.user_key,
    m.model_key,
    p.prompt_key,
    r.message_id,
    r.input_tokens,
    r.output_tokens,
    r.cost_usd,
    r.latency_ms,
    r.thumbs_up
from {{ ref('stg_assistant_replies') }} as r
join {{ ref('dim_user') }}   as u on u.user_id = r.user_id
join {{ ref('dim_model') }}  as m on m.model_id = r.model_id
join {{ ref('dim_prompt') }} as p on p.prompt_version = r.prompt_version
{% if is_incremental() %}
where r.message_id > (select coalesce(max(message_id), 0) from {{ this }})
{% endif %}
```

- **Materialization** — how dbt stores a model: `view` (the default), `table`, `incremental`, `ephemeral` (inlined into the models that use it), or `materialized_view`.
- **Incremental** — the first run builds the whole table; later runs insert only new rows. `is_incremental()` is true on those later runs, and `{{ this }}` is the table already built, so the `where` keeps only messages newer than the last one loaded. `unique_key` makes a re-sent row update its old copy, not duplicate it.
- The SQL runs in the warehouse's own dialect: `to_char(…)::int` is PostgreSQL syntax, and other warehouses format dates with their own functions.

Data tests declare what must hold after each build:

```yaml
# models/marts/schema.yml
models:
  - name: fact_assistant_replies
    columns:
      - name: message_id
        data_tests:
          - unique
          - not_null
      - name: model_key
        data_tests:
          - relationships:
              arguments:
                to: ref('dim_model')
                field: model_key
      - name: thumbs_up
        data_tests:
          - accepted_values:
              arguments:
                values: [0, 1]
```

```bash
dbt run      # build the models in dependency order
dbt test     # run the data tests
dbt build    # both, in dependency order; a failed test skips the models downstream of it
```

**Warehouse platforms.** All four store data by column.

| Platform | How it runs | Choose it when |
|---|---|---|
| Snowflake | storage in a compressed columnar format split into micro-partitions; compute in **virtual warehouses** you size, start, and suspend independently | several teams need their own compute, sized and suspended separately, over one copy of the data |
| BigQuery (GCP, Google Cloud Platform) | serverless: no cluster to size; pay per TiB scanned (on-demand) or for reserved capacity | you are on GCP and want zero infrastructure |
| Amazon Redshift (AWS) | provisioned clusters, or Redshift Serverless that scales capacity itself and bills nothing while idle | you are on AWS; the capstone's natural choice |
| Databricks | a lakehouse: Spark and SQL compute over Delta Lake tables in your own object storage, governed by Unity Catalog (Databricks' registry of tables and who may access them) | data engineering and ML share the same data |

On BigQuery on-demand, the bill is bytes scanned, so selecting fewer columns and filtering on the partition column cut the bill directly.

**Open table formats.** A **table format** is a metadata layer over data files (usually Parquet) in object storage that makes a folder of files behave like a database table. It records which files form each version of the table, so several engines can read and write it with ACID transactions.

- **Delta Lake** — keeps an ordered transaction log in a `_delta_log` folder next to the data. Every write adds a log entry, which gives time travel: `SELECT * FROM replies VERSION AS OF 12` or `TIMESTAMP AS OF '2026-09-30'`, and `DESCRIBE HISTORY replies` lists the versions. It supports `MERGE` (insert or update each incoming row in one statement), `UPDATE`, and `DELETE`, and it is the storage layer Databricks builds on.
- **Apache Iceberg** — tracks each table snapshot through metadata and manifest files (lists of the data files that make up a snapshot). It adds **hidden partitioning** (queries filter on a column; Iceberg maps it to partitions), schema evolution (add, drop, or rename columns without rewriting data), partition evolution (change the partitioning without rewriting old data), and time travel. Query and processing engines such as Spark, Trino, Flink, and Hive read it. On AWS, **S3 Tables** stores tables in Iceberg format, queryable from Athena (AWS's serverless SQL over files in S3), Redshift, and Spark.

Choose by engine: Delta where Databricks is the center; Iceberg when several engines, or AWS-native services, must share the tables.

Sources: [Kimball — Four-step design process](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/four-4-step-design-process/) · [dbt — ref](https://docs.getdbt.com/reference/dbt-jinja-functions/ref) · [dbt — Materializations](https://docs.getdbt.com/docs/build/materializations) · [dbt — Incremental models](https://docs.getdbt.com/docs/build/incremental-models) · [dbt — Data tests](https://docs.getdbt.com/docs/build/data-tests) · [dbt — build](https://docs.getdbt.com/reference/commands/build) · [Snowflake — Key concepts](https://docs.snowflake.com/en/user-guide/intro-key-concepts) · [BigQuery pricing](https://cloud.google.com/bigquery/pricing) · [Amazon Redshift](https://docs.aws.amazon.com/redshift/latest/mgmt/welcome.html) · [Databricks — Lakehouse](https://docs.databricks.com/aws/en/lakehouse/) · [Delta Lake — Batch reads and writes](https://docs.delta.io/latest/delta-batch.html) · [Apache Iceberg docs](https://iceberg.apache.org/docs/latest/) · [Amazon S3 Tables](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-tables.html)
