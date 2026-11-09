---
title: Tools and MCP
---

L1 covered tool calling, where the model asks your code to run a function, and MCP, the open protocol that lets any host application use tools from any server (G5.4 L1). Below: tool definitions written three ways, then the capstone's MCP server, a read-only SQL tool, with an agent connected to it. Spring AI version followed: 2.0.1.

**A tool definition** has three parts, whatever the API:

- **Name** — the identifier the model calls, unique within the tools it is given, such as `run_sql_query`.
- **Description** — plain-language instructions on what the tool does and when to use it. The model chooses tools from descriptions, so a vague one leads to the wrong tool.
- **Input schema** — a JSON Schema object for the arguments: `type`, `properties` with a `description` each, `required`, and constraints such as `enum`, `minimum`, or `maxLength`. Constraints narrow what the model can send, so fewer calls arrive with invented values.

The same SQL tool in the Claude Messages API format (G5.1), with `strict: true`, which guarantees that every call's `input` validates against the schema. Strict mode requires `additionalProperties: false`.

```json
{
  "name": "run_sql_query",
  "description": "Run one read-only PostgreSQL SELECT over the capstone database and return at most 100 rows as JSON. Call list_tables first to learn the columns.",
  "strict": true,
  "input_schema": {
    "type": "object",
    "properties": {
      "sql": { "type": "string", "description": "A single SELECT statement, no semicolon" }
    },
    "required": ["sql"],
    "additionalProperties": false
  }
}
```

**Tools in Spring AI.** `@Tool` turns a method into a tool, and Spring AI generates the schema from its signature (see the generated schema in G5.1).

- **`@Tool`** attributes: `name` (defaults to the method name), `description`, `returnDirect` (return the result to the caller and skip the model's final reply, for when the tool's output is already the answer), and `resultConverter` (how the return value becomes text; JSON by default).
- **`@ToolParam(description = …, required = …)`** describes one parameter. Every parameter is required unless marked `required = false` or `@Nullable`; the docs warn that a required parameter the model cannot know gets invented.
- **`ToolContext`** as a parameter receives data the application passes with `.toolContext(Map.of(...))`, such as a tenant (the customer organization a request belongs to; G1.8 L3) or user id, without sending it to the model (G5.2).
- **Errors.** A `RuntimeException` becomes the tool result, so the model reads the message and can retry. A checked exception propagates to the caller. `spring.ai.tools.throw-exception-on-error=true` makes every tool error propagate.
- **Where tools attach.** `.tools(...)` on one request, or `.defaultTools(...)` on the `ChatClient` for every request. The docs advise attaching risky or destructive tools per request, not as defaults.

For a tool defined at run time, such as one per configured data source, `FunctionToolCallback` wraps a function without annotations:

```java
record WeatherRequest(String city) {}

ToolCallback currentWeather = FunctionToolCallback.builder("currentWeather", (WeatherRequest request) -> weatherService.fetch(request.city()))
    .description("Get the current weather in a city")
    .inputType(WeatherRequest.class)
    .build();
```

**MCP in one paragraph.** The Model Context Protocol connects an AI application to capabilities it did not build in. The **host** is the application with the model, such as the capstone agent or Claude Desktop. It runs one **client** per connection, and each client talks to one **server**, which exposes tools, resources (readable data), and prompts. Messages are JSON-RPC 2.0. A tool is listed with `tools/list` and invoked with `tools/call`:

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": { "name": "run_sql_query", "arguments": { "sql": "SELECT count(*) FROM documents" } } }
```

```json
{ "jsonrpc": "2.0", "id": 2,
  "result": { "content": [ { "type": "text", "text": "[{\"count\":42}]" } ], "isError": false } }
```

A failing tool answers with `isError: true` and a message the model can act on, the counterpart of Claude's `is_error` (G5.1). An unknown tool or a malformed request is a JSON-RPC protocol error instead.

**Transports** — how the JSON-RPC messages travel.

| Transport | How it works | Use for | Spring AI server setting |
|---|---|---|---|
| stdio | the host launches the server as a subprocess; newline-delimited JSON on stdin and stdout, the process's standard input and output | local tools on the user's machine, one user | `spring-ai-starter-mcp-server` with `spring.ai.mcp.server.stdio=true` |
| Streamable HTTP | the server is an independent process with one endpoint, `/mcp`; each message is an HTTP POST, and replies come back as JSON or an SSE stream (Server-Sent Events: several messages streamed over one open HTTP response) | shared, remote servers with many clients | `spring-ai-starter-mcp-server-webmvc` (or `-webflux`, the reactive variant) with `protocol: STREAMABLE`, the default |

The older HTTP+SSE transport is deprecated in Spring AI 2.0 in favour of Streamable HTTP. Over stdio, the server must write nothing but MCP messages to stdout, so Spring Boot's banner (the logo it prints at startup) and console logging must be off.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 280" role="img" aria-labelledby="tools-mcp-title">
<title id="tools-mcp-title">The capstone agent's MCP client calls the SQL MCP server over Streamable HTTP; the server queries PostgreSQL as a read-only role; other MCP hosts can use the same server</title>
<rect class="table-body" x="20" y="40" width="230" height="150" rx="8" />
<rect class="dimension-head" x="20" y="40" width="230" height="30" rx="8" />
<rect class="dimension-head" x="20" y="58" width="230" height="12" />
<rect class="table-outline" x="20" y="40" width="230" height="150" rx="8" />
<text class="table-name" x="32" y="60">capstone agent (host)</text>
<text x="32" y="96">ChatClient + ToolCallingAdvisor</text>
<text x="32" y="120">SyncMcpToolCallbackProvider</text>
<text x="32" y="144">MCP client, one per server</text>
<text class="key-tag" x="32" y="172">spring-ai-starter-mcp-client</text>
<path class="key-link" d="M250,115 L340,115" />
<text class="note" x="295" y="104" text-anchor="middle">Streamable</text>
<text class="note" x="295" y="134" text-anchor="middle">HTTP /mcp</text>
<rect class="table-body" x="340" y="40" width="220" height="150" rx="8" />
<rect class="fact-head" x="340" y="40" width="220" height="30" rx="8" />
<rect class="fact-head" x="340" y="58" width="220" height="12" />
<rect class="table-outline" x="340" y="40" width="220" height="150" rx="8" />
<text class="table-name" x="352" y="60">sql-mcp-server</text>
<text class="key-column" x="352" y="96">list_tables</text><text class="key-tag" x="548" y="96" text-anchor="end">@McpTool</text>
<text class="key-column" x="352" y="120">run_sql_query</text><text class="key-tag" x="548" y="120" text-anchor="end">@McpTool</text>
<text x="352" y="144">read only · 5 s · 100 rows</text>
<text class="key-tag" x="352" y="172">spring-ai-starter-mcp-server-webmvc</text>
<path class="key-link" d="M560,115 L610,115" />
<text class="note" x="585" y="104" text-anchor="middle">JDBC</text>
<rect class="table-body" x="610" y="60" width="130" height="100" rx="8" />
<rect class="dimension-head" x="610" y="60" width="130" height="30" rx="8" />
<rect class="dimension-head" x="610" y="78" width="130" height="12" />
<rect class="table-outline" x="610" y="60" width="130" height="100" rx="8" />
<text class="table-name" x="622" y="80">PostgreSQL</text>
<text x="622" y="116">role agent_reader</text>
<text class="key-tag" x="622" y="140">SELECT grants only</text>
<rect class="table-body" x="20" y="222" width="230" height="36" rx="8" />
<rect class="table-outline" x="20" y="222" width="230" height="36" rx="8" />
<text x="135" y="245" text-anchor="middle">another host: Claude Desktop, an IDE</text>
<path class="key-link" d="M250,240 C300,240 300,175 340,175" />
</svg>
</div>
<figcaption>The capstone's MCP setup. The server owns the database access; any MCP host can use it, and the agent sees its tools as ordinary Spring AI tool callbacks.</figcaption>
</figure>

**Building the SQL MCP server.** A separate Spring Boot app with `spring-ai-starter-mcp-server-webmvc`, `spring-boot-starter-jdbc`, and the PostgreSQL driver.

```yaml
server:
  port: 8081
  address: 127.0.0.1
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/capstone
    username: agent_reader
    password: ${AGENT_READER_PASSWORD}
  ai:
    mcp:
      server:
        name: sql-mcp-server
        version: 1.0.0
        protocol: STREAMABLE
        instructions: "Read-only SQL access to the capstone database."
```

```java
@Component
public class SqlTools {

    private static final int MAX_ROWS = 100;

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;

    public SqlTools(JdbcTemplate jdbc, PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @McpTool(name = "list_tables",
            description = "List the tables and columns you may query, with their types.",
            annotations = @McpTool.McpAnnotations(readOnlyHint = true, openWorldHint = false))
    public List<Map<String, Object>> listTables() {
        return jdbc.queryForList("""
                SELECT table_name, column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                ORDER BY table_name, ordinal_position""");
    }

    @McpTool(name = "run_sql_query",
            description = "Run one read-only PostgreSQL SELECT over the capstone database and return at most 100 rows as JSON. Call list_tables first to learn the columns.",
            annotations = @McpTool.McpAnnotations(readOnlyHint = true, openWorldHint = false))
    public List<Map<String, Object>> runSqlQuery(
            @McpToolParam(description = "A single SELECT statement, no semicolon", required = true) String sql) {
        return transaction.execute(status -> {
            jdbc.execute("SET TRANSACTION READ ONLY");
            jdbc.execute("SET LOCAL statement_timeout = '5s'");
            return jdbc.query(connection -> {
                PreparedStatement statement = connection.prepareStatement(sql);
                statement.setMaxRows(MAX_ROWS);
                return statement;
            }, new ColumnMapRowMapper());
        });
    }
}
```

The annotations are `org.springframework.ai.mcp.annotation.McpTool` and `McpToolParam`; the server's auto-configuration scans beans for them and registers each as an MCP tool with a generated schema. A plain `@Tool` bean works too, registered through a `ToolCallbackProvider` bean (`MethodToolCallbackProvider.builder().toolObjects(sqlTools).build()`).

The model writes the SQL, so the tool must stay safe whatever SQL arrives. Four layers do that, from strongest to weakest:

1. **A read-only database role.** The server connects as a role that can only `SELECT` the tables the agent may see. Even a `DROP TABLE` that slipped through every other layer fails on permissions.
2. **A read-only transaction.** `SET TRANSACTION READ ONLY` makes Postgres reject any write inside it.
3. **A statement timeout.** `SET LOCAL statement_timeout` cancels a query after 5 seconds, so a missing join condition cannot run for an hour. `LOCAL` scopes it to this transaction.
4. **A row cap.** `setMaxRows(100)` stops the driver after 100 rows, so a `SELECT *` over a large table cannot flood the model's context.

```sql
CREATE ROLE agent_reader LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE capstone TO agent_reader;
GRANT USAGE ON SCHEMA public TO agent_reader;
GRANT SELECT ON documents, chunks, eval_runs TO agent_reader;
ALTER ROLE agent_reader SET statement_timeout = '5s';
```

`information_schema`, the standard set of catalog views that describe a database's tables and columns, lists only the columns the connected role has privileges on, so `list_tables` shows the agent exactly the tables it may query, here `documents`, `chunks`, and `eval_runs`.

`readOnlyHint` and `openWorldHint` are MCP tool annotations: hints that tell a host the tool changes nothing and touches no outside system, which a host may use to skip a confirmation prompt. The spec tells clients to treat annotations as untrusted unless the server is trusted, so they never replace the database layers. SQL errors are Spring `DataAccessException`s, which are runtime exceptions, so the model receives the Postgres error message as an error result and can fix its query.

**Securing the endpoint.** The HTTP transports accept every request by default: any client that reaches `POST /mcp` can list and call every tool. Binding to `127.0.0.1`, as above, keeps it local; before it leaves the machine, put Spring Security in front of it (the Spring AI docs point to the `mcp-security` community project for OAuth 2, the standard protocol for granting a client an access token).

**The same server over stdio**, for a desktop host that launches it as a subprocess, uses `spring-ai-starter-mcp-server` and these properties:

```yaml
spring:
  main:
    web-application-type: none
    banner-mode: off
  ai:
    mcp:
      server:
        stdio: true
        name: sql-mcp-server
logging:
  pattern:
    console: ""
  file:
    name: sql-mcp-server.log
```

An empty console pattern turns console logging off, and the log goes to a file instead; Spring AI's stdio example server uses the same two settings.

**Connecting the agent.** The capstone agent adds `spring-ai-starter-mcp-client` and names its servers:

```yaml
spring:
  ai:
    mcp:
      client:
        type: SYNC
        request-timeout: 20s
        streamable-http:
          connections:
            capstone-db:
              url: http://127.0.0.1:8081
        stdio:
          connections:
            local-sql:
              command: java
              args:
                - -jar
                - /opt/tools/sql-mcp-server.jar
```

`type: SYNC` picks the blocking client (`ASYNC` is the reactive one). The `streamable-http` connection's `endpoint` defaults to `/mcp`. On startup the client connects to each server and exposes all their tools as one `SyncMcpToolCallbackProvider` bean. Spring AI does not attach it to `ChatClient` automatically, because listing tools means a network round trip to every server; the app attaches it explicitly:

```java
@Bean
ChatClient capstoneAgent(ChatClient.Builder builder, SyncMcpToolCallbackProvider mcpTools) {
    return builder
        .defaultSystem("You answer questions about the capstone data. Use the SQL tools; never guess numbers.")
        .defaultTools(mcpTools)
        .build();
}
```

From here the agent loop of G5.1 runs unchanged: `ToolCallingAdvisor` cannot tell an MCP tool from a local `@Tool`. When two servers expose the same tool name, the default `McpToolNamePrefixGenerator` adds a prefix to keep names unique; a local tool with the same name as a remote one needs renaming, or an `McpToolFilter` bean to drop the remote one.

To test the server without the agent, run the MCP Inspector, the MCP project's browser tool for calling a server by hand, `npx @modelcontextprotocol/inspector`, connect it to `http://127.0.0.1:8081/mcp`, and call `list_tables` by hand. For the stdio build, pass the launch command: `npx @modelcontextprotocol/inspector java -jar sql-mcp-server.jar`.

**Protocol versions.** Spring AI 2.0.1 builds on the MCP Java SDK 2.0.0, which speaks protocol revisions up to 2025-11-25. The current revision, 2026-07-28, drops the connection-scoped session and its `initialize` handshake, carrying the protocol version in every request instead; its spec describes how implementations fall back to talk with earlier revisions.

Sources: [Claude API — Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) · [Claude API — Strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use) · [Spring AI — Tool Calling](https://docs.spring.io/spring-ai/reference/api/tools.html) · [Spring AI — MCP Server Boot Starter](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-server-boot-starter-docs.html) · [Spring AI — Streamable-HTTP MCP servers](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-streamable-http-server-boot-starter-docs.html) · [Spring AI — MCP server annotations](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-annotations-server.html) · [Spring AI — MCP Client Boot Starter](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-client-boot-starter-docs.html) · [MCP spec 2026-07-28 — Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) · [MCP spec 2026-07-28 — Transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports) · [MCP spec 2025-11-25 — Transports (stdio rules)](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) · [spring-ai-examples — stdio server properties](https://github.com/spring-projects/spring-ai-examples/blob/main/model-context-protocol/weather/starter-stdio-server/src/main/resources/application.properties) · [Spring AI MCP Security](https://github.com/spring-ai-community/mcp-security) · [MCP Inspector](https://github.com/modelcontextprotocol/inspector) · [PostgreSQL — SET TRANSACTION](https://www.postgresql.org/docs/current/sql-set-transaction.html) · [PostgreSQL — statement_timeout](https://www.postgresql.org/docs/current/runtime-config-client.html)
