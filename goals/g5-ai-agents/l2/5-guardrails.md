---
title: Failure modes and guardrails
---

L1 named the failure modes — loops, the wrong tool, invented arguments, cost blow-up — and defined a guardrail as a check outside the model that limits what the agent can do or say (G5.5 L1). Below, each guardrail in code, in Spring AI 2.0.1 where it applies, then three guardrail products compared.

| Failure | Guardrail | Where it lives |
|---|---|---|
| The loop never ends | step limit | `spring.ai.tools.limits.*`, `MAX_STEPS` in a hand-built loop |
| A call hangs | timeouts | model client, MCP client, database |
| Tokens pile up | budget cap | an advisor inside the tool loop |
| Invented or malformed arguments | input validation | JSON Schema, checks in the tool |
| Harmful or off-topic text in or out | content filters | Amazon Bedrock Guardrails, NeMo Guardrails, Guardrails AI |
| Output the app cannot parse | output validation | structured output with schema validation |
| An irreversible action | human approval | a gate before the tool runs |

OWASP lists the root of most agent incidents as **Excessive Agency** (LLM06:2025): the agent has more functions, more permissions, or more autonomy than its task needs. The guardrails below cut each of the three.

**Step limits.** Spring AI's `ToolCallingManager` counts tool calls in the current turn and stops the loop when a limit is hit. Every extra model call in the loop follows at least one tool call, so a cap on tool calls also caps model calls.

```yaml
spring:
  ai:
    tools:
      limits:
        max-calls-per-tool-default: 5
        max-calls-per-tool:
          run_sql_query: 8
        max-total-tool-calls: 20
        on-limit-exceeded: RETURN_ERROR_RESPONSE
```

The defaults are 40 calls per tool and 150 in total, too generous for most agents. `on-limit-exceeded` picks what happens at the limit: `THROW` (the default) ends the turn with a `ToolCallLimitExceededException`, which `ToolCallingAdvisor` turns into the final response with that exception's finish reason (Spring AI's name for the stop reason); `RETURN_ERROR_RESPONSE` skips the call and tells the model the limit was reached, so it can still answer with what it has. The same limits exist on the builder, for a `ToolCallingManager` bean:

```java
ToolCallingManager toolCallingManager = ToolCallingManager.builder()
    .maxCallsPerTool(5)
    .maxCallsPerTool("run_sql_query", 8)
    .maxTotalToolCalls(20)
    .onLimitExceeded(ToolCallLimitBehavior.RETURN_ERROR_RESPONSE)
    .build();
```

**Timeouts.** Each hop has its own:

- **Model call** — `spring.ai.anthropic.timeout`, 60 seconds by default, overridable per request through `AnthropicChatOptions` (G5.1).
- **MCP tool call** — `spring.ai.mcp.client.request-timeout`, 20 seconds by default (G5.4).
- **Database** — `statement_timeout` on the tool's role or transaction (G5.4).

No setting bounds a whole turn, so a turn of many calls can still run long; wrap it when the caller has a deadline, for example `CompletableFuture.supplyAsync(() -> agent.prompt(...).call().content(), executor).orTimeout(60, TimeUnit.SECONDS)`.

**Budget caps.** A turn's cost is Σ over its model calls of (input tokens × input price + output tokens × output price) (G6.8). The input side grows with every step, because each call resends the transcript (G5.1). At `claude-opus-5-5` prices, $4 per million input tokens and $20 per million output tokens, a turn of three calls that sends 30,000 input tokens and generates 2,000 output tokens in total costs 30,000 × 4 / 10⁶ + 2,000 × 20 / 10⁶ = $0.12 + $0.04 = $0.16. An agent stuck in a loop multiplies that.

A budget advisor placed inside the tool loop sees every model call and stops the turn when it has spent its share. An advisor runs inside the loop when its order is higher than `ToolCallingAdvisor`'s `HIGHEST_PRECEDENCE + 300`:

```java
public class TokenBudgetAdvisor implements CallAdvisor {

    public static final String BUDGET = "token_budget";

    public static final class TokenBudget {
        private final int limit;
        private final AtomicInteger spent = new AtomicInteger();

        public TokenBudget(int limit) {
            this.limit = limit;
        }

        void spend(int tokens) {
            if (spent.addAndGet(tokens) > limit) {
                throw new BudgetExceededException("Token budget of " + limit + " exceeded");
            }
        }
    }

    public static final class BudgetExceededException extends RuntimeException {
        BudgetExceededException(String message) {
            super(message);
        }
    }

    @Override
    public String getName() {
        return "TokenBudgetAdvisor";
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 400;
    }

    @Override
    public ChatClientResponse adviseCall(ChatClientRequest request, CallAdvisorChain chain) {
        ChatClientResponse response = chain.nextCall(request);
        TokenBudget budget = (TokenBudget) request.context().get(BUDGET);
        if (budget != null && response.chatResponse() != null) {
            budget.spend(response.chatResponse().getMetadata().getUsage().getTotalTokens());
        }
        return response;
    }
}
```

```java
ChatClient agent = chatClientBuilder
    .defaultTools(shopTools)
    .defaultAdvisors(new TokenBudgetAdvisor())
    .build();

String answer = agent.prompt()
    .user(question)
    .advisors(advisor -> advisor.param(TokenBudgetAdvisor.BUDGET, new TokenBudgetAdvisor.TokenBudget(50_000)))
    .call()
    .content();
```

The budget travels in the request context, which `ToolCallingAdvisor` passes to every iteration, so one `TokenBudget` covers the whole turn. The final `ChatResponse` also reports the turn's total usage, summed over all iterations; storing it per request in the `traces` table (G1.8) supports a daily cap per user.

**Input validation** happens at three levels:

- **The schema.** `required`, `enum`, and numeric ranges constrain what the model can send; with Claude's `strict: true` every call matches the schema exactly (G5.4).
- **The tool.** The tool checks what a schema cannot, such as whether an order id belongs to the current user, and throws an exception whose message says what was wrong and what is valid. Spring AI sends that message back as the tool result, and the model can correct the call.
- **The content.** User text is checked for attacks, off-topic requests, and personal data before it reaches the model. Spring AI's built-in `SafeGuardAdvisor` only blocks prompts that contain words from a list (`SafeGuardAdvisor.builder().sensitiveWords(List.of(...)).build()`); real classification needs a guardrail product, below.

**Output validation.** Parse the reply into a type instead of trusting free text. `.entity(Verdict.class, spec -> spec.validateSchema())` checks the JSON against the schema of the type, and `StructuredOutputValidationAdvisor` retries with the validation error added to the prompt, up to 3 attempts by default:

```java
ChatClient validated = chatClientBuilder
    .defaultAdvisors(StructuredOutputValidationAdvisor.builder().outputType(RefundDecision.class).maxRepeatAttempts(3).build())
    .build();
```

**Human approval for risky tools.** A risky tool is one whose effect is hard to undo: a refund, a deletion, an email to a customer. Two ways to gate it:

- **Approval inside the tool.** The tool records a pending request and returns "Sent for approval as request 1234", and a human approves it later in another screen. The agent never performs the action itself. This suits approvals that take hours.
- **An approval gate in the loop.** The app runs the loop itself and asks a human before executing a risky call. In Spring AI that means switching off the auto-registered `ToolCallingAdvisor` for the request and driving `ToolCallingManager` directly:

```java
private static final Set<String> NEEDS_APPROVAL = Set.of("refundOrder", "deleteAccount");

public String run(ChatClient chatClient, Object tools, Approvals approvals, String question) {
    ToolCallingManager toolCallingManager = ToolCallingManager.builder().build();
    ChatOptions options = ToolCallingChatOptions.builder().toolCallbacks(ToolCallbacks.from(tools)).build();
    Prompt prompt = new Prompt(List.of(new UserMessage(question)), options);
    ChatClientResponse response = call(chatClient, prompt);
    for (int step = 1; step <= 10 && response.chatResponse().hasToolCalls(); step++) {
        for (AssistantMessage.ToolCall toolCall : response.chatResponse().getResult().getOutput().getToolCalls()) {
            if (NEEDS_APPROVAL.contains(toolCall.name()) && !approvals.approve(toolCall.name(), toolCall.arguments())) {
                return "A reviewer declined " + toolCall.name() + "; nothing was changed.";
            }
        }
        ToolExecutionResult result = toolCallingManager.executeToolCalls(prompt, response.chatResponse());
        prompt = new Prompt(result.conversationHistory(), options);
        response = call(chatClient, prompt);
    }
    return response.chatResponse().getResult().getOutput().getText();
}

private static ChatClientResponse call(ChatClient chatClient, Prompt prompt) {
    return chatClient.prompt(prompt)
        .advisors(AdvisorParams.toolCallingAdvisorAutoRegister(false))
        .call()
        .chatClientResponse();
}
```

`Approvals` is the app's own interface, such as a blocking prompt in a CLI or a task in a review queue. `toolCall.arguments()` is the JSON the model wrote, shown to the reviewer as is. The Spring AI docs note that driving the loop yourself bypasses the advisors and observability (the metrics and traces Spring AI records for each call; G6.6) of the built-in loop; a subclass of `ToolCallingAdvisor` that checks calls in its `doAfterCall` hook keeps them, at the cost of more code. The MCP spec asks for the same control on the client side: a human able to deny tool invocations, with a confirmation prompt for sensitive operations.

**Guardrail products.**

| | Amazon Bedrock Guardrails | NeMo Guardrails (NVIDIA) | Guardrails AI |
|---|---|---|---|
| What it is | a managed AWS service: policies you configure, applied by AWS | an open-source Python toolkit of programmable "rails", each a check at one stage of the conversation | an open-source Python framework of validators |
| Checks | content filters (hate, insults, sexual, violence, misconduct, prompt attack), denied topics, word filters, sensitive-information (PII: personally identifiable information, such as names and card numbers) filters with block or mask, contextual grounding (is the answer supported by the source text?), Automated Reasoning checks (an answer checked against policy rules written as formal logic) | input, dialog, retrieval, execution (tool input and output), and output rails, configured in YAML and Colang, NVIDIA's language for describing dialogue flows | validators, each a check on text or structured output, such as a regex match, installed one package per validator |
| Called from | any app, via the `ApplyGuardrail` API, or inline in a Bedrock `Converse` call, Bedrock's API for calling a model | Python: `LLMRails(RailsConfig.from_path(...)).generate(messages=...)` | Python: `Guard().use(validator)`, then `guard.parse(text)` |

**Bedrock Guardrails in a Spring AI app.** A guardrail is created in the Bedrock console or API, then published as a numbered version. The `ApplyGuardrail` API checks any text against it without calling a model, so it works in front of a Claude model reached through the Anthropic API as well. `source` says what the text is: `INPUT` for user text, `OUTPUT` for model text. The response's `action` is `GUARDRAIL_INTERVENED` or `NONE`; when the guardrail blocked, `outputs` holds the message configured for blocked content, and when it masked PII, `outputs` holds the masked text. An advisor applies it on the way in and on the way out:

```java
public class BedrockGuardrailAdvisor implements CallAdvisor {

    private final BedrockRuntimeClient bedrock;
    private final String guardrailId;
    private final String guardrailVersion;

    public BedrockGuardrailAdvisor(BedrockRuntimeClient bedrock, String guardrailId, String guardrailVersion) {
        this.bedrock = bedrock;
        this.guardrailId = guardrailId;
        this.guardrailVersion = guardrailVersion;
    }

    @Override
    public String getName() {
        return "BedrockGuardrailAdvisor";
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 100;
    }

    @Override
    public ChatClientResponse adviseCall(ChatClientRequest request, CallAdvisorChain chain) {
        ApplyGuardrailResponse inputCheck = check(request.prompt().getUserMessage().getText(), GuardrailContentSource.INPUT);
        if (inputCheck.action() == GuardrailAction.GUARDRAIL_INTERVENED) {
            return blocked(request, inputCheck);
        }
        ChatClientResponse response = chain.nextCall(request);
        ApplyGuardrailResponse outputCheck = check(response.chatResponse().getResult().getOutput().getText(), GuardrailContentSource.OUTPUT);
        return outputCheck.action() == GuardrailAction.GUARDRAIL_INTERVENED ? blocked(request, outputCheck) : response;
    }

    private ApplyGuardrailResponse check(String text, GuardrailContentSource source) {
        return bedrock.applyGuardrail(guardrail -> guardrail
            .guardrailIdentifier(guardrailId)
            .guardrailVersion(guardrailVersion)
            .source(source)
            .content(GuardrailContentBlock.fromText(block -> block.text(text))));
    }

    private static ChatClientResponse blocked(ChatClientRequest request, ApplyGuardrailResponse check) {
        String cannedMessage = check.outputs().get(0).text();
        ChatResponse chatResponse = ChatResponse.builder()
            .generations(List.of(new Generation(new AssistantMessage(cannedMessage))))
            .build();
        return ChatClientResponse.builder().chatResponse(chatResponse).context(request.context()).build();
    }
}
```

The AWS classes come from `software.amazon.awssdk:bedrockruntime`. Order `HIGHEST_PRECEDENCE + 100` puts the advisor outside the tool loop, so it checks the user's message once and the final answer once, not every intermediate step. Tool results are a separate gap: when a guardrail runs inline in a `Converse` call that uses tools, AWS documents that it evaluates neither tool results, nor tool definitions, nor the tool arguments the model writes. Text a tool fetched from outside, such as a web page or an email, can carry instructions for the model (indirect prompt injection, G3.5). To screen it, call `ApplyGuardrail` on the tool's output inside the tool.

NeMo Guardrails, for a Python service, from its README:

```python
from nemoguardrails import LLMRails, RailsConfig

config = RailsConfig.from_path("PATH/TO/CONFIG")
rails = LLMRails(config)
completion = rails.generate(messages=[{"role": "user", "content": "Hello world!"}])
```

Guardrails AI, from its quickstart (each validator is installed as its own package):

```bash
pip install guardrails-ai-regex-match
```

```python
from guardrails_ai.regex_match import RegexMatch
from guardrails import Guard

guard = Guard().use(RegexMatch(regex="^[A-Z][a-z]*$"))
print(guard.parse("Caesar").validation_passed)
```

Sources: [OWASP — LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) · [Spring AI — Tool Calling (tool call limits, user-controlled execution)](https://docs.spring.io/spring-ai/reference/api/tools.html) · [Spring AI — ToolCallingAdvisor (hooks, context)](https://docs.spring.io/spring-ai/reference/api/tools/tool-calling-advisor.html) · [Spring AI — Recursive Advisors (StructuredOutputValidationAdvisor)](https://docs.spring.io/spring-ai/reference/api/advisors-recursive.html) · [Spring AI — Advisors (SafeGuardAdvisor)](https://docs.spring.io/spring-ai/reference/api/advisors.html) · [Spring AI — Anthropic Chat (timeout)](https://docs.spring.io/spring-ai/reference/api/chat/anthropic-chat.html) · [Spring AI — MCP Client Boot Starter (request-timeout)](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-client-boot-starter-docs.html) · [Claude API — Pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [MCP spec 2026-07-28 — Tools (human in the loop)](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) · [Amazon Bedrock Guardrails — overview](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html) · [Bedrock — ApplyGuardrail API](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-use-independent-api.html) · [Bedrock — Guardrails with the Converse API (tool content not evaluated)](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-use-converse-api.html) · [AWS SDK for Java 2.x — ApplyGuardrailRequest.Builder](https://docs.aws.amazon.com/java/api/latest/software/amazon/awssdk/services/bedrockruntime/model/ApplyGuardrailRequest.Builder.html) · [NeMo Guardrails](https://github.com/NVIDIA/NeMo-Guardrails) · [Guardrails AI — Quickstart](https://www.guardrailsai.com/docs/getting_started/quickstart)
