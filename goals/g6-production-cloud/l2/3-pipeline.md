---
title: End-to-end pipeline
---

Recap (G6.3 L1): a RAG pipeline has an offline half (ingestion, processing, embedding, storage) that fills the vector store, and an online half (serving, monitoring, feedback) that answers from it. Here you draw the capstone's pipeline with real components, trigger its offline half on a schedule or on events, orchestrate it (run its steps in order, with retries), and serve it over REST (plain HTTP requests to resource URLs, with JSON bodies).

## The capstone pipeline

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 330" role="img" aria-labelledby="pipeline-capstone-title">
<title id="pipeline-capstone-title">The capstone pipeline: offline, manuals in S3 are ingested, chunked, embedded with Titan, and stored in PostgreSQL; online, a Spring Boot RAG API searches PostgreSQL, calls Claude on Bedrock, and sends traces to monitoring, which feeds user feedback into the evaluation set</title>
<text class="note" x="14" y="24">offline: fills the vector store, nightly or on each change event</text>
<rect class="fold-train" x="14" y="40" width="132" height="60" rx="8" /><text class="table-name" x="80" y="65" text-anchor="middle">S3 bucket</text><text class="key-tag" x="80" y="85" text-anchor="middle">manuals/*.pdf</text>
<rect class="fold-train" x="162" y="40" width="132" height="60" rx="8" /><text class="table-name" x="228" y="65" text-anchor="middle">trigger</text><text class="key-tag" x="228" y="85" text-anchor="middle">cron or Kafka event</text>
<rect class="fold-train" x="310" y="40" width="132" height="60" rx="8" /><text class="table-name" x="376" y="65" text-anchor="middle">ingestion job</text><text class="key-tag" x="376" y="85" text-anchor="middle">Tika, splitter</text>
<rect class="fold-train" x="458" y="40" width="132" height="60" rx="8" /><text class="table-name" x="524" y="65" text-anchor="middle">embeddings</text><text class="key-tag" x="524" y="85" text-anchor="middle">Titan V2, Bedrock</text>
<rect class="fold-train" x="606" y="40" width="140" height="60" rx="8" /><text class="table-name" x="676" y="65" text-anchor="middle">PostgreSQL</text><text class="key-tag" x="676" y="85" text-anchor="middle">pgvector, memory</text>
<path class="key-link" d="M146,70 H161 M155,66 L161,70 L155,74 M294,70 H309 M303,66 L309,70 L303,74 M442,70 H457 M451,66 L457,70 L451,74 M590,70 H605 M599,66 L605,70 L599,74" />
<path class="key-link" d="M270,166 V130 H676 V101 M672,107 L676,101 L680,107" />
<text class="note" x="330" y="124">search chunks; load and save chat memory</text>
<text class="note" x="14" y="152">online: answers each question</text>
<rect class="fold-test" x="14" y="166" width="132" height="60" rx="8" /><text class="table-name" x="80" y="191" text-anchor="middle">user</text><text class="key-tag" x="80" y="211" text-anchor="middle">web app</text>
<rect class="fold-test" x="162" y="166" width="132" height="60" rx="8" /><text class="table-name" x="228" y="191" text-anchor="middle">RAG API</text><text class="key-tag" x="228" y="211" text-anchor="middle">Spring Boot</text>
<rect class="fold-test" x="310" y="166" width="132" height="60" rx="8" /><text class="table-name" x="376" y="191" text-anchor="middle">chat model</text><text class="key-tag" x="376" y="211" text-anchor="middle">Haiku 4.5, Bedrock</text>
<rect class="fold-test" x="458" y="166" width="132" height="60" rx="8" /><text class="table-name" x="524" y="191" text-anchor="middle">monitoring</text><text class="key-tag" x="524" y="211" text-anchor="middle">Langfuse, Grafana</text>
<rect class="fold-test" x="606" y="166" width="140" height="60" rx="8" /><text class="table-name" x="676" y="191" text-anchor="middle">feedback</text><text class="key-tag" x="676" y="211" text-anchor="middle">thumbs, eval set</text>
<path class="key-link" d="M146,196 H161 M155,192 L161,196 L155,200 M294,196 H309 M303,192 L309,196 L303,200 M590,196 H605 M599,192 L605,196 L599,200" />
<path class="key-link" d="M228,226 V256 H524 V227 M520,233 L524,227 L528,233" />
<text class="note" x="300" y="250">traces, token metrics</text>
<text class="note" x="14" y="300">feedback becomes new evaluation cases (G6.5) and fixes to documents, chunking, and prompts</text>
</svg>
</div>
<figcaption>The capstone on AWS. Green boxes run offline, when manuals change; blue boxes run on every question. One PostgreSQL database holds the chunks, their vectors, and the conversations.</figcaption>
</figure>

Each box is a section of this page: the trigger is batch or streaming, the ingestion job is G6.2's ETL pipeline, the orchestrator runs the offline half, the RAG API is served over REST, and monitoring and feedback are G6.6.

## Batch vs streaming ingestion

- **Batch ingestion** — a job that runs on a schedule and processes everything that changed since the last run. Simple to build, retry, and reason about; the knowledge is as old as the last run, such as up to a day.
- **Streaming ingestion** — each change is published as an **event**, a small message such as "manual `router-x.pdf` changed", and a consumer processes it within seconds. Fresh knowledge; more moving parts: a broker (the server that stores events and hands them to consumers) to run, events that can arrive twice or out of order, and a consumer that must keep up.

| | Batch | Streaming |
|---|---|---|
| Freshness | as old as the last run | seconds |
| Runs on | a scheduler: Spring `@Scheduled`, Amazon EventBridge Scheduler (AWS's managed scheduler), Airflow | a broker: Apache Kafka, Amazon MSK |
| Failure handling | re-run the job | retry the event; park poison messages (events that fail on every try) aside |
| Fits | manuals that change weekly | prices, tickets, anything users expect to see at once |

Most RAG apps start with batch and add streaming only for sources that must be fresh.

**Batch in Spring.** `@Scheduled` runs a method on a cron schedule, a time pattern such as "every day at 02:00". Spring's cron has six fields, seconds first, so `0 0 2 * * *` means 02:00:00 every day. `@EnableScheduling` turns the scheduler on.

```java
@Configuration
@EnableScheduling
class IngestionSchedule {

    private final ManualIngestion ingestion;

    IngestionSchedule(ManualIngestion ingestion) {
        this.ingestion = ingestion;
    }

    @Scheduled(cron = "0 0 2 * * *", zone = "UTC")
    void reindexNightly() throws IOException {
        ingestion.reindexAll();
    }
}
```

With several app instances behind a load balancer (which spreads incoming requests across them), every instance would run this job at 02:00. Run it in one place instead: a separate one-off task started by Amazon EventBridge Scheduler, or the orchestrator below.

**Streaming with Kafka.** **Apache Kafka** is a distributed log: producers append events to a **topic**, and consumers read them in order and track their position. Consumers that share a **group ID** split the topic's partitions (the ordered sub-logs a topic is cut into) between them, so each event reaches one member of the group. Amazon MSK runs Kafka as a managed service. With `spring-boot-starter-kafka` on the classpath and `spring.kafka.bootstrap-servers` (the Kafka servers to connect to) set, a listener is one annotation:

```java
@Component
class ManualChangeListener {

    private static final Pattern MANUAL_FILE_NAME = Pattern.compile("[\\w.-]+\\.pdf");

    private final ManualIngestion ingestion;
    private final ResourceLoader resources;

    ManualChangeListener(ManualIngestion ingestion, ResourceLoader resources) {
        this.ingestion = ingestion;
        this.resources = resources;
    }

    @KafkaListener(topics = "manual-changed", groupId = "manual-ingestion")
    void onManualChanged(String fileName) {
        if (!MANUAL_FILE_NAME.matcher(fileName).matches()) {
            throw new IllegalArgumentException("Not a manual file name: " + fileName);
        }
        ingestion.reindex(resources.getResource("file:manuals/" + fileName));
    }
}
```

The file-name check stops an event such as `../../etc/passwd` from reading outside the manuals folder. Because `reindex` deletes a file's old chunks before adding new ones (G6.2), processing the same event twice leaves one copy, which matters because Kafka consumers can see an event more than once after a failure.

## Orchestration

An **orchestrator** runs a workflow of dependent steps: it starts them in order, on a schedule or a trigger, retries failed steps, and keeps a history of every run. Two common choices:

**Apache Airflow** — an open-source orchestrator where a workflow is a **DAG** (directed acyclic graph) of **tasks** written in Python. Amazon MWAA (Managed Workflows for Apache Airflow) runs it as a managed service. Airflow 3's TaskFlow API turns plain functions into tasks, and passing one task's return value into another creates the dependency:

```python
from datetime import timedelta

import pendulum
import requests
from airflow.sdk import dag, task

ASSISTANT_URL = "http://docs-assistant:8080"


@dag(schedule="0 2 * * *", start_date=pendulum.datetime(2026, 10, 1, tz="UTC"), catchup=False)
def manual_ingestion():

    @task(retries=3, retry_delay=timedelta(minutes=5))
    def reindex_manuals() -> int:
        response = requests.post(f"{ASSISTANT_URL}/api/admin/reindex", timeout=1800)
        response.raise_for_status()
        return response.json()["manuals"]

    @task
    def check_retrieval(manual_count: int) -> None:
        response = requests.post(
            f"{ASSISTANT_URL}/api/chat",
            headers={"X-Customer-Id": "0"},
            json={"conversationId": "smoke-test", "question": "How do I reset the router to factory settings?"},
            timeout=60,
        )
        response.raise_for_status()
        if not response.json()["sources"]:
            raise ValueError(f"No sources cited after re-indexing {manual_count} manuals")

    check_retrieval(reindex_manuals())


manual_ingestion()
```

`catchup=False` stops Airflow from running every missed day between `start_date` and today when the DAG is first turned on; it is already the default, and writing it keeps the DAG safe on an installation whose default was changed. The smoke test (a quick check that the main path still works) fails the run, and alerts, when retrieval returns nothing after re-indexing.

**AWS Step Functions** — AWS's serverless orchestrator. A workflow is a **state machine** written in Amazon States Language (JSON): `StartAt` names the first state, each state has a `Type` (`Task` calls a service, `Map` runs its steps once per item of an array, `Choice` branches), and `Next` or `End` links them. This one re-indexes each changed file through a Lambda function (AWS Lambda runs a function on demand, with no server to manage), four at a time, and retries Lambda's transient errors with growing waits (10 s, 20 s, 40 s):

```json
{
  "StartAt": "ReindexEachManual",
  "States": {
    "ReindexEachManual": {
      "Type": "Map",
      "ItemsPath": "$.changedFiles",
      "MaxConcurrency": 4,
      "ItemProcessor": {
        "ProcessorConfig": { "Mode": "INLINE" },
        "StartAt": "Reindex",
        "States": {
          "Reindex": {
            "Type": "Task",
            "Resource": "arn:aws:states:::lambda:invoke",
            "Parameters": {
              "FunctionName": "arn:aws:lambda:us-east-1:111122223333:function:reindex-manual",
              "Payload.$": "$"
            },
            "Retry": [
              {
                "ErrorEquals": ["Lambda.ServiceException", "Lambda.SdkClientException", "Lambda.TooManyRequestsException"],
                "IntervalSeconds": 10,
                "MaxAttempts": 3,
                "BackoffRate": 2.0
              }
            ],
            "End": true
          }
        }
      },
      "End": true
    }
  }
}
```

Started with the input `{"changedFiles": ["router-x.pdf", "switch-y.pdf"]}`, the `Map` state sends each file name in the array that `ItemsPath` names to one run of `Reindex`; `"Mode": "INLINE"` runs those iterations inside this workflow run. `"Payload.$": "$"` means "pass this state's whole input as the Lambda payload": a key ending in `.$` takes its value from a path in the input.

Which one? Step Functions for an AWS-native, serverless workflow that calls AWS services and is billed per state transition; Airflow for Python-heavy data work, many non-AWS systems, or a team that already runs it.

## Serving through a REST API

The online half is the RAG API from G6.2. Its **contract**, what clients send and get back, is small. The `Authorization: Bearer` header carries the caller's access token:

```bash
curl -X POST https://assistant.example.com/api/chat \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer <token>' \
  -d '{"conversationId": "c1", "question": "How do I reset the router?"}'
```

```json
{
  "answer": "Hold the reset button for 10 seconds until the light blinks.",
  "sources": ["router-x.pdf"]
}
```

What makes it production-ready:

- **Stateless instances.** The conversation lives in PostgreSQL, not in the app's memory, so any instance can answer any request and a load balancer can add instances under load.
- **Health checks.** `spring-boot-starter-actuator` serves `GET /actuator/health`, which reports the database's state; the load balancer sends traffic only to instances that answer `UP`.
- **Timeouts.** A model call takes seconds and tool loops take several calls (G6.2), so give the load balancer and the client a timeout longer than the slowest normal answer, or stream the answer (G6.8).
- **Deployment.** The app ships as a container image (G6.5) to Amazon ECS or EKS (AWS's managed Kubernetes; G6.4), with the IAM role from G6.1 and secrets from AWS Secrets Manager (G6.7).

Sources: [Spring Framework — scheduling and cron format](https://docs.spring.io/spring-framework/reference/integration/scheduling.html) · [Amazon EventBridge Scheduler](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html) · [Spring Boot — Apache Kafka support](https://docs.spring.io/spring-boot/4.0/reference/messaging/kafka.html) · [Spring for Apache Kafka — @KafkaListener](https://docs.spring.io/spring-kafka/reference/kafka/receiving-messages/listener-annotation.html) · [Kafka design — consumer groups and at-least-once delivery](https://kafka.apache.org/43/design/design/) · [Amazon MSK](https://docs.aws.amazon.com/msk/latest/developerguide/what-is-msk.html) · [Airflow TaskFlow tutorial](https://airflow.apache.org/docs/apache-airflow/stable/tutorial/taskflow.html) · [Airflow — catchup](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dag-run.html) · [Amazon MWAA](https://docs.aws.amazon.com/mwaa/latest/userguide/what-is-mwaa.html) · [Step Functions — Lambda integration](https://docs.aws.amazon.com/step-functions/latest/dg/connect-lambda.html) · [Step Functions — inline Map state](https://docs.aws.amazon.com/step-functions/latest/dg/state-map-inline.html) · [Step Functions — handling errors](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html) · [Step Functions — Lambda service exceptions](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-best-practices.html) · [Step Functions — passing parameters (`.$` keys)](https://docs.aws.amazon.com/step-functions/latest/dg/connect-parameters.html) · [Step Functions pricing](https://aws.amazon.com/step-functions/pricing/) · [Spring Boot — health endpoint](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html)
