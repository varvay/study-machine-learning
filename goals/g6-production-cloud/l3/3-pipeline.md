---
title: End-to-end pipeline
---

An ingestion pipeline runs forever: documents keep changing, services keep failing, and the corpus is re-embedded when the model changes. Four properties keep the index correct through all of it.

**Idempotent re-ingestion.** An operation is **idempotent** when running it twice leaves the same state as running it once. Queues deliver at least once: SQS (Amazon Simple Queue Service, AWS's managed message queue) may deliver a message twice, and a crashed worker's message comes back after its visibility timeout, the time a received message stays hidden from other workers before it reappears. So every step must tolerate a repeat. Four rules make the pipeline idempotent:

- **Deterministic IDs** — a document's ID is its source URI, and a chunk's ID is the document ID plus the chunk's position. Re-processing a document then overwrites the same rows instead of adding copies. A random UUID per run produces duplicate chunks, and retrieval returns the same passage twice.
- **Content hash** — store a hash of each document's text. When a message arrives for a document whose hash and embedding model match the stored ones, skip it before paying for parsing and embeddings.
- **Replace a document's chunks in one transaction** — delete the old chunks and insert the new ones inside one transaction. A search never sees half a document, and a crash mid-way leaves the old version intact.
- **Newest version wins** — S3 notifications (the messages S3 sends when an object changes) can arrive out of order. Each PUT and DELETE notification carries a `sequencer`; for the same object key (the file's path in the bucket), the larger value is the later event. Store it and apply an update only if it is newer.

```sql
CREATE TABLE source_document (
    document_id      text PRIMARY KEY,
    content_hash     text NOT NULL,
    source_sequence  text NOT NULL,
    embedding_model  text NOT NULL,
    indexed_at       timestamptz NOT NULL
);

CREATE TABLE chunk (
    chunk_id     text PRIMARY KEY,
    document_id  text NOT NULL REFERENCES source_document ON DELETE CASCADE,
    position     int NOT NULL,
    content      text NOT NULL,
    embedding    vector(1024) NOT NULL,
    acl_groups   text[] NOT NULL
);

BEGIN;
INSERT INTO source_document (document_id, content_hash, source_sequence, embedding_model, indexed_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (document_id) DO UPDATE
SET content_hash = EXCLUDED.content_hash,
    source_sequence = EXCLUDED.source_sequence,
    embedding_model = EXCLUDED.embedding_model,
    indexed_at = now()
WHERE source_document.source_sequence < EXCLUDED.source_sequence;
-- zero rows affected: a newer version is already indexed, so ROLLBACK and acknowledge the message
DELETE FROM chunk WHERE document_id = $1;
INSERT INTO chunk (chunk_id, document_id, position, content, embedding, acl_groups) VALUES ...;
COMMIT;
```

`INSERT … ON CONFLICT DO UPDATE` is atomic in PostgreSQL: under any concurrency it ends in exactly one insert or one update. `EXCLUDED` is the row the `INSERT` proposed, and the `WHERE` makes a stale event a no-op. S3 sequencers can differ in length, so store them left-padded with zeros to a fixed width, and the text comparison orders them correctly.

Managed and framework tools implement the same rules: a Bedrock Knowledge Base sync is incremental and processes only documents added, changed, or deleted since the last sync; LlamaIndex's `IngestionPipeline` with a docstore skips unchanged documents by hash (`UPSERTS`, `UPSERTS_AND_DELETE`); LangChain's indexing API keeps a `RecordManager` of hashes. Knowing the rules tells you what each tool guarantees and what it leaves to you.

**Incremental updates, deletions included.** Additions and edits arrive as events; deletions are the easy ones to lose:

- **Delete events** — an S3 `ObjectRemoved` notification deletes the document row, and the foreign key cascades to its chunks. A deleted document that is still retrievable is a data-protection incident when the deletion was a GDPR erasure request, a person's demand under the EU's data-protection law that their data be deleted (G6.7).
- **Reconciliation** — events can still be missed: a consumer bug, an expired message, a bucket without notifications. A nightly job compares the source inventory with `source_document`: rows with no source are deleted; sources with no row, or changed since their row was indexed, are enqueued. It is a full diff, so it also repairs anything the event path got wrong.
- **Embedding model changes** — vectors from two models cannot be compared, so a new model means re-embedding everything. Build the new index beside the old one (a new table or column), run the evaluation gate on it (G6.5), switch the read path, then drop the old one. Never mix the two models in one index; the `embedding_model` column makes a mix visible.

**Backpressure.** **Backpressure** is a signal from a slow stage that makes the stages before it slow down, so work waits in a bounded buffer instead of piling up without limit. Here the slow stages are the embedding API, bound by its TPM quota, and the database's write capacity.

- **The queue is the buffer** — workers pull messages at their own pace, so a burst of 50,000 uploaded documents waits in SQS, not in worker memory.
- **Bound the concurrency** — size the worker pool from the quota, not from the backlog. At a 300,000 TPM embedding quota and 3,000 tokens per document, about 100 documents a minute fit, so a 200,000-document re-index takes about 33 hours (example numbers). More workers only add throttling errors.
- **Slow down on throttling** — the AWS SDK's **adaptive** retry mode adds a client-side rate limiter that slows the client when the service throttles it. The docs recommend it for batch work against a single resource, and advise against it for clients that serve many tenants.
- **Protect the interactive path** — a bulk re-index and live questions share the same model quotas. Give bulk work its own lane: a separate quota or account, off-hours scheduling, or Bedrock's **Flex** service tier, which trades lower priority for a discount (supported models only).
- **With Kafka** — a consumer calls `pause()` on its partitions when downstream is slow, and `resume()` later. A paused Spring Kafka container (the object that runs a listener's polling loop) keeps polling, so the group does not rebalance (reassign partitions among its consumers, pausing them all meanwhile), but receives no records.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 300" role="img" aria-labelledby="pipeline-recovery-title">
<title id="pipeline-recovery-title">Ingestion with recovery: S3 events go to an SQS queue; a bounded worker pool embeds and writes each document in one transaction; failed messages move to a dead-letter queue; a nightly reconciler compares the S3 inventory with the index</title>
<rect class="fold-train" x="10" y="70" width="120" height="56" rx="8" /><text class="table-name" x="70" y="93" text-anchor="middle">S3 bucket</text><text class="key-tag" x="70" y="112" text-anchor="middle">PUT, DELETE events</text>
<path class="key-link" d="M130,98 H160 M154,94 L160,98 L154,102" />
<rect class="fold-train" x="160" y="70" width="120" height="56" rx="8" /><text class="table-name" x="220" y="93" text-anchor="middle">SQS queue</text><text class="key-tag" x="220" y="112" text-anchor="middle">at-least-once</text>
<path class="key-link" d="M280,98 H310 M304,94 L310,98 L304,102" />
<rect class="fold-test" x="310" y="62" width="140" height="72" rx="8" /><text class="table-name" x="380" y="86" text-anchor="middle">workers × N</text><text class="key-tag" x="380" y="104" text-anchor="middle">bounded concurrency</text><text class="key-tag" x="380" y="121" text-anchor="middle">hash check, chunk</text>
<path class="key-link" d="M450,80 H500 V46 H520 M514,42 L520,46 L514,50" />
<rect class="fold-train" x="520" y="20" width="160" height="56" rx="8" /><text class="table-name" x="600" y="43" text-anchor="middle">embedding API</text><text class="key-tag" x="600" y="62" text-anchor="middle">TPM quota, throttles</text>
<text class="note" x="690" y="52">429 →</text><text class="note" x="690" y="68">slow down</text>
<path class="key-link" d="M450,116 H500 V150 H520 M514,146 L520,150 L514,154" />
<rect class="fold-train" x="520" y="122" width="160" height="56" rx="8" /><text class="table-name" x="600" y="145" text-anchor="middle">PostgreSQL</text><text class="key-tag" x="600" y="164" text-anchor="middle">one transaction per doc</text>
<path class="key-link" d="M220,126 V200 M216,194 L220,200 L224,194" />
<rect class="fold-train" x="160" y="200" width="120" height="56" rx="8" /><text class="table-name" x="220" y="223" text-anchor="middle">dead-letter queue</text><text class="key-tag" x="220" y="242" text-anchor="middle">after maxReceiveCount</text>
<rect class="fold-train" x="520" y="222" width="160" height="56" rx="8" /><text class="table-name" x="600" y="245" text-anchor="middle">nightly reconciler</text><text class="key-tag" x="600" y="264" text-anchor="middle">inventory vs index</text>
<path class="key-link" d="M600,222 V178" />
<path class="key-link" d="M70,126 V266 H520" />
<text class="note" x="300" y="284">the source inventory: every object that should be indexed</text>
</svg>
</div>
<figcaption>The event path keeps the index fresh within minutes; the reconciler makes it correct even when events are lost. The dead-letter queue holds documents that failed repeatedly, for a person to inspect.</figcaption>
</figure>

**Failure recovery.** First sort each failure by whether trying again can help:

- **Transient** — throttling, a 5xx (an HTTP server error), a timeout. Retry with exponential backoff and jitter (a random part added to each wait, so clients do not retry in step), within the message's visibility timeout. A worker that takes longer than that timeout gets its message redelivered to another worker while it still runs; idempotency makes the double work harmless, and extending the timeout with `ChangeMessageVisibility` avoids it.
- **Permanent** — a corrupt PDF, an unsupported format, a file over the size limit. Retrying cannot help, and a message that fails forever blocks nothing but wastes every attempt. The queue's redrive policy moves it to a **dead-letter queue** after `maxReceiveCount` receives. Record the reason, alarm on DLQ (dead-letter queue) depth, and after the fix, redrive the messages back.
- **Acknowledge after commit** — delete the SQS message only once the transaction has committed. A crash before that means a redelivery, which the idempotent write absorbs; a crash after it loses nothing. At-least-once delivery plus idempotent writes gives the effect of exactly-once.
- **Batch orchestration** — AWS Step Functions retries a failed state from its `Retry` field (`IntervalSeconds` default 1, `MaxAttempts` default 3, `BackoffRate` default 2.0, optional `JitterStrategy: FULL`) and routes to a fallback state through `Catch`. A Distributed Map (the Map mode that runs each item as its own child workflow, for large datasets) over the corpus can tolerate a share of failed items and fails with `States.ExceedToleratedFailureThreshold` above it, so one bad file does not fail a 200,000-document run.
- **Know when it is broken** — alarm on the age of the oldest queued message and on DLQ depth, and state a freshness objective for the client, such as 95% of document changes searchable within 15 minutes.

**The on-premises variant.** The logic stays; the services change:

| Stage | AWS | On-premises |
|---|---|---|
| Change events | S3 event notifications | the document system's change feed, or a scheduled crawler comparing hashes |
| Queue and dead letters | SQS with a dead-letter queue | Kafka; Spring Kafka's `DeadLetterPublishingRecoverer` sends failed records to `<topic>-dlt` |
| Embeddings | Bedrock, bounded by a TPM quota | an embedding model on local GPUs, served by vLLM on `/v1/embeddings` |
| Vector store | Aurora PostgreSQL with pgvector | PostgreSQL with pgvector and a streaming replica |

Two things change in kind. The limit is no longer a quota but the team's own GPUs, so backpressure watches the model server's queue (vLLM exports `vllm:num_requests_waiting`), and a full re-index competes with live questions for the same cards unless it runs at night. And models and packages come from an internal mirror (an in-house copy of the package and model repositories), not the internet (G6.4).

Sources: [SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html) · [SQS dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html) · [S3 event message structure (`sequencer`)](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html) · [PostgreSQL `INSERT … ON CONFLICT`](https://www.postgresql.org/docs/current/sql-insert.html) · [Bedrock Knowledge Base sync](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-data-source-sync-ingest.html) · [LlamaIndex ingestion pipeline](https://developers.llamaindex.ai/python/framework/module_guides/loading/ingestion_pipeline/) · [LangChain — syncing data sources to vector stores](https://www.langchain.com/blog/syncing-data-sources-to-vector-stores) · [AWS SDK retry behavior (adaptive mode)](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html) · [Bedrock service tiers](https://docs.aws.amazon.com/bedrock/latest/userguide/service-tiers-inference.html) · [Spring Kafka pause and resume](https://docs.spring.io/spring-kafka/reference/kafka/pause-resume.html) · [Spring Kafka error handling and dead letters](https://docs.spring.io/spring-kafka/reference/kafka/annotation-error-handling.html) · [Step Functions error handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html) · [vLLM pooling models](https://docs.vllm.ai/en/latest/models/pooling_models/) · [vLLM metrics](https://docs.vllm.ai/en/latest/design/metrics.html)

**In an interview**

- *Users see the same passage twice in the answer's sources. What went wrong, and how do you fix it?* Most likely the ingestion is not idempotent: a redelivered message or a re-run inserted the document's chunks again under new random IDs. I would give chunks deterministic IDs from document ID and position, replace a document's chunks in one transaction, and skip documents whose content hash has not changed. Then a one-off job removes the duplicates, and a nightly reconciliation catches whatever else drifted.
- *The client uploads 50,000 documents at once and the chatbot starts timing out. Why, and what do you change?* The bulk ingestion and the live questions share the same model quota, and the ingestion took it. I would bound ingestion concurrency so it uses a fixed share of the quota, let the queue absorb the burst, and move bulk work to its own lane: another quota, off-peak hours, or a lower-priority service tier. I would also add an alarm on the age of the oldest message, so a slow backlog shows up before users notice.
