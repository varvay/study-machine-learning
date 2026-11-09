---
title: The agent loop
---

L1 defined the agent loop: the model reasons, calls a tool, reads the result, and repeats until it can answer (G5.1 L1). Here the loop is built twice: once by hand against the Claude Messages API (Anthropic's HTTP endpoint that takes a conversation and returns the model's next reply), then again with Spring AI, where the framework runs it.

**The tool-calling protocol.** Tool calling is the API feature that lets a model ask your code to run a function. On the Claude Messages API (`POST /v1/messages`) one step of the loop is four moves:

1. The request carries `tools`: each tool has a `name`, a `description` that tells the model when to use it, and an `input_schema`, a JSON Schema object describing the arguments.
2. When the model wants a tool, the response has `stop_reason: "tool_use"` and one or more `tool_use` blocks, each with an `id`, the tool `name`, and the `input` arguments.
3. Your code runs each tool and appends one `user` message holding a `tool_result` block per call: the `tool_use_id` it answers, the `content`, and `is_error: true` if the tool failed.
4. The next request sends the whole transcript again. The model either calls more tools or answers with `stop_reason: "end_turn"`.

The model never runs a tool you define; your code does, which is where permissions and limits live (G5.5). The API keeps no state between requests, so the transcript you resend is the agent's whole short-term memory (G5.2).

**ReAct** (Reason + Act) is the pattern of interleaving reasoning with actions and reading each action's result, the observation, before the next step. In the original paper the model wrote `Thought:` and `Action:` lines in plain text; the harness, the program around the model that runs the loop, parsed each action, ran it, and appended an `Observation:` line. Native tool calling turns the same loop into structured blocks:

| ReAct step | Claude Messages API |
|---|---|
| Reason | the model's thinking (reasoning it writes in separate thinking blocks before its reply), or text before a call |
| Act | a `tool_use` block |
| Observe | the `tool_result` block your code sends back |

**By hand, in Python.** Python fits this step: the interview checklist asks for a small Python LLM script written live, the loop fits in one file with no build, and the Java version follows in Spring AI, where the framework owns the loop. Setup: `pip install anthropic` (Anthropic's Python SDK) and `export ANTHROPIC_API_KEY=…`.

```python
import anthropic

client = anthropic.Anthropic()
MODEL = "claude-opus-5-5"
MAX_STEPS = 10

PRICES_EUR = {"keyboard": 49.0, "monitor": 189.0, "mouse": 25.0}

TOOLS = [
    {
        "name": "lookup_price",
        "description": "Return the unit price in EUR of one product in the shop catalogue. Call it once per product the user names.",
        "input_schema": {
            "type": "object",
            "properties": {
                "product": {"type": "string", "description": "Product name, singular and lowercase, e.g. 'keyboard'"},
            },
            "required": ["product"],
        },
    },
    {
        "name": "order_total",
        "description": "Compute an order total in EUR from unit prices and quantities, after an optional percentage discount. Use it for every total; never do the arithmetic yourself.",
        "input_schema": {
            "type": "object",
            "properties": {
                "lines": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "unit_price": {"type": "number"},
                            "quantity": {"type": "integer", "minimum": 1},
                        },
                        "required": ["unit_price", "quantity"],
                    },
                },
                "discount_percent": {"type": "number", "minimum": 0, "maximum": 100},
            },
            "required": ["lines"],
        },
    },
]


def lookup_price(product: str) -> str:
    if product not in PRICES_EUR:
        raise ValueError(f"Unknown product '{product}'. Known products: {', '.join(PRICES_EUR)}")
    return str(PRICES_EUR[product])


def order_total(lines: list[dict], discount_percent: float = 0) -> str:
    subtotal = sum(line["unit_price"] * line["quantity"] for line in lines)
    return f"{subtotal * (1 - discount_percent / 100):.2f}"


TOOL_FUNCTIONS = {"lookup_price": lookup_price, "order_total": order_total}


def run_tool(call) -> dict:
    function = TOOL_FUNCTIONS.get(call.name)
    try:
        if function is None:
            raise ValueError(f"Unknown tool '{call.name}'")
        output = function(**call.input)
        return {"type": "tool_result", "tool_use_id": call.id, "content": output}
    except Exception as error:
        return {"type": "tool_result", "tool_use_id": call.id, "content": str(error), "is_error": True}


def run_agent(question: str) -> str:
    messages = [{"role": "user", "content": question}]
    for _ in range(MAX_STEPS):
        response = client.messages.create(
            model=MODEL,
            max_tokens=16000,
            system="You are a shop assistant. Answer price questions with the tools.",
            tools=TOOLS,
            messages=messages,
        )
        messages.append({"role": "assistant", "content": response.content})
        if response.stop_reason == "end_turn":
            return "".join(block.text for block in response.content if block.type == "text")
        if response.stop_reason != "tool_use":
            raise RuntimeError(f"Stopped without an answer: {response.stop_reason}")
        tool_calls = [block for block in response.content if block.type == "tool_use"]
        messages.append({"role": "user", "content": [run_tool(call) for call in tool_calls]})
    raise RuntimeError(f"No answer after {MAX_STEPS} model calls")


if __name__ == "__main__":
    print(run_agent("What do 3 keyboards and 2 monitors cost with 20% off?"))
```

What each part is for:

- **`messages.append(... response.content)`** keeps the whole assistant reply, not just its text. The `tool_result` blocks must answer `tool_use` blocks that are in the history, and thinking blocks must go back unchanged, since they carry the reasoning behind the tool calls.
- **One `user` message for all results.** When the model calls several tools in one reply (parallel tool calls), every `tool_result` goes back together in the next message, matched by `tool_use_id`.
- **Errors become results.** A failing tool returns `is_error: true` with a message that says what went wrong and what is valid. The model can then correct itself, for example by asking about a known product, where an exception would kill the run.
- **Three exits.** `end_turn` returns the answer; `tool_use` continues the loop; any other stop reason, such as `max_tokens` (the reply hit the output cap) or `refusal` (the model declined the request), stops with an error instead of returning half an answer.
- **`MAX_STEPS`** bounds the number of model calls, so a model that keeps calling tools cannot loop forever (G5.5).
- **Thinking.** `claude-opus-5-5` decides per request whether to think; the "reason" step happens in thinking blocks, which count toward `max_tokens`. That is why `max_tokens` is 16,000 and not a few hundred.

A typical run takes three model calls: two `lookup_price` calls in one reply, then `order_total` with both prices and the 20% discount, then the answer, EUR 420.00 (3 × 49 + 2 × 189 = 525; 525 × 0.8 = 420). The walkthrough below steps through it and shows the transcript growing with every call.

**Rebuilt in Spring AI.** Spring AI 2.0 runs the same loop inside `ChatClient`, its fluent API for calling a model: a `ToolCallingAdvisor`, registered automatically, sends the tool definitions, executes the calls the model asks for, appends the results, and calls the model again until a reply has no tool calls. An advisor is a Spring AI hook that wraps each model call to add behavior (G6.2 L1). Calling a `ChatModel`, the lower-level interface to one provider's model, directly returns the model's tool calls unexecuted, so tutorials written for Spring AI 1.x, where each `ChatModel` ran its own loop, no longer apply. This page follows Spring AI 2.0.1, which runs on Spring Boot 4.0 or 4.1.

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.ai</groupId>
      <artifactId>spring-ai-bom</artifactId>
      <version>2.0.1</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
<dependencies>
  <dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-model-anthropic</artifactId>
  </dependency>
</dependencies>
```

```yaml
spring:
  ai:
    anthropic:
      api-key: ${ANTHROPIC_API_KEY}
      timeout: 5m
      chat:
        model: claude-opus-5-5
        max-tokens: 16000
    tools:
      limits:
        max-total-tool-calls: 10
```

`timeout` raises the 60-second default, which a long thinking call can exceed; `max-tokens` raises the 4,096 default for the same reason. `max-total-tool-calls` caps tool calls per turn, the Spring AI counterpart of `MAX_STEPS`.

```java
@Component
public class ShopTools {

    private static final Map<String, Double> PRICES_EUR = Map.of("keyboard", 49.0, "monitor", 189.0, "mouse", 25.0);

    public record OrderLine(double unitPrice, int quantity) {}

    @Tool(description = "Return the unit price in EUR of one product in the shop catalogue. Call it once per product the user names.")
    public double lookupPrice(@ToolParam(description = "Product name, singular and lowercase, e.g. 'keyboard'") String product) {
        Double price = PRICES_EUR.get(product);
        if (price == null) {
            throw new IllegalArgumentException("Unknown product '" + product + "'. Known products: " + PRICES_EUR.keySet());
        }
        return price;
    }

    @Tool(description = "Compute an order total in EUR from unit prices and quantities, after an optional percentage discount. Use it for every total; never do the arithmetic yourself.")
    public String orderTotal(List<OrderLine> lines,
            @ToolParam(description = "Discount from 0 to 100", required = false) Double discountPercent) {
        double subtotal = lines.stream().mapToDouble(line -> line.unitPrice() * line.quantity()).sum();
        double discount = discountPercent == null ? 0 : discountPercent;
        return String.format("%.2f", subtotal * (1 - discount / 100));
    }
}
```

```java
@SpringBootApplication
public class ShopAgentApplication {

    public static void main(String[] args) {
        SpringApplication.run(ShopAgentApplication.class, args);
    }

    @Bean
    CommandLineRunner askOnce(ChatClient.Builder chatClientBuilder, ShopTools shopTools) {
        return args -> {
            ChatClient chatClient = chatClientBuilder
                .defaultSystem("You are a shop assistant. Answer price questions with the tools.")
                .defaultTools(shopTools)
                .build();
            String answer = chatClient.prompt()
                .user("What do 3 keyboards and 2 monitors cost with 20% off?")
                .call()
                .content();
            System.out.println(answer);
        };
    }
}
```

The annotations live in `org.springframework.ai.tool.annotation` (`Tool`, `ToolParam`); `ChatClient` is in `org.springframework.ai.chat.client`. Spring AI builds each tool's JSON Schema from the method signature. For `orderTotal` it generates the schema below: the record becomes a nested object, `required = false` drops `discountPercent` from `required`, and `additionalProperties: false` rejects any argument the schema does not list.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "lines": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "quantity": { "type": "integer", "format": "int32" },
          "unitPrice": { "type": "number", "format": "double" }
        },
        "required": ["quantity", "unitPrice"],
        "additionalProperties": false
      }
    },
    "discountPercent": { "type": "number", "description": "Discount from 0 to 100" }
  },
  "required": ["lines"],
  "additionalProperties": false
}
```

The property names come from the Java parameter names, which exist at runtime only when the code is compiled with `-parameters`. The Spring Boot parent POM turns that on; without it the model sees `arg0` and `arg1`.

How the hand-built pieces map to Spring AI:

| Hand-built | Spring AI 2.0 |
|---|---|
| `TOOLS` JSON | `@Tool` and `@ToolParam` on methods; the schema is generated |
| the `for` loop over `stop_reason` | `ToolCallingAdvisor`, auto-registered by `ChatClient` |
| `run_tool` with `is_error` | `ToolCallingManager` runs the method; a `RuntimeException`'s message goes back to the model as the result |
| `MAX_STEPS` | `spring.ai.tools.limits.*`: per turn, at most 40 calls per tool and 150 in total by default |
| the `messages` list | the advisor's in-loop history; chat memory across turns is separate (G5.2) |

Sources: [Claude API — Tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) · [Claude API — Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls) · [Claude API — Parallel tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use) · [Claude API — Steering thinking (thinking and max_tokens, passing blocks back)](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost) · [Yao et al., ReAct](https://arxiv.org/abs/2210.03629) · [Anthropic Python SDK](https://github.com/anthropics/anthropic-sdk-python) · [Spring AI — Tool Calling](https://docs.spring.io/spring-ai/reference/api/tools.html) · [Spring AI — ToolCallingAdvisor](https://docs.spring.io/spring-ai/reference/api/tools/tool-calling-advisor.html) · [Spring AI — Anthropic Chat (properties and defaults)](https://docs.spring.io/spring-ai/reference/api/chat/anthropic-chat.html) · [Spring AI — Getting Started (Boot versions)](https://docs.spring.io/spring-ai/reference/getting-started.html) · [Spring Boot Maven plugin — parent POM features](https://docs.spring.io/spring-boot/maven-plugin/using.html)
