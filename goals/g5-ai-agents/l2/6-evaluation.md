---
title: Evaluating agents
---

L1 explained why an agent needs more than a single-answer score: it takes many steps, so it can reach the right answer the wrong way, and it can fail differently on each run; the two basic measures are task success rate and checks on the trajectory, the sequence of steps it took (G5.6 L1). The practical pieces: a task test set, the metrics with their formulas, an eval suite in Spring AI 2.0.1 with an LLM judge, results stored in Postgres, and tracing.

**A task test set** is a list of tasks, each with an input and a machine-checkable description of success. Write it as JSONL, one task per line, so it diffs well in Git and can grow one case at a time. Draw tasks from real requests and from past failures; each fixed bug becomes a task that keeps it fixed (G2.5).

```json
{"id": "price-two-products", "input": "What do 3 keyboards and 2 monitors cost with 20% off?", "expectedAnswer": "420.00", "mustCall": ["lookupPrice", "orderTotal"], "mustNotCall": [], "maxToolCalls": 4}
{"id": "unknown-product", "input": "How much is a webcam?", "expectedAnswer": "webcam", "mustCall": ["lookupPrice"], "mustNotCall": ["orderTotal"], "maxToolCalls": 2}
{"id": "single-product", "input": "What do 4 mice cost?", "expectedAnswer": "100", "mustCall": ["lookupPrice", "orderTotal"], "mustNotCall": [], "maxToolCalls": 3}
```

Each task checks three things:

- **Outcome** — did the agent achieve the goal? For a question, the answer contains the expected value; for an action, the database holds the expected state afterwards, which is a stronger check than reading the agent's claim that it succeeded.
- **Trajectory** — did it get there acceptably? The tools it must call, the tools it must not call (a refund tool on a price question), and a ceiling on tool calls that catches loops.
- **Cost and latency** — tokens and seconds per task, recorded on every run, so a change that passes every check but doubles the cost is still visible.

`expectedAnswer` holds a fragment the answer must contain. Keep it to a value the answer cannot avoid, such as the total, since the model phrases everything else differently from run to run; judging the wording is the LLM judge's job, below. The `unknown-product` task shows a trajectory check doing work the answer check cannot: with no price found, calling `orderTotal` would mean the model invented one.

**Metrics.**

- **Task success rate** — tasks passed ÷ tasks run. 18 of 20 tasks passing is 0.90.
- **pass^k** — the probability that an agent succeeds on all k independent attempts at a task, averaged over tasks. It measures reliability: a support agent that solves a case on one run in two is not usable, even though it "can" solve it. Run each task n times and count c successes; the unbiased estimate (one that is right on average over many samples) is pass^k = mean over tasks of C(c, k) / C(n, k), where C(a, b) is the number of ways to choose b items from a, and C(c, k) = 0 when c < k.
- **pass@k** — the probability that at least one of k attempts succeeds: 1 − mean over tasks of C(n − c, k) / C(n, k). It suits settings where a checker can pick the one good attempt, as with code that runs against tests; pass^1 = pass@1 is the plain success rate.

A worked case: one task run n = 4 times with c = 3 successes. pass^1 = C(3, 1) / C(4, 1) = 3/4 = 0.75. pass^2 = C(3, 2) / C(4, 2) = 3/6 = 0.50. pass^4 = C(3, 4) / C(4, 4) = 0/1 = 0: in four runs it never succeeded four times in a row. τ-bench is a benchmark where agents serve simulated customers through tools. The τ-bench paper that introduced pass^k found that even state-of-the-art function-calling agents such as GPT-4o (an OpenAI model) solved fewer than half its tasks, and that pass^8 fell below 25% in its retail domain.

**An eval suite in Spring AI.** An advisor inside the tool loop records the trajectory: it sees each model reply and collects the names of the tools the model called. It runs inside the loop because its order is higher than `ToolCallingAdvisor`'s (G5.5).

```java
public class TrajectoryRecorder implements CallAdvisor {

    public static final String TRAJECTORY = "trajectory";

    @Override
    public String getName() {
        return "TrajectoryRecorder";
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 400;
    }

    @Override
    @SuppressWarnings("unchecked")
    public ChatClientResponse adviseCall(ChatClientRequest request, CallAdvisorChain chain) {
        ChatClientResponse response = chain.nextCall(request);
        List<String> trajectory = (List<String>) request.context().get(TRAJECTORY);
        if (trajectory != null && response.chatResponse() != null) {
            response.chatResponse().getResult().getOutput().getToolCalls().stream()
                .map(AssistantMessage.ToolCall::name)
                .forEach(trajectory::add);
        }
        return response;
    }
}
```

A JUnit parameterized test runs every task in `src/test/resources/agent-tasks.jsonl` against the real model, with the shop agent of G5.1:

```java
@SpringBootTest
class AgentEvalTest {

    record AgentTask(String id, String input, String expectedAnswer, List<String> mustCall, List<String> mustNotCall, int maxToolCalls) {}

    record Verdict(String reasoning, int score) {}

    static final String RUBRIC = """
            You grade a shop assistant's answer to a price question. Score 1 to 4:
            4 = correct and complete: every price and total is right, any discount is stated, unknown products are named as unknown;
            3 = correct, with a minor omission;
            2 = a wrong number, or an invented product or price;
            1 = no usable answer.
            Write your reasoning first, then the score.""";

    @Autowired ChatClient.Builder chatClientBuilder;
    @Autowired ShopTools shopTools;

    static Stream<AgentTask> tasks() throws IOException {
        JsonMapper json = JsonMapper.builder().build();
        return Files.readAllLines(Path.of("src/test/resources/agent-tasks.jsonl")).stream()
            .map(line -> json.readValue(line, AgentTask.class));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("tasks")
    void agentSolvesTask(AgentTask task) {
        List<String> trajectory = new ArrayList<>();
        ChatClient agent = chatClientBuilder.clone()
            .defaultTools(shopTools)
            .defaultAdvisors(new TrajectoryRecorder())
            .build();

        String answer = agent.prompt()
            .user(task.input())
            .advisors(advisor -> advisor.param(TrajectoryRecorder.TRAJECTORY, trajectory))
            .call()
            .content();

        assertThat(answer).contains(task.expectedAnswer());
        assertThat(trajectory).containsAll(task.mustCall()).doesNotContainAnyElementsOf(task.mustNotCall());
        assertThat(trajectory).hasSizeLessThanOrEqualTo(task.maxToolCalls());

        Verdict verdict = chatClientBuilder.clone().build().prompt()
            .system(RUBRIC)
            .user("Question: " + task.input() + "\n\nAnswer: " + answer)
            .call()
            .entity(Verdict.class);
        assertThat(verdict.score()).as(verdict.reasoning()).isGreaterThanOrEqualTo(3);
    }
}
```

- **`chatClientBuilder.clone()`** gives each agent and the judge their own builder, so the tools and advisors added for one do not leak into the other.
- **`JsonMapper`** is Jackson 3 (`tools.jackson.databind.json`), the version Spring Boot 4 uses.
- **The order of checks** puts the cheap, exact ones first; the judge runs only when they pass.
- **Real model calls cost money** and vary between runs, so keep this suite out of the unit-test run: tag it (JUnit `@Tag("eval")`) and run it on demand or nightly, n times per task when measuring pass^k.

**LLM-as-judge** is scoring an answer with a second model call that applies a written rubric. It measures qualities no string match can, such as whether an answer is complete, grounded (supported by its sources), or polite. Rules that make a judge usable:

- **Anchor every score.** Each level of the scale says what earns it, as in `RUBRIC` above; "rate from 1 to 10" alone gives unstable numbers.
- **Reasoning before the score.** The record lists `reasoning` first, so the model writes its justification before it commits to a number, and a failed assertion shows why.
- **Structured output.** `entity(Verdict.class)` parses the verdict, so a chatty judge cannot break the test.
- **Check the judge.** Before trusting it, score a sample of answers by hand and compare; the calibration methods are L3.

Spring AI also ships judges of its own behind one interface, `Evaluator`, whose `evaluate(EvaluationRequest)` returns an `EvaluationResponse` with `isPass()`. The request holds the user's question, the context the answer was based on, and the answer. `RelevancyEvaluator` asks whether the answer is in line with the retrieved context; `FactCheckingEvaluator` asks whether the context supports the answer's claims. Both live in `org.springframework.ai.chat.evaluation`, take a `ChatClient.Builder` for the judge model, and suit the RAG side of the capstone:

```java
EvaluationRequest request = new EvaluationRequest(question, retrievedDocuments, answer);
EvaluationResponse relevancy = new RelevancyEvaluator(ChatClient.builder(judgeModel)).evaluate(request);
assertThat(relevancy.isPass()).isTrue();
```

**Storing results.** One row per task attempt in the capstone's `eval_runs` table (G1.8) turns every eval into data that SQL can compare across models, prompts, and dates:

```sql
CREATE TABLE eval_runs (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_label        text NOT NULL,
    model            text NOT NULL,
    dataset_version  text NOT NULL,
    task_id          text NOT NULL,
    trial            int NOT NULL,
    passed           boolean NOT NULL,
    tool_calls       int NOT NULL,
    total_tokens     int NOT NULL,
    judge_score      int,
    trace_id         text,
    created_at       timestamptz NOT NULL DEFAULT now()
);
```

`run_label` names what was evaluated, such as a Git commit plus the model; `dataset_version` keeps scores comparable only across the same tasks; `trace_id` links the attempt to its trace for debugging. Success rate and pass^2 per run label, with C(c, 2) / C(n, 2) = c(c − 1) / (n(n − 1)):

```sql
WITH per_task AS (
    SELECT run_label, task_id, count(*) AS n, count(*) FILTER (WHERE passed) AS c
    FROM eval_runs
    WHERE dataset_version = 'v3'
    GROUP BY run_label, task_id
)
SELECT run_label,
       round(avg(c::numeric / n), 3) AS pass_1,
       round(avg(CASE WHEN n >= 2 THEN c * (c - 1)::numeric / (n * (n - 1)) END), 3) AS pass_hat_2
FROM per_task
GROUP BY run_label;
```

For two tasks run four times each, one passing 3 of 4 and one 4 of 4, it returns pass_1 = 0.875 and pass_hat_2 = (0.5 + 1) / 2 = 0.750.

**Tracing.** A **trace** is the record of one request, made of **spans**, one per step, each with a start, an end, and attributes such as the model name and token counts. For an agent, the trace is the trajectory with timings: which model call took 8 seconds, which tool failed, where the tokens went. Spring AI emits Micrometer observations that become OpenTelemetry spans. Micrometer is the instrumentation library Spring uses to time and tag operations; OpenTelemetry is the open standard for traces and metrics that most tracing tools accept (G6.6).

| Observation | Recorded for |
|---|---|
| `spring.ai.chat.client` | each `ChatClient` call, with the advisors, tool names, and conversation id |
| `spring.ai.advisor` | each advisor's execution |
| `gen_ai.client.operation` | each model call, with `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` |
| `spring.ai.tool` | each tool call, with its name and duration |

Prompts, completions, and tool arguments can contain personal data, so they stay out of spans unless switched on: `spring.ai.chat.observations.log-prompt`, `spring.ai.chat.observations.log-completion`, and `spring.ai.tools.observations.include-content`.

Three tracing platforms receive these traces:

| Platform | What it is | Fits when |
|---|---|---|
| Langfuse | open-source (self-hostable) or cloud; traces, prompt management, datasets, and LLM-as-judge evaluators; receives OpenTelemetry at `/api/public/otel` | any stack, including Spring AI; the capstone's choice |
| LangSmith | LangChain's platform for tracing, datasets, and evaluation | apps built on LangChain or LangGraph |
| Arize Phoenix | open-source; built on OpenTelemetry and OpenInference instrumentation (Arize's OpenTelemetry conventions for LLM spans); tracing, evals, experiments | self-hosted observability with evals |

Langfuse for the Spring AI agent, following its integration guide: add `spring-boot-starter-actuator`, `micrometer-tracing-bridge-otel`, `opentelemetry-exporter-otlp`, and `opentelemetry-spring-boot-starter`, then point the OTLP exporter, which sends spans in OpenTelemetry's wire protocol, at Langfuse with the project's keys:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://cloud.langfuse.com/api/public/otel"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(echo -n 'pk-lf-…:sk-lf-…' | base64),x-langfuse-ingestion-version=4"
```

```yaml
spring:
  ai:
    chat:
      observations:
        log-prompt: true
        log-completion: true
management:
  tracing:
    sampling:
      probability: 1.0
```

The endpoint shown is Langfuse Cloud's EU region; a self-hosted Langfuse uses `http://localhost:3000/api/public/otel`. The guide also adds a small observation filter bean that copies the prompt and completion into span attributes, without which Langfuse shows the spans but not the text; copy it from the guide. A sampling probability of 1.0 traces every request, right for development and eval runs; production usually samples less.

Sources: [Yao et al., τ-bench (pass^k)](https://arxiv.org/abs/2406.12045) · [Spring AI — Evaluation Testing](https://docs.spring.io/spring-ai/reference/api/testing.html) · [Spring AI — LLM-as-a-Judge guide](https://docs.spring.io/spring-ai/reference/guides/llm-as-judge.html) · [Spring AI — Observability](https://docs.spring.io/spring-ai/reference/observability/index.html) · [Spring AI — ToolCallingAdvisor (observing the loop)](https://docs.spring.io/spring-ai/reference/api/tools/tool-calling-advisor.html) · [Langfuse — Spring AI integration](https://langfuse.com/integrations/frameworks/spring-ai) · [Langfuse — OpenTelemetry endpoint](https://langfuse.com/integrations/native/opentelemetry) · [Langfuse — LLM-as-a-judge](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge) · [Langfuse — Datasets](https://langfuse.com/docs/evaluation/experiments/datasets) · [LangSmith docs](https://docs.langchain.com/langsmith) · [Arize Phoenix docs](https://arize.com/docs/phoenix)
