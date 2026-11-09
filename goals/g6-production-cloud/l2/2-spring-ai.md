---
title: Spring AI
---

Recap (G6.2 L1): Spring AI puts one portable API in front of model providers, vector stores, and tools; `ChatClient` sends each request through a chain of advisors to a `ChatModel`. Here you build the capstone's Spring Boot app with every piece the plan names.

**Versions.** Everything below is checked against Spring AI **2.0.1**, the newest general-availability release on Maven Central (the public repository of Java libraries) on 2026-10-01 (2.1.0-M1 is a milestone, a preview build), against its reference docs and, where the docs are silent, its source code. Spring AI 2.0.x runs on Spring Boot 4.0.x and 4.1.x; the app uses Spring Boot 4.0.8 and Java 25. Tutorials written for Spring AI 1.x differ in three places that break at runtime: every memory advisor call needs a conversation ID (there is no default one), `QuestionAnswerAdvisor` lives in the artifact (a published library package) `spring-ai-vector-store-advisor` (formerly `spring-ai-advisors-vector-store`), and the tool-calling loop runs as an advisor inside `ChatClient` instead of inside each `ChatModel`.

**The app.** A support assistant over product manuals, on AWS:

- `POST /api/chat` answers a question from the manuals, remembers the conversation, cites its sources, and can look up the customer's support tickets through a tool.
- `POST /api/triage` classifies a ticket into a Java record.
- `POST /api/admin/reindex` loads the manuals into PostgreSQL with pgvector.
- The app uses tools from another team's MCP server, and offers its own manual search as an MCP server.

Models: Claude Haiku 4.5 for chat and Amazon Titan Text Embeddings V2 for embeddings, both on Amazon Bedrock (G6.1).

## Dependencies

A **starter** is a dependency that brings a feature's library plus its auto-configuration, which creates the beans from `application.yml`, the app's settings file. The **BOM** (bill of materials) pins every Spring AI artifact to one version, so the starters below carry no version of their own. The build file below is Maven's `pom.xml`; Maven is a Java build tool that downloads the dependencies and builds the app.

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>4.0.8</version>
</parent>

<properties>
    <java.version>25</java.version>
    <spring-ai.version>2.0.1</spring-ai.version>
</properties>

<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.ai</groupId>
            <artifactId>spring-ai-bom</artifactId>
            <version>${spring-ai.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-webmvc</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-starter-model-bedrock-converse</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-starter-model-bedrock</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-starter-vector-store-pgvector</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-vector-store-advisor</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-starter-model-chat-memory-repository-jdbc</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-tika-document-reader</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-starter-mcp-client</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-starter-mcp-server-webmvc</artifactId>
    </dependency>
    <dependency>
        <groupId>org.postgresql</groupId>
        <artifactId>postgresql</artifactId>
        <scope>runtime</scope>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-test</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>
```

What each Spring AI artifact brings:

| Artifact | Gives you |
|---|---|
| `spring-ai-starter-model-bedrock-converse` | a `ChatModel` over Bedrock's Converse API, the `ChatClient.Builder`, and a default in-memory `ChatMemory` |
| `spring-ai-starter-model-bedrock` | Bedrock's embedding models (Titan, Cohere); the app turns on Titan |
| `spring-ai-starter-vector-store-pgvector` | `PgVectorStore`, the `VectorStore` over PostgreSQL, plus the JDBC starter (JDBC is Java's standard API for SQL databases) |
| `spring-ai-vector-store-advisor` | `QuestionAnswerAdvisor` and `VectorStoreChatMemoryAdvisor`; the pgvector starter does not include it |
| `spring-ai-starter-model-chat-memory-repository-jdbc` | `JdbcChatMemoryRepository`, which stores the conversation in PostgreSQL |
| `spring-ai-tika-document-reader` | `TikaDocumentReader`, which extracts text from PDF, DOCX, PPTX, and HTML |
| `spring-ai-starter-mcp-client` | MCP clients over STDIO (the server runs as a local process, talking through its standard input and output) and HTTP, with their tools as a `SyncMcpToolCallbackProvider` bean |
| `spring-ai-starter-mcp-server-webmvc` | an MCP server on Spring MVC (Spring's web framework for HTTP endpoints) that publishes `@McpTool` methods |

The same with Gradle, the other common Java build tool:

```groovy
plugins {
    id 'java'
    id 'org.springframework.boot' version '4.0.8'
    id 'io.spring.dependency-management' version '1.1.7'
}

dependencyManagement {
    imports {
        mavenBom 'org.springframework.ai:spring-ai-bom:2.0.1'
    }
}

dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-webmvc'
    implementation 'org.springframework.ai:spring-ai-starter-model-bedrock-converse'
    implementation 'org.springframework.ai:spring-ai-starter-model-bedrock'
    implementation 'org.springframework.ai:spring-ai-starter-vector-store-pgvector'
    implementation 'org.springframework.ai:spring-ai-vector-store-advisor'
    implementation 'org.springframework.ai:spring-ai-starter-model-chat-memory-repository-jdbc'
    implementation 'org.springframework.ai:spring-ai-tika-document-reader'
    implementation 'org.springframework.ai:spring-ai-starter-mcp-client'
    implementation 'org.springframework.ai:spring-ai-starter-mcp-server-webmvc'
    runtimeOnly 'org.postgresql:postgresql'
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
}
```

## Configuration

```yaml
spring:
  application:
    name: docs-assistant
  datasource:
    url: jdbc:postgresql://localhost:5432/assistant
    username: assistant
    password: ${DB_PASSWORD}
  ai:
    model:
      chat: bedrock-converse
      embedding: bedrock-titan
    bedrock:
      aws:
        region: us-east-1
      converse:
        chat:
          model: us.anthropic.claude-haiku-4-5-20251001-v1:0
          temperature: 0.2
          max-tokens: 1024
      titan:
        embedding:
          model: amazon.titan-embed-text-v2:0
    vectorstore:
      pgvector:
        initialize-schema: true
        index-type: HNSW
        distance-type: COSINE_DISTANCE
        dimensions: 1024
    chat:
      memory:
        repository:
          jdbc:
            initialize-schema: always
    mcp:
      client:
        streamable-http:
          connections:
            wiki:
              url: http://localhost:8081
      server:
        protocol: STREAMABLE
        name: docs-assistant
        version: 1.0.0
```

What the less obvious lines do:

- `spring.ai.model.chat` and `spring.ai.model.embedding` pick which provider fills each role when several starters are on the classpath (the set of libraries the app runs with).
- No AWS keys appear. With `access-key` and `secret-key` unset, the Bedrock starter falls back to the AWS SDK's default credential chain: environment variables, `AWS_PROFILE`, or the IAM role of the machine or container, which is what production uses (G6.1).
- The model ID starts with `us.`: it is a **geo inference profile**, which lets Bedrock route the call to any of us-east-1, us-east-2, or us-west-2. Claude Haiku 4.5 on the `bedrock-runtime` endpoint accepts only a profile, never the bare model ID (G6.1).
- `dimensions: 1024` must match the embedding model: Titan V2 returns 1,024 numbers per vector by default. Changing the embedding model later means dropping the `vector_store` table and embedding everything again.
- `initialize-schema: true` lets `PgVectorStore` create the `vector` (pgvector), `hstore` (key-value columns), and `uuid-ossp` (ID generation) extensions and the `vector_store` table with an HNSW index (G1.7). Schema creation is off by default; in production, create the table with a migration tool instead, one that applies versioned schema scripts in order, such as Flyway (G1.1 L3).
- `initialize-schema: always` creates the `SPRING_AI_CHAT_MEMORY` table. The default, `embedded`, only does so for in-process databases such as H2.

## ChatClient on a provider starter

A **`ChatClient`** is the fluent API the app calls; its builder, auto-configured from the starter, is already wired to the Bedrock `ChatModel`. The app needs two clients: one with memory, RAG, and tools for chat, and a bare one for triage, since a memory advisor rejects any call that has no conversation ID.

```java
@Configuration
class AssistantConfiguration {

    @Bean
    ChatClient assistantClient(ChatClient.Builder builder, ChatMemory chatMemory, VectorStore vectorStore,
            TicketTools ticketTools, ObjectProvider<SyncMcpToolCallbackProvider> mcpTools) {
        Object[] tools = Stream.concat(Stream.of(ticketTools), mcpTools.stream()).toArray();
        return builder
                .defaultSystem("""
                        You answer questions about our product manuals.
                        Use only the context and the tools you are given.
                        If the answer is not there, say that you don't know.
                        """)
                .defaultAdvisors(
                        MessageChatMemoryAdvisor.builder(chatMemory).build(),
                        QuestionAnswerAdvisor.builder(vectorStore)
                                .searchRequest(SearchRequest.builder().topK(5).similarityThreshold(0.5).build())
                                .build())
                .defaultTools(tools)
                .build();
    }

    @Bean
    ChatClient triageClient(ChatClient.Builder builder) {
        return builder.build();
    }
}
```

`ObjectProvider` makes the MCP tools optional: with `spring.ai.mcp.client.enabled=false`, as in a test run without MCP servers, the provider bean is absent and the client starts with the local tools only.

Why can one builder make two different clients? The auto-configured `ChatClient.Builder` is a prototype bean: each injection point gets a fresh builder, so settings on one never leak into the other.

The `default…` methods set what every call gets; the same methods without `default` (`system`, `advisors`, `tools`, `options`) add to or override them for one call. The simplest call is `chatClient.prompt().user("…").call().content()`; `call()` only chooses the blocking mode, and the model is called when `content()`, `chatResponse()`, or `entity()` runs.

## Chat memory

A model keeps nothing between calls, so the app stores the conversation and resends it. Three types split the job:

- **`ChatMemoryRepository`** stores messages. With the JDBC starter present, the auto-configured one is `JdbcChatMemoryRepository`, writing to the `SPRING_AI_CHAT_MEMORY` table.
- **`ChatMemory`** decides which messages to keep. The auto-configured one is a `MessageWindowChatMemory`: the last 20 messages, always keeping system messages, and cutting only at the start of a user turn.
- **`MessageChatMemoryAdvisor`** loads the conversation's earlier messages into the prompt and saves the new user message on the way in, then saves the answer on the way out.

Every call must say which conversation it belongs to, through the advisor parameter `ChatMemory.CONVERSATION_ID`; a call without it throws `IllegalArgumentException`. Build the ID on the server from the authenticated user, never from a value the client chooses alone, or one user can read another's conversation:

```java
String conversationId = customerId + ":" + request.conversationId();

chatClient.prompt()
        .user(request.question())
        .advisors(advisor -> advisor.param(ChatMemory.CONVERSATION_ID, conversationId))
        .call()
        .content();
```

The JDBC repository drops tool-call messages when it saves. That is harmless in the default setup: the memory advisor stores only the user's question and the final answer, never the tool calls in between. To keep the tool transcript, the reference docs place the memory advisor inside the tool loop and use a repository that stores tool messages (in-memory, Redis, an in-memory key-value store, or Neo4j, a graph database, in 2.0; G1.6).

## RAG with QuestionAnswerAdvisor over PgVectorStore

**`QuestionAnswerAdvisor`** implements basic RAG (G1.7): before the call it searches the `VectorStore` with the user's question, then rewrites the user message into a template holding the question and the retrieved chunks. `PgVectorStore` runs that search in PostgreSQL:

```sql
SELECT id, content, metadata, embedding <=> ? AS distance
FROM vector_store
ORDER BY distance
LIMIT 5;
```

That is the shape of the query, not its exact text (unsourced); `<=>` is pgvector's cosine distance operator. The `SearchRequest` controls it:

- `topK(5)` — return at most 5 chunks. Each chunk becomes input tokens, so top-k drives the cost of every call (G6.8).
- `similarityThreshold(0.5)` — drop chunks whose similarity is below 0.5, on a scale of 0 to 1. Too high, and relevant chunks vanish; too low, and noise enters the prompt. Tune it on your evaluation set (G6.5).
- `filterExpression("product == 'router-x'")` — keep only chunks whose metadata matches, using Spring AI's portable filter language. PgVectorStore turns it into a PostgreSQL JSON path condition. To set a filter for one call, pass it as the advisor parameter `QuestionAnswerAdvisor.FILTER_EXPRESSION`.

**Citations.** The advisor puts the chunks it used into the response metadata under `QuestionAnswerAdvisor.RETRIEVED_DOCUMENTS` (the key `qa_retrieved_documents`). Each chunk keeps the metadata of the file it came from, so the answer can name its sources:

```java
ChatResponse response = chatClient.prompt()
        .user(request.question())
        .advisors(advisor -> advisor.param(ChatMemory.CONVERSATION_ID, conversationId))
        .call()
        .chatResponse();

List<Document> retrieved = response.getMetadata().get(QuestionAnswerAdvisor.RETRIEVED_DOCUMENTS);
List<String> sources = retrieved.stream()
        .map(document -> (String) document.getMetadata().get("source"))
        .distinct()
        .toList();
```

**Advisor order.** Advisors run in the order of their `getOrder()` value, lowest first, and form a stack: the first to see the request is the last to see the response. In 2.0.1 the defaults are:

| Advisor | Default order | Runs |
|---|---|---|
| `MessageChatMemoryAdvisor` | `Ordered.HIGHEST_PRECEDENCE + 200` | once per call, outside the tool loop |
| `ToolCallingAdvisor` (added by `ChatClient`) | `Ordered.HIGHEST_PRECEDENCE + 300` | owns the tool loop |
| `QuestionAnswerAdvisor` | `0` | inside the tool loop, so on every round trip to the model |

So the history is loaded before retrieval, the answer is saved only after the whole tool loop, and retrieval repeats on every round when the model calls a tool. The walkthrough below steps one call through this chain.

## The ETL pipeline

Spring AI's **ETL pipeline** loads documents into a vector store in three steps, each an interface:

- **`DocumentReader`** — extracts `Document`s from a source (a `Supplier<List<Document>>`). `TikaDocumentReader` reads PDF, DOCX, PPTX, and HTML, and records the file name under the metadata key `source`.
- **`DocumentTransformer`** — changes a list of documents (a `Function`). `TokenTextSplitter` cuts each document into chunks of about 800 tokens by default, ending a chunk at a sentence mark (`.`, `?`, `!`, newline) when it can. Each chunk keeps its parent's metadata and gains `parent_document_id` and `chunk_index`.
- **`DocumentWriter`** — stores the documents (a `Consumer`). Every `VectorStore` is one: `add` embeds each chunk through the `EmbeddingModel` and inserts it.

```java
@Service
class ManualIngestion {

    private final VectorStore vectorStore;
    private final ResourcePatternResolver resources;
    private final String manualsPattern;
    private final TokenTextSplitter splitter = TokenTextSplitter.builder().withChunkSize(500).build();

    ManualIngestion(VectorStore vectorStore, ResourcePatternResolver resources,
            @Value("${assistant.manuals:file:manuals/*.pdf}") String manualsPattern) {
        this.vectorStore = vectorStore;
        this.resources = resources;
        this.manualsPattern = manualsPattern;
    }

    int reindexAll() throws IOException {
        Resource[] manuals = resources.getResources(manualsPattern);
        for (Resource manual : manuals) {
            reindex(manual);
        }
        return manuals.length;
    }

    void reindex(Resource manual) {
        List<Document> pages = new TikaDocumentReader(manual).read();
        List<Document> chunks = splitter.apply(pages);
        vectorStore.delete(new FilterExpressionBuilder().eq("source", manual.getFilename()).build());
        vectorStore.add(chunks);
    }
}
```

Why delete first? `add` always inserts, so re-running the job would store every chunk twice and retrieval would return duplicates. Deleting the file's old chunks by their `source` metadata keeps one copy. The filter is built with `FilterExpressionBuilder` so a quote in a file name cannot break the expression. Why read files from a configured pattern? The docs warn against building readers from user-supplied URLs, which would let a caller make the server fetch any URL or file. G6.3 schedules this job and moves the files to S3.

Titan embeds one text per request (the Spring AI docs note it has no batch embedding), so a large corpus takes one Bedrock call per chunk.

## Tools with @Tool

A **tool** is a method the model can ask the app to run. `@Tool` turns a method into one: Spring AI sends the method's name, `description`, and a JSON schema of its parameters (a JSON description of each parameter's name, type, and whether it is required) to the model, runs the method when the model asks, and sends the result back. The description is the only guidance the model gets on when to call it, so write it for the model.

```java
@Component
class TicketTools {

    private final JdbcClient jdbc;

    TicketTools(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Tool(description = "Look up one of the current customer's support tickets by its numeric id. Returns its status and subject.")
    TicketSummary findTicket(@ToolParam(description = "The ticket id, for example 1042") long ticketId,
            ToolContext toolContext) {
        long customerId = (Long) toolContext.getContext().get("customerId");
        return jdbc.sql("SELECT id, status, subject FROM tickets WHERE id = ? AND customer_id = ?")
                .params(ticketId, customerId)
                .query(TicketSummary.class)
                .optional()
                .orElseThrow(() -> new IllegalArgumentException("No ticket " + ticketId + " for this customer"));
    }
}

record TicketSummary(long id, String status, String subject) {}
```

The chat call passes the customer to the tool:

```java
chatClient.prompt()
        .user(request.question())
        .advisors(advisor -> advisor.param(ChatMemory.CONVERSATION_ID, conversationId))
        .toolContext(Map.of("customerId", customerId))
        .call()
        .chatResponse();
```

The details that matter:

- **`ToolContext`** carries data to the tool that the model never sees. The customer ID comes from the authenticated request, not from the model's arguments, so a prompt injection cannot make the tool read another customer's ticket (G6.7).
- **Return values** are serialized to JSON with Jackson, Java's common JSON library. `Optional`, `CompletableFuture`, and reactive types (Reactor's `Mono` and `Flux`, which deliver results asynchronously; G6.2 L3) are not supported as parameters or return types.
- **Errors**: a `RuntimeException` thrown by the tool goes back to the model as a message, so it can tell the user the ticket was not found. Set `spring.ai.tools.throw-exception-on-error=true` to throw to the caller instead.
- **Limits**: to stop runaway loops, a single turn allows at most 40 calls per tool and 150 in total by default, set with `spring.ai.tools.limits.max-calls-per-tool-default` and `spring.ai.tools.limits.max-total-tool-calls`.
- `@ToolParam(required = false)` makes a parameter optional; all are required by default.

## Structured output into a record

**Structured output** maps the model's answer into a Java type. `entity(TicketTriage.class)` derives a JSON schema from the record, adds format instructions to the prompt, and parses the reply into the record.

```java
enum Category { BILLING, BUG, HOW_TO, ACCOUNT }

enum Priority { LOW, MEDIUM, HIGH }

record TicketTriage(Category category, Priority priority, String oneLineSummary) {}

TicketTriage triage(String ticketText) {
    return triageClient.prompt()
            .system("Classify this support ticket for the support team.")
            .user(ticketText)
            .call()
            .entity(TicketTriage.class, spec -> spec.useProviderStructuredOutput().validateSchema());
}
```

The two switches:

- `useProviderStructuredOutput()` sends the schema to the provider as an API field, so the provider itself only emits valid JSON. It works when the model's options implement `StructuredOutputChatOptions`, as `BedrockChatOptions` does in 2.0.1; otherwise it is silently ignored and the prompt instructions are used. It is off by default because schema support varies by model.
- `validateSchema()` checks the reply against the schema and retries with the error message when it fails.

For a list, use `entity(new ParameterizedTypeReference<List<TicketTriage>>() {})`, or wrap the list in a record, since some providers reject a top-level array schema.

## MCP client and server

**MCP** (G5.4) lets one app use tools that another program offers. The two starters cover both roles.

**Client.** The `wiki` connection in `application.yml` points at another team's MCP server over Streamable HTTP, MCP's HTTP transport, which can stream a reply back (its endpoint defaults to `/mcp`). At startup the client connects, lists that server's tools, and exposes them as the `SyncMcpToolCallbackProvider` bean, which `defaultTools(tools)` in `AssistantConfiguration` hands to the model beside the local tools. A local server program runs over STDIO instead; here `npx` downloads and starts it as a Node.js package:

```yaml
spring:
  ai:
    mcp:
      client:
        stdio:
          connections:
            everything:
              command: npx
              args: -y,@modelcontextprotocol/server-everything
```

Clients initialize when they are created, at startup (`spring.ai.mcp.client.initialized=true` by default), so start the MCP servers before the app. Tools from an outside server are code you do not control: an `McpToolFilter` bean limits which of them the model sees.

**Server.** The app offers its manual search to other AI apps, such as an agent or Claude Desktop:

```java
@Component
class ManualSearchTools {

    private final VectorStore vectorStore;

    ManualSearchTools(VectorStore vectorStore) {
        this.vectorStore = vectorStore;
    }

    @McpTool(name = "search_manuals",
            description = "Search the product manuals. Returns the most relevant passages with the file each came from.",
            annotations = @McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false))
    ManualSearchResult searchManuals(@McpToolParam(description = "What to search for", required = true) String query) {
        List<ManualPassage> passages = vectorStore.similaritySearch(SearchRequest.builder().query(query).topK(5).build())
                .stream()
                .map(document -> new ManualPassage((String) document.getMetadata().get("source"), document.getText()))
                .toList();
        return new ManualSearchResult(passages);
    }
}

record ManualPassage(String source, String text) {}

record ManualSearchResult(List<ManualPassage> passages) {}
```

With `spring.ai.mcp.server.protocol=STREAMABLE`, the server answers at `POST /mcp`. The auto-configuration scans for `@McpTool` beans and generates each tool's schema. The annotations `readOnlyHint` and `destructiveHint` tell clients that the tool only reads and changes nothing. `@Tool` and `@McpTool` are separate: the first offers a method to this app's own model, the second to outside MCP clients. The server also publishes any `ToolCallback` or `ToolCallbackProvider` bean (the objects Spring AI wraps each tool in), so declare those only for tools you mean to expose.

The MCP endpoint has no authentication by default: anyone who can reach it can list and call every tool. Put Spring Security (Spring's authentication and authorization framework) or a gateway (a proxy that checks each request before it reaches the app) in front of it before it leaves localhost (G6.7).

## The controller

```java
@RestController
@RequestMapping("/api")
class AssistantController {

    record ChatRequest(String conversationId, String question) {}

    record ChatAnswer(String answer, List<String> sources) {}

    private final ChatClient assistantClient;
    private final ChatClient triageClient;
    private final ManualIngestion ingestion;

    AssistantController(@Qualifier("assistantClient") ChatClient assistantClient,
            @Qualifier("triageClient") ChatClient triageClient, ManualIngestion ingestion) {
        this.assistantClient = assistantClient;
        this.triageClient = triageClient;
        this.ingestion = ingestion;
    }

    @PostMapping("/chat")
    ChatAnswer chat(@RequestHeader("X-Customer-Id") long customerId, @RequestBody ChatRequest request) {
        ChatResponse response = assistantClient.prompt()
                .user(request.question())
                .advisors(advisor -> advisor.param(ChatMemory.CONVERSATION_ID, customerId + ":" + request.conversationId()))
                .toolContext(Map.of("customerId", customerId))
                .call()
                .chatResponse();
        List<Document> retrieved = response.getMetadata().get(QuestionAnswerAdvisor.RETRIEVED_DOCUMENTS);
        List<String> sources = retrieved.stream()
                .map(document -> (String) document.getMetadata().get("source"))
                .distinct()
                .toList();
        return new ChatAnswer(response.getResult().getOutput().getText(), sources);
    }

    @PostMapping("/triage")
    TicketTriage triage(@RequestBody String ticketText) {
        return triageClient.prompt()
                .system("Classify this support ticket for the support team.")
                .user(ticketText)
                .call()
                .entity(TicketTriage.class, spec -> spec.useProviderStructuredOutput().validateSchema());
    }

    @PostMapping("/admin/reindex")
    Map<String, Integer> reindex() throws IOException {
        return Map.of("manuals", ingestion.reindexAll());
    }
}
```

The `X-Customer-Id` header stands in for the authenticated user to keep the example short; a real app reads the user from Spring Security, and restricts `/admin/**` to operators (G6.7).

## Run it

Start PostgreSQL with pgvector in a Docker container (G6.5), run the app through `mvnw`, the Maven wrapper script, then call it:

```bash
docker run -d --name assistant-db -p 5432:5432 \
  -e POSTGRES_USER=assistant -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=assistant \
  pgvector/pgvector:pg18-trixie

export DB_PASSWORD=secret AWS_PROFILE=dev
./mvnw spring-boot:run

curl -X POST localhost:8080/api/admin/reindex
curl -X POST localhost:8080/api/chat -H 'Content-Type: application/json' -H 'X-Customer-Id: 42' \
  -d '{"conversationId": "c1", "question": "How do I reset the router to factory settings?"}'
curl -X POST localhost:8080/api/chat -H 'Content-Type: application/json' -H 'X-Customer-Id: 42' \
  -d '{"conversationId": "c1", "question": "And what is the status of my ticket 1042?"}'
```

The second question tests two pieces at once: "And" only makes sense with the first turn in memory, and the ticket status comes from the tool. The `tickets` table is the one from G1.2 L2. The IAM role or profile needs `bedrock:InvokeModel` on the Haiku inference profile and on the foundation model in each destination Region, plus the Titan model (G6.1).

Sources: [Spring AI — Getting Started (2.0.x on Boot 4.0/4.1, BOM)](https://docs.spring.io/spring-ai/reference/getting-started.html) · [spring-ai-bom versions on Maven Central](https://repo.maven.apache.org/maven2/org/springframework/ai/spring-ai-bom/) · [Upgrade Notes](https://docs.spring.io/spring-ai/reference/upgrade-notes.html) · [ChatClient API](https://docs.spring.io/spring-ai/reference/api/chatclient.html) · [Advisors API](https://docs.spring.io/spring-ai/reference/api/advisors.html) · [Chat Memory](https://docs.spring.io/spring-ai/reference/api/chat-memory.html) · [Retrieval Augmented Generation](https://docs.spring.io/spring-ai/reference/api/retrieval-augmented-generation.html) · [PGvector](https://docs.spring.io/spring-ai/reference/api/vectordbs/pgvector.html) · [ETL Pipeline](https://docs.spring.io/spring-ai/reference/api/etl-pipeline.html) · [Tool Calling](https://docs.spring.io/spring-ai/reference/api/tools.html) · [Structured Output](https://docs.spring.io/spring-ai/reference/api/structured-output-converter.html) · [Provider-Native Structured Output](https://docs.spring.io/spring-ai/reference/api/structured-output/native.html) · [Bedrock Converse](https://docs.spring.io/spring-ai/reference/api/chat/bedrock-converse.html) · [Titan Embeddings](https://docs.spring.io/spring-ai/reference/api/embeddings/bedrock-titan-embedding.html) · [MCP Client Boot Starter](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-client-boot-starter-docs.html) · [MCP Server Boot Starter](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-server-boot-starter-docs.html) · [MCP Server Annotations](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-annotations-server.html) · [Default advisor orders: `Advisor.java`](https://github.com/spring-projects/spring-ai/blob/v2.0.1/spring-ai-client-chat/src/main/java/org/springframework/ai/chat/client/advisor/api/Advisor.java), [`QuestionAnswerAdvisor.java`](https://github.com/spring-projects/spring-ai/blob/v2.0.1/advisors/spring-ai-vector-store-advisor/src/main/java/org/springframework/ai/chat/client/advisor/vectorstore/QuestionAnswerAdvisor.java) · [Bedrock credential fallback: `BedrockAwsConnectionConfiguration.java`](https://github.com/spring-projects/spring-ai/blob/v2.0.1/auto-configurations/models/spring-ai-autoconfigure-model-bedrock-ai/src/main/java/org/springframework/ai/model/bedrock/autoconfigure/BedrockAwsConnectionConfiguration.java) · [Titan Text Embeddings V2 (1,024 dimensions)](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html) · [pgvector README (Docker image)](https://github.com/pgvector/pgvector)
