---
title: Data layer of an AI app
---

Recap (G1.8 L1): an AI app keeps documents, chunks with embeddings, conversations, eval results, and traces, each with its own job. Here is the capstone's PostgreSQL schema, the feature store idea, and how to mark and lock down personal data.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 430" role="img" aria-labelledby="ai-data-layer-erd-title">
<title id="ai-data-layer-erd-title">Capstone schema: documents, chunks, message_citations, messages, conversations, traces, eval_runs, eval_results, linked by foreign keys</title>
<path class="key-link" d="M205,86 C190,86 190,62 175,62" />
<path class="key-link" d="M395,86 C380,86 380,62 365,62" />
<path class="key-link" d="M555,62 L585,62" />
<path class="key-link" d="M555,330 C572,330 568,62 585,62" />
<path class="key-link" d="M745,86 C758,86 758,282 745,282" />
<path class="key-link" d="M205,282 L175,282" />
<rect class="table-body" x="15" y="20" width="160" height="150" rx="8" />
<rect class="dimension-head" x="15" y="20" width="160" height="30" rx="8" />
<rect class="dimension-head" x="15" y="38" width="160" height="12" />
<rect class="table-outline" x="15" y="20" width="160" height="150" rx="8" />
<text class="table-name" x="27" y="40">documents</text>
<text class="key-column" x="27" y="66">id</text><text class="key-tag" x="163" y="66" text-anchor="end">PK</text>
<text x="27" y="90">source_uri</text>
<text x="27" y="114">version</text>
<text x="27" y="138">is_current</text>
<text x="27" y="162">title</text>
<rect class="table-body" x="205" y="20" width="160" height="174" rx="8" />
<rect class="dimension-head" x="205" y="20" width="160" height="30" rx="8" />
<rect class="dimension-head" x="205" y="38" width="160" height="12" />
<rect class="table-outline" x="205" y="20" width="160" height="174" rx="8" />
<text class="table-name" x="217" y="40">chunks</text>
<text class="key-column" x="217" y="66">id</text><text class="key-tag" x="353" y="66" text-anchor="end">PK</text>
<text class="key-column" x="217" y="90">document_id</text><text class="key-tag" x="353" y="90" text-anchor="end">FK</text>
<text x="217" y="114">chunk_index</text>
<text x="217" y="138">content</text>
<text x="217" y="162">embedding</text><text class="key-tag" x="353" y="162" text-anchor="end">vector</text>
<text x="217" y="186">content_tsv</text><text class="key-tag" x="353" y="186" text-anchor="end">tsvector</text>
<rect class="table-body" x="395" y="20" width="160" height="102" rx="8" />
<rect class="fact-head" x="395" y="20" width="160" height="30" rx="8" />
<rect class="fact-head" x="395" y="38" width="160" height="12" />
<rect class="table-outline" x="395" y="20" width="160" height="102" rx="8" />
<text class="table-name" x="407" y="40">message_citations</text>
<text class="key-column" x="407" y="66">message_id</text><text class="key-tag" x="543" y="66" text-anchor="end">FK</text>
<text class="key-column" x="407" y="90">chunk_id</text><text class="key-tag" x="543" y="90" text-anchor="end">FK</text>
<text x="407" y="114">rank</text>
<rect class="table-body" x="585" y="20" width="160" height="150" rx="8" />
<rect class="fact-head" x="585" y="20" width="160" height="30" rx="8" />
<rect class="fact-head" x="585" y="38" width="160" height="12" />
<rect class="table-outline" x="585" y="20" width="160" height="150" rx="8" />
<text class="table-name" x="597" y="40">messages</text>
<text class="key-column" x="597" y="66">id</text><text class="key-tag" x="733" y="66" text-anchor="end">PK</text>
<text class="key-column" x="597" y="90">conversation_id</text><text class="key-tag" x="733" y="90" text-anchor="end">FK</text>
<text x="597" y="114">role</text>
<text x="597" y="138">content</text><text class="key-tag" x="733" y="138" text-anchor="end">PII</text>
<text x="597" y="162">feedback</text>
<rect class="table-body" x="15" y="240" width="160" height="150" rx="8" />
<rect class="fact-head" x="15" y="240" width="160" height="30" rx="8" />
<rect class="fact-head" x="15" y="258" width="160" height="12" />
<rect class="table-outline" x="15" y="240" width="160" height="150" rx="8" />
<text class="table-name" x="27" y="260">eval_runs</text>
<text class="key-column" x="27" y="286">id</text><text class="key-tag" x="163" y="286" text-anchor="end">PK</text>
<text x="27" y="310">dataset_version</text>
<text x="27" y="334">model_id</text>
<text x="27" y="358">prompt_version</text>
<text x="27" y="382">summary</text>
<rect class="table-body" x="205" y="240" width="160" height="126" rx="8" />
<rect class="fact-head" x="205" y="240" width="160" height="30" rx="8" />
<rect class="fact-head" x="205" y="258" width="160" height="12" />
<rect class="table-outline" x="205" y="240" width="160" height="126" rx="8" />
<text class="table-name" x="217" y="260">eval_results</text>
<text class="key-column" x="217" y="286">run_id</text><text class="key-tag" x="353" y="286" text-anchor="end">FK</text>
<text x="217" y="310">case_id</text>
<text x="217" y="334">answer</text>
<text x="217" y="358">scores</text>
<rect class="table-body" x="395" y="240" width="160" height="174" rx="8" />
<rect class="fact-head" x="395" y="240" width="160" height="30" rx="8" />
<rect class="fact-head" x="395" y="258" width="160" height="12" />
<rect class="table-outline" x="395" y="240" width="160" height="174" rx="8" />
<text class="table-name" x="407" y="260">traces</text>
<text class="key-column" x="407" y="286">span_id</text><text class="key-tag" x="543" y="286" text-anchor="end">PK</text>
<text x="407" y="310">trace_id</text>
<text class="key-column" x="407" y="334">message_id</text><text class="key-tag" x="543" y="334" text-anchor="end">FK</text>
<text x="407" y="358">span_name</text>
<text x="407" y="382">started_at</text><text class="key-tag" x="543" y="382" text-anchor="end">partition</text>
<text x="407" y="406">cost_usd</text>
<rect class="table-body" x="585" y="240" width="160" height="102" rx="8" />
<rect class="fact-head" x="585" y="240" width="160" height="30" rx="8" />
<rect class="fact-head" x="585" y="258" width="160" height="12" />
<rect class="table-outline" x="585" y="240" width="160" height="102" rx="8" />
<text class="table-name" x="597" y="260">conversations</text>
<text class="key-column" x="597" y="286">id</text><text class="key-tag" x="733" y="286" text-anchor="end">PK</text>
<text x="597" y="310">user_id</text><text class="key-tag" x="733" y="310" text-anchor="end">PII</text>
<text x="597" y="334">created_at</text>
</svg>
</div>
<figcaption>The capstone schema, key columns only. The two head colors separate the document corpus (the set of documents the assistant answers from: documents, chunks) from what the app records as it runs. Each line joins a foreign key to the primary key it references.</figcaption>
</figure>

**The DDL.** Every table below answers one question the app asks, noted before it. It runs on PostgreSQL 13 or later with pgvector installed.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Which files are in the corpus, and which version of each is live?
CREATE TABLE documents (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_uri     text        NOT NULL,              -- s3://corpus/manuals/router-x200.pdf
  version        int         NOT NULL DEFAULT 1 CHECK (version > 0),
  is_current     boolean     NOT NULL DEFAULT true,
  title          text        NOT NULL,
  content_sha256 text        NOT NULL,              -- unchanged hash: skip re-embedding
  metadata       jsonb       NOT NULL DEFAULT '{}', -- {"product": "X200", "lang": "en"}
  ingested_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_uri, version)
);
CREATE UNIQUE INDEX documents_one_current ON documents (source_uri) WHERE is_current;
CREATE INDEX documents_metadata ON documents USING gin (metadata jsonb_path_ops);

-- What does retrieval search?
CREATE TABLE chunks (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id     bigint       NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  chunk_index     int          NOT NULL CHECK (chunk_index >= 0),   -- position in the document
  heading_path    text,                                            -- 'Install › Linux'
  content         text         NOT NULL,
  token_count     int          NOT NULL CHECK (token_count > 0),
  embedding       vector(1024) NOT NULL,
  embedding_model text         NOT NULL,                           -- 'amazon.titan-embed-text-v2:0'
  content_tsv     tsvector     GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX chunks_content_tsv ON chunks USING gin (content_tsv);

-- Who talked to the assistant, and what was said?
CREATE TABLE conversations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text        NOT NULL,          -- an opaque id from the identity provider, never an email
  title      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_user_recent ON conversations (user_id, created_at DESC);

CREATE TABLE messages (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role            text        NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content         text        NOT NULL,
  feedback        smallint    CHECK (feedback IN (0, 1)),          -- thumbs down / up
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (feedback IS NULL OR role = 'assistant')
);
CREATE INDEX messages_conversation_time ON messages (conversation_id, created_at);

-- Which chunks did each answer cite?
CREATE TABLE message_citations (
  message_id bigint NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  chunk_id   bigint NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  rank       int    NOT NULL CHECK (rank > 0),
  PRIMARY KEY (message_id, chunk_id)
);
CREATE INDEX message_citations_chunk ON message_citations (chunk_id);

-- Did a change to the model, prompt, or retrieval make answers better?
CREATE TABLE eval_runs (
  id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_version  text        NOT NULL,     -- 'qa-set@4'
  model_id         text        NOT NULL,
  prompt_version   text        NOT NULL,     -- 'rag-answer@3'
  retrieval_config jsonb       NOT NULL,     -- {"k": 5, "hybrid": true, "chunk_tokens": 500}
  git_commit       text        NOT NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  summary          jsonb                     -- {"recall_at_5": 0.82, "faithfulness": 0.91}
);
CREATE INDEX eval_runs_recent ON eval_runs (started_at DESC);

CREATE TABLE eval_results (
  run_id              bigint   NOT NULL REFERENCES eval_runs (id) ON DELETE CASCADE,
  case_id             text     NOT NULL,     -- the question's id in the eval dataset
  question            text     NOT NULL,
  expected_answer     text,
  answer              text     NOT NULL,
  retrieved_chunk_ids bigint[] NOT NULL,
  scores              jsonb    NOT NULL,     -- {"correct": 1, "faithfulness": 0.9}
  PRIMARY KEY (run_id, case_id)
);

-- What did each request do, how long did it take, and what did it cost?
CREATE TABLE traces (
  trace_id       uuid        NOT NULL,       -- one per user request
  span_id        uuid        NOT NULL,       -- one per step: 'retrieve', 'llm.generate', 'tool.sql'
  parent_span_id uuid,
  message_id     bigint      REFERENCES messages (id) ON DELETE SET NULL,
  span_name      text        NOT NULL,
  started_at     timestamptz NOT NULL,
  duration_ms    int         NOT NULL CHECK (duration_ms >= 0),
  model_id       text,
  prompt_version text,
  input_tokens   int,
  output_tokens  int,
  cost_usd       numeric(12, 6),
  attributes     jsonb       NOT NULL DEFAULT '{}',
  PRIMARY KEY (span_id, started_at)
) PARTITION BY RANGE (started_at);
CREATE TABLE traces_2026_10 PARTITION OF traces FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE INDEX traces_trace ON traces (trace_id);
CREATE INDEX traces_message ON traces (message_id);
```

**Why each index exists.** Each serves one query the app runs (G1.2):

| Index | Serves |
|---|---|
| `documents_one_current` (partial, unique) | at most one live version per source file; ingestion flips the old row's `is_current` and inserts the new one in one transaction |
| `documents_metadata` (GIN) | filters such as `metadata @> '{"product": "X200"}'` |
| `UNIQUE (document_id, chunk_index)` | re-ingesting a chunk twice fails; also the index for the `document_id` foreign key (leftmost column) |
| `chunks_embedding` (HNSW, cosine) | `ORDER BY embedding <=> $1 LIMIT k`, the vector half of hybrid search (G1.7) |
| `chunks_content_tsv` (GIN) | `content_tsv @@ query`, the keyword half |
| `conversations_user_recent` | a user's conversation list, newest first, with no sort |
| `messages_conversation_time` | loading one conversation's history in order |
| `message_citations_chunk` | "which answers cited this chunk", needed before re-chunking a document; also the index for the `chunk_id` foreign key |
| `traces_trace`, `traces_message` | one request's spans; the spans behind one reply |

**Design choices worth defending:**

- **One `embedding_model` per chunk.** Vectors from two models are not comparable, and the HNSW index holds one dimension. Recording the model lets a re-embedding job find every chunk still on the old one (G1.7 L3).
- **Citations as a join table**, not an array on `messages`. It gets foreign keys on both sides and an index for the reverse question. `eval_results.retrieved_chunk_ids` is an array on purpose: an eval result is an immutable record, read whole and never joined, and it must survive the chunks it names being deleted.
- **`ON DELETE` rules follow ownership.** A document owns its chunks, a conversation its messages, a message its citations, so those cascade. A trace outlives the message it measured, with `message_id` set to `NULL`, so cost reports keep their totals after a user's chat is deleted.
- **`traces` is partitioned by month** (G1.5). It grows fastest and is read mostly by recent time, and retention drops a month with `DROP TABLE` in place of a large `DELETE`. Its primary key includes `started_at` because every unique key on a partitioned table must include the partition key.
- **`jsonb` for the parts that vary**: document metadata, retrieval settings, eval scores. They change shape between experiments; columns that queries filter on every time stay columns.
- Spring AI's `PgVectorStore` can create its own `vector_store` table (`id`, `content`, `metadata`, `embedding`), with schema creation off by default (`spring.ai.vectorstore.pgvector.initialize-schema=false`). A custom `chunks` table is what lets retrieval join to document versions and record citations.

**The feature store idea.** A **feature** is an input value a classic ML model reads, such as "questions this user asked in the last 7 days" for a model that predicts which users will stop using the product. A **feature store** defines each feature once and serves it two ways:

- **Offline store** — the full history of feature values, used to build training sets. A **point-in-time join** gives each training row the feature values as they were at that row's timestamp, never later ones, so no future information leaks into training (G2.3).
- **Online store** — only the latest value per entity, for low-latency lookups at prediction time. **Materialization** copies the latest values from the offline store into it.

Because both paths use one definition, training and production see the same values, which prevents training-serving skew (G1.8 L1). In Feast, an open-source feature store:

```python
from datetime import timedelta
from feast import Entity, FeatureView, Field, FileSource
from feast.types import Float32, Int64

user = Entity(name="user", join_keys=["user_id"])

user_activity_source = FileSource(
    name="user_activity_source",
    path="data/user_activity.parquet",
    timestamp_field="event_timestamp",
)

user_activity = FeatureView(
    name="user_activity",
    entities=[user],
    ttl=timedelta(days=7),
    schema=[
        Field(name="questions_last_7d", dtype=Int64),
        Field(name="thumbs_up_rate_30d", dtype=Float32),
    ],
    online=True,
    source=user_activity_source,
)
```

```python
from feast import FeatureStore

store = FeatureStore(repo_path=".")
features = ["user_activity:questions_last_7d", "user_activity:thumbs_up_rate_30d"]

training_df = store.get_historical_features(entity_df=labelled_users, features=features).to_df()
online = store.get_online_features(features=features, entity_rows=[{"user_id": "u-7f3a"}]).to_dict()
```

`feast apply` registers the definitions, and `feast materialize-incremental <end time>` loads the online store. `labelled_users` is a DataFrame (a pandas in-memory table) of `user_id`, `event_timestamp`, and the label, the known outcome the model learns to predict (G2.1); `ttl` stops the join from reaching further back than 7 days before each timestamp. The capstone's LLM needs no feature store; it matters once the app adds a classic model, and it is a common interview question about ML data platforms.

**Personal data (PII).** **PII** (personally identifiable information) is any data that identifies a person, directly or combined with other data. In this schema: `conversations.user_id`, `messages.content` (users type names, emails, account numbers), and `traces.attributes` when it records prompt and completion text (the completion is the text the model generated).

Mark those columns in the catalog, PostgreSQL's built-in tables that describe the schema, so reviews and tooling can list them:

```sql
COMMENT ON COLUMN conversations.user_id IS 'PII: identifies the user';
COMMENT ON COLUMN messages.content IS 'PII: free text typed by the user or quoting it';
COMMENT ON COLUMN traces.attributes IS 'PII: may hold prompt and completion text';

SELECT c.relname AS table_name, a.attname AS column_name, d.description
FROM pg_description d
JOIN pg_class c     ON c.oid = d.objoid
JOIN pg_attribute a ON a.attrelid = d.objoid AND a.attnum = d.objsubid
WHERE d.description LIKE 'PII:%';
```

Then give each role only the columns it needs. The application role reads everything; an analyst role, for dashboards and error analysis, gets every column except the PII ones:

```sql
CREATE ROLE app_service LOGIN;
CREATE ROLE analyst NOLOGIN;            -- granted to each analyst's login role

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_service;

GRANT SELECT ON documents, chunks, message_citations, eval_runs, eval_results TO analyst;
GRANT SELECT (id, created_at) ON conversations TO analyst;
GRANT SELECT (id, conversation_id, role, feedback, created_at) ON messages TO analyst;
GRANT SELECT (trace_id, span_id, parent_span_id, message_id, span_name, started_at, duration_ms,
              model_id, prompt_version, input_tokens, output_tokens, cost_usd) ON traces TO analyst;
```

As `analyst`, `SELECT role, feedback FROM messages` works, while `SELECT content FROM messages` and `SELECT * FROM messages` fail with `permission denied for table messages`. Two rules keep this sound:

- Never grant table-level `SELECT` on those tables and then try to `REVOKE` one column: a table-level grant covers every column, and a column-level revoke does not narrow it.
- Grant only to roles, never to `PUBLIC`, the group every role belongs to, and re-check the grants whenever a column is added.

Deleting one user's data, and the copies of it in embeddings and logs, is G1.8 L3.

Sources: [pgvector README](https://github.com/pgvector/pgvector) · [PostgreSQL — Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) · [PostgreSQL — Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html) · [PostgreSQL — GRANT (column privileges)](https://www.postgresql.org/docs/current/sql-grant.html) · [PostgreSQL — COMMENT](https://www.postgresql.org/docs/current/sql-comment.html) · [Amazon Titan Text Embeddings](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html) · [Spring AI — PGvector](https://docs.spring.io/spring-ai/reference/api/vectordbs/pgvector.html) · [Feast — Quickstart](https://docs.feast.dev/getting-started/quickstart) · [Feast — Components](https://docs.feast.dev/getting-started/components/overview) · [Feast — Point-in-time joins](https://docs.feast.dev/getting-started/concepts/point-in-time-joins)
