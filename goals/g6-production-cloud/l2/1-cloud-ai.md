---
title: One cloud's AI stack
---

Recap (G6.1 L1): Amazon Bedrock is AWS's managed model API, with Knowledge Bases for managed RAG; Amazon SageMaker AI is its managed ML platform, with endpoints for models you host. Here you use each one on AWS, then secure them with IAM.

## Before the first call

- **Region** — every Bedrock call goes to one Region's endpoint, such as `bedrock-runtime.us-east-1.amazonaws.com`. Pick the Region your data may live in (G6.4).
- **Credentials** — the AWS SDKs look for them in a fixed order, the **default credential chain**: environment variables, then the profile (a named set of keys) named by `AWS_PROFILE` in `~/.aws/credentials`, then the IAM role of the machine or container (a packaged, isolated process; G6.5). On a laptop use a profile; in production use a role, never a long-lived access key (a fixed key ID and secret that work until someone revokes them).
- **Model access** — serverless Bedrock models are enabled by default. The first call to a third-party model subscribes the account through AWS Marketplace (AWS's store for third-party software and models), so the caller needs `aws-marketplace:Subscribe`, `aws-marketplace:Unsubscribe`, and `aws-marketplace:ViewSubscriptions` that first time. Anthropic models also need a one-time use-case form per account, submitted from the model catalog in the console (AWS's web interface).

## Call a model: the Converse API

The **Converse API** is Bedrock's one request format for every chat model, so switching from Claude to Nova changes only the model ID. It has two operations: `Converse` returns the whole answer, and `ConverseStream` returns it in pieces as it is generated.

A `Converse` request carries:

- `modelId` — the model or inference profile to call (see below).
- `messages` — the conversation, each with a `role` (`user` or `assistant`) and a `content` list of blocks: `text`, `image`, `document`, `toolUse`, `toolResult`, or `cachePoint` (marks the end of a prompt prefix the provider may cache and bill cheaper on reuse; G6.8). Bedrock stores nothing, so the app resends the whole conversation each time.
- `system` — the system prompt, as a list of text blocks.
- `inferenceConfig` — the settings every model shares: `maxTokens` (the cap on the answer's length), `temperature` and `topP` (how freely the model picks less likely words), `stopSequences` (strings that end the answer when generated); all four in G3.2. Settings one model alone has, such as Claude's `top_k` (pick only among the k likeliest next tokens), go in `additionalModelRequestFields`.
- Optional: `toolConfig` for tools, `guardrailConfig` for a guardrail (G6.7).

The response holds `output.message` (the answer), `stopReason` (`end_turn`, `max_tokens`, `tool_use`…), `usage` (`inputTokens`, `outputTokens`, `totalTokens`, and cache counts), and `metrics.latencyMs`. The Python example uses boto3, the AWS SDK for Python.

```python
import boto3

bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")

response = bedrock.converse(
    modelId="us.anthropic.claude-haiku-4-5-20251001-v1:0",
    system=[{"text": "You answer questions about our product manuals."}],
    messages=[{"role": "user", "content": [{"text": "How do I reset the router?"}]}],
    inferenceConfig={"maxTokens": 512, "temperature": 0.2},
)

print(response["output"]["message"]["content"][0]["text"])
print(response["usage"])           # {'inputTokens': …, 'outputTokens': …, 'totalTokens': …}
print(response["metrics"]["latencyMs"])
```

The same call with the AWS SDK for Java v2:

```java
var bedrock = BedrockRuntimeClient.builder()
        .credentialsProvider(DefaultCredentialsProvider.create())
        .region(Region.US_EAST_1)
        .build();

var question = Message.builder()
        .role(ConversationRole.USER)
        .content(ContentBlock.fromText("How do I reset the router?"))
        .build();

ConverseResponse response = bedrock.converse(request -> request
        .modelId("us.anthropic.claude-haiku-4-5-20251001-v1:0")
        .messages(question)
        .inferenceConfig(config -> config.maxTokens(512).temperature(0.2F)));

String answer = response.output().message().content().getFirst().text();
```

In the capstone, Spring AI's Bedrock Converse starter makes these calls for you (G6.2); the raw API is what you debug against and what the interviewer asks about.

**Model IDs and inference profiles.** A **model ID** names one model, such as `amazon.titan-embed-text-v2:0`. An **inference profile** is an ID that lets Bedrock send the call to one of several Regions, to spread load and raise throughput. Its prefix says how far the call may travel:

| Kind | Example ID | Where the call may run |
|---|---|---|
| In-Region | `amazon.titan-embed-text-v2:0` (a plain model ID) | only the Region you call |
| Geo | `us.anthropic.claude-haiku-4-5-20251001-v1:0`, `eu.…` | Regions inside one geography; from us-east-1: us-east-1, us-east-2, us-west-2 |
| Global | `global.anthropic.claude-sonnet-5-5` | Regions worldwide, with no residency limit |

Recent Anthropic models on the `bedrock-runtime` endpoint accept only a profile: Claude Haiku 4.5 takes a geo or global one, and Claude Sonnet 5.5 a global one. So data residency (G6.4) decides the model as much as quality does: a client whose data must stay in the EU can use Haiku 4.5 through its `eu.` profile, but not Sonnet 5.5 through `bedrock-runtime`.

## RAG with Bedrock Knowledge Bases

A **knowledge base** is Bedrock's managed RAG pipeline: it reads documents from a data source, chunks and embeds them, writes the vectors to a vector store, and answers retrieval queries. You configure it; AWS runs it. Steps:

1. **Put the documents in S3.** An optional `<file>.metadata.json` beside each file adds metadata attributes to filter on, such as `{"metadataAttributes": {"product": "router-x"}}`.
2. **Create the knowledge base** in the console or with the `bedrock-agent` API (the API that creates and manages knowledge bases), choosing:
   - an **embeddings model**, such as Titan Text Embeddings V2;
   - a **vector store**: Amazon OpenSearch Serverless (AWS's managed search engine, which also searches vectors), OpenSearch managed clusters, Amazon S3 Vectors (vector storage and search inside S3), Amazon Aurora PostgreSQL (AWS's managed PostgreSQL) with pgvector, Neptune Analytics (a graph database, for GraphRAG: retrieval that also follows links between the entities in the documents), Pinecone, Redis Enterprise Cloud, or MongoDB Atlas (hosted databases with vector search; G1.6). For some of them the console's quick-create builds the index for you;
   - a **chunking strategy**: default (about 300 tokens, keeping sentences whole), fixed-size (a token count and an overlap percentage), hierarchical (small child chunks for matching, swapped for their larger parents in the result), semantic (cuts where the meaning shifts, judged by embeddings), or none.
3. **Sync** — an **ingestion job** reads the data source and fills the vector store. Run it again whenever the documents change:

```python
agent = boto3.client("bedrock-agent", region_name="us-east-1")
job = agent.start_ingestion_job(knowledgeBaseId="KB12345678", dataSourceId="DS12345678")
print(job["ingestionJob"]["status"])   # STARTING, then IN_PROGRESS, then COMPLETE or FAILED
```

4. **Query** it through the `bedrock-agent-runtime` client, in one of two ways.

`Retrieve` returns the chunks only, so your code builds the prompt and calls the model itself:

```python
runtime = boto3.client("bedrock-agent-runtime", region_name="us-east-1")

chunks = runtime.retrieve(
    knowledgeBaseId="KB12345678",
    retrievalQuery={"text": "How do I reset the router?"},
    retrievalConfiguration={"vectorSearchConfiguration": {"numberOfResults": 5}},
)
for result in chunks["retrievalResults"]:
    print(result["score"], result["location"]["s3Location"]["uri"], result["content"]["text"][:80])
```

`RetrieveAndGenerate` does retrieval and generation in one call and returns the answer with citations:

```python
answer = runtime.retrieve_and_generate(
    input={"text": "How do I reset the router?"},
    retrieveAndGenerateConfiguration={
        "type": "KNOWLEDGE_BASE",
        "knowledgeBaseConfiguration": {
            "knowledgeBaseId": "KB12345678",
            "modelArn": "arn:aws:bedrock:us-east-1:111122223333:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
        },
    },
)
print(answer["output"]["text"])
for citation in answer["citations"]:
    for reference in citation["retrievedReferences"]:
        print(reference["location"]["s3Location"]["uri"])
```

Pass the returned `sessionId` on the next call to continue the conversation. In `vectorSearchConfiguration`, `overrideSearchType: "HYBRID"` adds keyword search (G1.7), but only on an OpenSearch Serverless store with a filterable text field; other stores do semantic (vector) search only.

Which to choose? `RetrieveAndGenerate` is the fastest start. `Retrieve` keeps the prompt, the model call, memory, and tools in your code, which the capstone needs. With Spring AI, `spring-ai-starter-vector-store-bedrock-knowledgebase` exposes a knowledge base as a read-only `VectorStore`, so the `QuestionAnswerAdvisor` from G6.2 can run over a knowledge base instead of pgvector: set `spring.ai.vectorstore.bedrock-knowledge-base.knowledge-base-id`.

## Deploy an endpoint on SageMaker AI

A **real-time endpoint** is a model served behind an HTTPS API on instances that SageMaker AI runs for you. Use one when Bedrock does not offer the model, such as your LoRA fine-tuned model from G4 (LoRA trains small added matrices instead of all the weights; G4.2). Three resources build it:

1. A **model** — the inference container image (the packaged server program that loads the model and answers requests) plus the model artifacts (the trained weight files) in S3, and the IAM role SageMaker uses to read them. For LLMs, AWS publishes **Large Model Inference (LMI)** containers, prebuilt images that serve LLMs.
2. An **endpoint configuration** — the instance type and count for each **production variant**, one model on its own instances; an endpoint can split traffic across several variants.
3. The **endpoint** itself, created from the configuration.

```python
sagemaker = boto3.client("sagemaker", region_name="us-east-1")

sagemaker.create_model(
    ModelName="ticket-classifier-v3",
    ExecutionRoleArn="arn:aws:iam::111122223333:role/SageMakerExecutionRole",
    PrimaryContainer={"Image": "<LMI container image URI>", "ModelDataUrl": "s3://models/ticket-classifier-v3/model.tar.gz"},
)
sagemaker.create_endpoint_config(
    EndpointConfigName="ticket-classifier-v3-config",
    ProductionVariants=[{
        "VariantName": "primary",
        "ModelName": "ticket-classifier-v3",
        "InstanceType": "ml.g5.2xlarge",
        "InitialInstanceCount": 1,
    }],
)
sagemaker.create_endpoint(EndpointName="ticket-classifier", EndpointConfigName="ticket-classifier-v3-config")
```

Once the endpoint is `InService`, the app calls it through the separate `sagemaker-runtime` client:

```python
import json

runtime = boto3.client("sagemaker-runtime", region_name="us-east-1")
response = runtime.invoke_endpoint(
    EndpointName="ticket-classifier",
    ContentType="application/json",
    Body=json.dumps({"inputs": "My invoice is charged twice"}),
)
print(response["Body"].read().decode("utf-8"))
```

The body format belongs to the container, not to SageMaker. A real-time endpoint bills per instance-hour while it exists, busy or idle, so delete it when you are done testing. Two other modes suit other traffic:

- **Serverless Inference** — no instance to choose; it scales to zero between requests, at the cost of cold starts (a delay while capacity starts up for the first request after an idle spell). For spiky, infrequent traffic.
- **Asynchronous Inference** — requests queue, the payload and result go through S3 (up to 1 GB, up to an hour of processing), and it can scale to zero. For large batch-like jobs.

The instance type above is an example; size it with G6.4's VRAM (GPU memory) formula and check its price and your account quota first.

## IAM: least privilege for the app

**IAM** (Identity and Access Management) decides which identity may call which AWS action on which resource. The app runs as an **IAM role**, an identity with no password that a service such as ECS (AWS's container service) or EC2 (its virtual servers) assumes and receives short-lived credentials for. A **policy** attached to the role lists `Allow` statements, each with:

- `Action` — the API operations, such as `bedrock:InvokeModel`. `Converse` needs `bedrock:InvokeModel`, and `ConverseStream` needs `bedrock:InvokeModelWithResponseStream`.
- `Resource` — the resources the actions apply to, named by **ARN** (Amazon Resource Name), the unique ID every AWS resource has. A foundation model is `arn:aws:bedrock:<region>::foundation-model/<model-id>` (no account number, since AWS owns it); an inference profile is `arn:aws:bedrock:<region>:<account>:inference-profile/<profile-id>`; a knowledge base is `arn:aws:bedrock:<region>:<account>:knowledge-base/<id>`.
- `Condition` — optional extra checks on the request.

The policy for the capstone's app: Claude Haiku 4.5 through the US geo profile only, Titan embeddings, one knowledge base, and one SageMaker endpoint. `Version` is the policy language's version, and `Sid` a free-text label for each statement:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ChatThroughUsProfile",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": "arn:aws:bedrock:us-east-1:111122223333:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0"
    },
    {
      "Sid": "ChatModelInEachDestinationRegion",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": [
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"
      ],
      "Condition": {
        "StringLike": {
          "bedrock:InferenceProfileArn": "arn:aws:bedrock:us-east-1:111122223333:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0"
        }
      }
    },
    {
      "Sid": "Embeddings",
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0"
    },
    {
      "Sid": "KnowledgeBaseRetrieve",
      "Effect": "Allow",
      "Action": "bedrock:Retrieve",
      "Resource": "arn:aws:bedrock:us-east-1:111122223333:knowledge-base/KB12345678"
    },
    {
      "Sid": "ClassifierEndpoint",
      "Effect": "Allow",
      "Action": "sagemaker:InvokeEndpoint",
      "Resource": "arn:aws:sagemaker:us-east-1:111122223333:endpoint/ticket-classifier"
    }
  ]
}
```

Why two statements for one model? A call through an inference profile is checked twice: once against the profile, and once against the foundation model in whichever Region serves it. So the policy must allow the model in every destination Region of the profile. The `Condition` lets those model grants be used only through this profile, so the app cannot call the model directly in another Region. `bedrock:RetrieveAndGenerate` is left out on purpose: the capstone calls `Retrieve` and generates in its own code. An app that does use it needs `bedrock:RetrieveAndGenerate`, which AWS's example policy grants on `"Resource": "*"`.

## Azure and GCP equivalents

Both renamed their platforms recently: Azure AI Foundry is now **Microsoft Foundry**, and Vertex AI is now **Gemini Enterprise Agent Platform**; the old names still appear in docs and interviews.

| Need | AWS | Azure | GCP |
|---|---|---|---|
| Call a hosted model | Bedrock Converse API | Foundry Models, including Azure OpenAI | Gemini API on Agent Platform (formerly Vertex AI) |
| Managed RAG | Bedrock Knowledge Bases | Azure AI Search, connected to Foundry | RAG Engine |
| Vector store | OpenSearch Serverless, S3 Vectors, Aurora pgvector | Azure AI Search | Vector Search |
| Host your own model | SageMaker AI endpoints | Azure Machine Learning online endpoints | Agent Platform endpoints |
| Identity and access | IAM roles and policies | Microsoft Entra ID with Azure RBAC (role-based access control) | Cloud IAM roles and service accounts |
| Fine-tune a model | Bedrock model customization | Foundry fine-tuning | Agent Platform tuning |
| Run agents | Bedrock AgentCore | Foundry Agent Service | Agent Engine |
| Content and PII filters | Bedrock Guardrails | Azure AI Content Safety | Model Armor, Sensitive Data Protection |

Sources: [Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) · [Model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html) · [Claude Haiku 4.5 model card (profiles, destination Regions)](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html) · [Claude Sonnet 5.5 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html) · [Titan Text Embeddings V2 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-titan-text-embeddings-v2.html) · [AWS SDK for Java v2 Converse example](https://github.com/awsdocs/aws-doc-sdk-examples/blob/main/javav2/example_code/bedrock-runtime/src/main/java/com/example/bedrockruntime/models/anthropicClaude/Converse.java) · [Knowledge base vector stores](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-setup.html) · [Chunking strategies](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-chunking.html) · [StartIngestionJob](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent_StartIngestionJob.html) · [Retrieve](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_Retrieve.html) · [RetrieveAndGenerate](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-retrieve-generate.html) · [KnowledgeBaseVectorSearchConfiguration](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_KnowledgeBaseVectorSearchConfiguration.html) · [Spring AI Bedrock Knowledge Base vector store](https://docs.spring.io/spring-ai/reference/api/vectordbs/bedrock-knowledge-base.html) · [Deploy real-time endpoints](https://docs.aws.amazon.com/sagemaker/latest/dg/realtime-endpoints-deploy-models.html) · [Invoke endpoints](https://docs.aws.amazon.com/sagemaker/latest/dg/realtime-endpoints-test-endpoints.html) · [LMI containers](https://docs.aws.amazon.com/sagemaker/latest/dg/large-model-inference-container-docs.html) · [Serverless Inference](https://docs.aws.amazon.com/sagemaker/latest/dg/serverless-endpoints.html) · [Asynchronous Inference](https://docs.aws.amazon.com/sagemaker/latest/dg/async-inference.html) · [Inference profile IAM prerequisites](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html) · [Knowledge base query permissions](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-prereq-permissions-general.html) · [SageMaker API permissions](https://docs.aws.amazon.com/sagemaker/latest/dg/api-permissions-reference.html) · [What is Microsoft Foundry?](https://learn.microsoft.com/en-us/azure/foundry/what-is-foundry) · [Azure AI Search](https://learn.microsoft.com/en-us/azure/search/search-what-is-azure-search) · [Azure ML online endpoints](https://learn.microsoft.com/en-us/azure/machine-learning/concept-endpoints-online) · [Azure RBAC](https://learn.microsoft.com/en-us/azure/role-based-access-control/overview) · [Foundry fine-tuning](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/fine-tuning) · [Foundry Agent Service](https://learn.microsoft.com/en-us/azure/foundry/agents/overview) · [Gemini Enterprise Agent Platform (formerly Vertex AI)](https://cloud.google.com/products/gemini-enterprise-agent-platform) · [RAG Engine](https://cloud.google.com/vertex-ai/generative-ai/docs/rag-engine/rag-overview) · [Vector Search](https://cloud.google.com/vertex-ai/docs/vector-search/overview) · [Getting inferences](https://cloud.google.com/vertex-ai/docs/predictions/overview) · [Agent Platform IAM](https://cloud.google.com/vertex-ai/docs/general/access-control) · [Tuning](https://cloud.google.com/vertex-ai/generative-ai/docs/models/tune-models) · [Agent Engine](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/overview) · [Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html) · [Bedrock model customization](https://docs.aws.amazon.com/bedrock/latest/userguide/custom-models.html) · [Knowledge base metadata files](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-config.html) · [IngestionJob status values](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent_IngestionJob.html) · [SageMaker AI pricing (instance types)](https://aws.amazon.com/sagemaker/ai/pricing/) · [Azure AI Content Safety](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/overview) · [Model Armor](https://cloud.google.com/security/products/model-armor) · [Sensitive Data Protection](https://cloud.google.com/sensitive-data-protection/docs/sensitive-data-protection-overview)
