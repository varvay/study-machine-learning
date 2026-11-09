---
title: Agent memory
---

L1 split memory into short-term, what fits in the context window, and long-term, an external store the agent reads back; long-term memory is episodic (past events) or semantic (lasting facts) (G5.2 L1). Here both are built with Spring AI 2.0.1 on the capstone's Postgres tables (G1.8).

Spring AI separates two things that are easy to conflate:

- **Chat history** — every message the user and the model ever exchanged. It is the audit record; nothing is dropped from it.
- **Chat memory** — the part of the history the model receives on the next call. It is bounded, because every token sent costs money and the context window has a limit.

In the capstone schema the history is the `messages` table, and the memory is a query over it.

**Spring AI's building blocks.**

- **`ChatMemory`** — the interface an advisor talks to: `add(conversationId, messages)`, `get(conversationId)`, and `clear(conversationId)`.
- **`MessageWindowChatMemory`** — the default `ChatMemory`: it keeps the last N messages (20 by default). It evicts whole turns, a user message with its replies, and always keeps `SystemMessage`s.
- **`ChatMemoryRepository`** — where a `MessageWindowChatMemory` stores its messages: `findConversationIds()`, `findByConversationId(id)`, `saveAll(id, messages)`, and `deleteByConversationId(id)`. `InMemoryChatMemoryRepository` is the default; JDBC, Cassandra, Neo4j, MongoDB, and Redis versions (the database families of G1.6) ship as starters.
- **`MessageChatMemoryAdvisor`** — an advisor that loads the memory into the prompt before each call, then stores the new user message and the reply. It reads the conversation id from the request parameter `ChatMemory.CONVERSATION_ID` and throws `IllegalArgumentException` when it is missing. (`PromptChatMemoryAdvisor`, common in older tutorials, was removed in 2.0; `MessageChatMemoryAdvisor` replaces it.)

The memory advisor sits outside the tool loop by default (order `HIGHEST_PRECEDENCE + 200`, before the `ToolCallingAdvisor` at `+ 300`, G5.1; an advisor with a lower order runs first and wraps the ones after it). It therefore stores only the user's message and the final answer, never the intermediate tool calls.

**The quick path: the JDBC repository.** The starter `spring-ai-starter-model-chat-memory-repository-jdbc` stores messages in a `SPRING_AI_CHAT_MEMORY` table (`conversation_id`, `content`, `type`, `timestamp`, `sequence_id`). The property `spring.ai.chat.memory.repository.jdbc.initialize-schema` decides who creates it: `embedded` (the default) creates it only in an embedded database such as H2 (a Java database that runs inside the application), `always` creates it in Postgres too, and `never` leaves it to a schema-migration tool such as Flyway or Liquibase (G1.1 L3).

```java
ChatMemoryRepository repository = JdbcChatMemoryRepository.builder()
    .jdbcTemplate(jdbcTemplate)
    .dialect(new PostgresChatMemoryRepositoryDialect())
    .build();

ChatMemory chatMemory = MessageWindowChatMemory.builder()
    .chatMemoryRepository(repository)
    .maxMessages(20)
    .build();
```

It has two limits worth knowing. `saveAll` replaces a conversation's rows, and `MessageWindowChatMemory` passes it only the window, so the table ends up holding the last 20 messages, not the history. It also filters out tool-call messages. Both are fine for a demo; the capstone needs the full history for audits and evals, so it stores memory in its own tables.

**Memory on the G1.8 tables.** The capstone schema in G1.8 L2 already defines `conversations` (a uuid `id` and a `user_id`) and `messages` (a bigint identity `id`, `conversation_id`, `role`, `content`, `created_at`). Memory needs two more columns and one index:

```sql
ALTER TABLE conversations
    ADD COLUMN summary            text,
    ADD COLUMN summarized_through bigint;

CREATE INDEX messages_conversation_idx ON messages (conversation_id, id);
```

`summary` holds a running summary of the turns that have left the window, and `summarized_through` the last `messages.id` folded into it. The index serves the one query memory runs on every call: the latest rows of one conversation.

A custom `ChatMemory` makes the table the history and the window a query. `add` only appends; `get` reads the latest 20 rows and puts the summary in front.

```java
@Component
public class PostgresChatMemory implements ChatMemory {

    static final int WINDOW_MESSAGES = 20;

    private final JdbcClient jdbc;

    public PostgresChatMemory(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void add(String conversationId, List<Message> messages) {
        for (Message message : messages) {
            jdbc.sql("INSERT INTO messages (conversation_id, role, content) VALUES (?::uuid, ?, ?)")
                .params(conversationId, message.getMessageType().getValue(), message.getText())
                .update();
        }
    }

    @Override
    public List<Message> get(String conversationId) {
        List<Message> window = jdbc.sql("""
                SELECT role, content FROM (
                    SELECT id, role, content FROM messages
                    WHERE conversation_id = ?::uuid
                    ORDER BY id DESC LIMIT ?
                ) AS latest
                ORDER BY id""")
            .params(conversationId, WINDOW_MESSAGES)
            .query((row, rowNumber) -> toMessage(row.getString("role"), row.getString("content")))
            .list();
        List<Message> memory = new ArrayList<>();
        summaryOf(conversationId).ifPresent(summary -> memory.add(new SystemMessage("Summary of earlier turns: " + summary)));
        memory.addAll(window.stream().dropWhile(message -> message.getMessageType() != MessageType.USER).toList());
        return memory;
    }

    @Override
    public void clear(String conversationId) {
        jdbc.sql("DELETE FROM messages WHERE conversation_id = ?::uuid").param(conversationId).update();
    }

    private Optional<String> summaryOf(String conversationId) {
        return jdbc.sql("SELECT summary FROM conversations WHERE id = ?::uuid AND summary IS NOT NULL")
            .param(conversationId)
            .query(String.class)
            .optional();
    }

    private static Message toMessage(String role, String content) {
        return switch (role) {
            case "user" -> new UserMessage(content);
            case "assistant" -> new AssistantMessage(content);
            default -> new SystemMessage(content);
        };
    }
}
```

- **`ORDER BY id DESC LIMIT ?`, then `ORDER BY id`** fetches the newest rows through the index and returns them oldest first, the order the model reads.
- **`dropWhile(... != USER)`** starts the window at a user message, so a cut never begins with a reply to a question the model cannot see.
- **The summary as a `SystemMessage`** reaches the model as part of the system prompt: `MessageChatMemoryAdvisor` moves a system message to the front, and the Anthropic chat model joins all system messages into the request's `system` field.

Wire it in and pass the conversation id on every call. Create the `conversations` row when a chat starts (`INSERT … RETURNING id`), and derive the id on the server from the logged-in user, never from a value the client sends, so one user cannot read another's memory.

```java
ChatClient assistant = chatClientBuilder
    .defaultAdvisors(MessageChatMemoryAdvisor.builder(postgresChatMemory).build())
    .build();

String answer = assistant.prompt()
    .user(userText)
    .advisors(advisor -> advisor.param(ChatMemory.CONVERSATION_ID, conversationId))
    .call()
    .content();
```

**Summarizing old turns.** A window alone forgets: once a turn leaves it, the model no longer knows what was said there. A summarizer folds the turns that left the window into `conversations.summary` with one extra model call. It runs after a reply and waits until at least 10 messages have left the window, so it does not pay for a model call on every turn.

```java
@Component
public class ConversationSummarizer {

    private static final int MIN_MESSAGES_TO_FOLD = 10;

    private final JdbcClient jdbc;
    private final ChatClient chatClient;

    public ConversationSummarizer(JdbcClient jdbc, ChatClient.Builder chatClientBuilder) {
        this.jdbc = jdbc;
        this.chatClient = chatClientBuilder.build();
    }

    record OldMessage(long id, String role, String content) {}

    public void foldOldTurns(String conversationId) {
        List<OldMessage> outsideWindow = jdbc.sql("""
                SELECT m.id, m.role, m.content
                FROM messages m JOIN conversations c ON c.id = m.conversation_id
                WHERE m.conversation_id = ?::uuid
                  AND m.id > coalesce(c.summarized_through, 0)
                  AND m.id < (SELECT min(id) FROM (
                          SELECT id FROM messages WHERE conversation_id = ?::uuid
                          ORDER BY id DESC LIMIT ?) AS window_ids)
                ORDER BY m.id""")
            .params(conversationId, conversationId, PostgresChatMemory.WINDOW_MESSAGES)
            .query(OldMessage.class)
            .list();
        if (outsideWindow.size() < MIN_MESSAGES_TO_FOLD) {
            return;
        }
        String previousSummary = jdbc.sql("SELECT coalesce(summary, '') FROM conversations WHERE id = ?::uuid")
            .param(conversationId)
            .query(String.class)
            .single();
        String transcript = String.join("\n", outsideWindow.stream().map(message -> message.role() + ": " + message.content()).toList());
        String summary = chatClient.prompt()
            .system("Merge the new turns into the summary. Keep facts, decisions, names, numbers, and open questions. At most 200 words.")
            .user("Summary so far:\n" + previousSummary + "\n\nNew turns:\n" + transcript)
            .call()
            .content();
        jdbc.sql("UPDATE conversations SET summary = ?, summarized_through = ? WHERE id = ?::uuid")
            .params(summary, outsideWindow.get(outsideWindow.size() - 1).id(), conversationId)
            .update();
    }
}
```

The summary is rolling: each run merges the new turns into the previous summary, so its size stays bounded however long the conversation gets. What it loses is detail: a summary keeps what the prompt asked it to keep. The walkthrough below slides the window over a conversation; it folds each evicted turn at once, where the code above batches them.

**Vector-store memory.** A **vector-store memory** stores messages or facts as embeddings (G1.7) and retrieves the ones similar to the new question, instead of the most recent ones. Spring AI offers one advisor for it, and a per-user fact store takes a few lines more.

- **`VectorStoreChatMemoryAdvisor`** (artifact `spring-ai-vector-store-advisor`) writes every user message and reply to a `VectorStore`, Spring AI's interface to a vector database, as a document tagged with the conversation id. Before each call it searches that conversation's documents for the ones most similar to the new message (`defaultTopK`, 20 by default) and adds them to the system prompt under a `LONG_TERM_MEMORY` heading. It is episodic recall of old turns in the same conversation, including turns long outside the window.

```java
ChatClient withRecall = chatClientBuilder
    .defaultAdvisors(VectorStoreChatMemoryAdvisor.builder(turnRecallStore).defaultTopK(5).build())
    .build();
```

`turnRecallStore` is a `PgVectorStore`, the `VectorStore` implementation on Postgres with pgvector (G1.7 L2), on its own table, so recalled turns and the user facts below never mix.

- **Semantic memory across conversations** — lasting facts about a user, such as "prefers Java examples", kept in their own table and read by user id rather than conversation id. The model decides what is worth keeping through a tool, and each request recalls the facts relevant to the new message.

```sql
CREATE TABLE agent_memories (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content    text,
    metadata   json,
    embedding  vector(1024)
);

CREATE INDEX agent_memories_embedding_idx ON agent_memories USING hnsw (embedding vector_cosine_ops);
```

The four columns are the layout `PgVectorStore` reads and writes; set the vector size to your embedding model's output dimension. The index is HNSW (G1.7 L1), and `vector_cosine_ops` makes it rank by cosine distance. `metadata` holds `{"userId": "…"}`.

```java
@Bean
PgVectorStore agentMemoryStore(JdbcTemplate jdbcTemplate, EmbeddingModel embeddingModel) {
    return PgVectorStore.builder(jdbcTemplate, embeddingModel).vectorTableName("agent_memories").build();
}
```

```java
@Component
public class LongTermMemory {

    private final VectorStore agentMemoryStore;

    public LongTermMemory(@Qualifier("agentMemoryStore") VectorStore agentMemoryStore) {
        this.agentMemoryStore = agentMemoryStore;
    }

    public void remember(String userId, String fact) {
        agentMemoryStore.add(List.of(new Document(fact, Map.of("userId", userId))));
    }

    public String recall(String userId, String query) {
        List<Document> facts = agentMemoryStore.similaritySearch(SearchRequest.builder()
            .query(query)
            .topK(5)
            .similarityThreshold(0.5)
            .filterExpression(new FilterExpressionBuilder().eq("userId", userId).build())
            .build());
        if (facts.isEmpty()) {
            return "nothing yet";
        }
        return facts.stream().map(fact -> "- " + fact.getText()).collect(Collectors.joining("\n"));
    }
}

public class MemoryTools {

    private final LongTermMemory longTermMemory;

    public MemoryTools(LongTermMemory longTermMemory) {
        this.longTermMemory = longTermMemory;
    }

    @Tool(description = "Save one lasting fact about the user, such as a preference or goal, for future conversations. Do not save passing details.")
    public String rememberFact(String fact, ToolContext toolContext) {
        longTermMemory.remember((String) toolContext.getContext().get("userId"), fact);
        return "Saved.";
    }
}
```

```java
String answer = assistant.prompt()
    .system(system -> system.text("You are the study assistant.\n\nWhat you know about this user:\n{facts}")
        .param("facts", longTermMemory.recall(userId, userText)))
    .user(userText)
    .tools(new MemoryTools(longTermMemory))
    .toolContext(Map.of("userId", userId))
    .advisors(advisor -> advisor.param(ChatMemory.CONVERSATION_ID, conversationId))
    .call()
    .content();
summarizer.foldOldTurns(conversationId);
```

- **`ToolContext`** carries the user id to the tool without sending it to the model, so the model cannot write a fact under another user's id.
- **`FilterExpressionBuilder().eq("userId", …)`** restricts the search to that user's rows; building the filter as an object keeps user input out of a filter string.
- **`similarityThreshold(0.5)`** drops weak matches, so an unrelated fact does not land in the prompt just because it is the closest one.
- **The embedding model** comes from a separate starter, since Anthropic offers no embeddings; on AWS, `spring-ai-starter-model-bedrock` with `spring.ai.model.embedding=bedrock-titan` provides one: Amazon's Titan embedding model, served by Bedrock, AWS's managed model API (G6.1).
- **A second store.** The auto-configured `PgVectorStore` backs off, that is, Spring Boot skips creating it, as soon as any `PgVectorStore` bean exists, so an app that also searches `chunks` (G1.7) declares that store as a bean too.

| Memory kind | Where it lives | Read by | Spring AI piece |
|---|---|---|---|
| Short-term: the window | `messages`, last 20 rows | conversation id | custom `ChatMemory` + `MessageChatMemoryAdvisor` |
| Short-term: older turns, compressed | `conversations.summary` | conversation id | summarizer, one model call per batch |
| Episodic: similar past turns | a vector table | similarity, same conversation | `VectorStoreChatMemoryAdvisor` |
| Semantic: facts about the user | `agent_memories` | similarity, same user | a `@Tool` to write, `similaritySearch` to read |

Sources: [Spring AI — Chat Memory](https://docs.spring.io/spring-ai/reference/api/chat-memory.html) · [Spring AI — Tool Calling (memory and the tool loop, ToolContext)](https://docs.spring.io/spring-ai/reference/api/tools.html) · [Spring AI — Upgrade notes (PromptChatMemoryAdvisor removed)](https://docs.spring.io/spring-ai/reference/upgrade-notes.html) · [Spring AI — PGvector store](https://docs.spring.io/spring-ai/reference/api/vectordbs/pgvector.html) · [Spring AI source v2.0.1 (JdbcChatMemoryRepository, VectorStoreChatMemoryAdvisor, AnthropicChatModel)](https://github.com/spring-projects/spring-ai/tree/v2.0.1) · [Spring AI — Bedrock Titan embeddings](https://docs.spring.io/spring-ai/reference/api/embeddings/bedrock-titan-embedding.html)
