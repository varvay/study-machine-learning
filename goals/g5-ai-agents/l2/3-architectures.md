---
title: Agent architectures
---

L1 set the axis: a workflow follows paths fixed in code, an agent lets the model choose its next step, and a multi-agent system splits the work across several of them, for example an orchestrator handing subtasks to workers (G5.3 L1). In practice that means the five workflow patterns from Anthropic's *Building effective agents*, each in Spring AI, then the frameworks that package them.

The article's building block is the **augmented LLM**: one model call with access to retrieval (G1.7), tools (G5.4), and memory (G5.2). Every pattern below wires several of those calls together. The article defines the two families this way:

- **Workflow** — LLMs and tools orchestrated through predefined code paths.
- **Agent** — an LLM that dynamically directs its own process and tool use: the loop of G5.1.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 510" role="img" aria-labelledby="architectures-patterns-title">
<title id="architectures-patterns-title">The five workflow patterns: prompt chaining, routing, parallelization, orchestrator-workers, and evaluator-optimizer, each drawn as a small flow from input to output</title>
<text class="table-name" x="20" y="46">Prompt chaining</text><text class="note" x="20" y="64">fixed steps, gate between</text>
<text class="note" x="182" y="54">in</text><path class="key-link" d="M200,50 L230,50" />
<rect class="fold-train" x="230" y="35" width="80" height="30" rx="6" /><text x="270" y="54" text-anchor="middle">LLM 1</text>
<path class="key-link" d="M310,50 L335,50" />
<rect class="fold-test" x="335" y="35" width="60" height="30" rx="6" /><text x="365" y="54" text-anchor="middle">gate</text>
<path class="key-link" d="M395,50 L420,50" />
<rect class="fold-train" x="420" y="35" width="80" height="30" rx="6" /><text x="460" y="54" text-anchor="middle">LLM 2</text>
<path class="key-link" d="M500,50 L525,50" />
<rect class="fold-train" x="525" y="35" width="80" height="30" rx="6" /><text x="565" y="54" text-anchor="middle">LLM 3</text>
<path class="key-link" d="M605,50 L630,50" /><text class="note" x="638" y="54">out</text>
<text class="table-name" x="20" y="146">Routing</text><text class="note" x="20" y="164">one path per kind of input</text>
<text class="note" x="182" y="154">in</text><path class="key-link" d="M200,150 L230,150" />
<rect class="fold-test" x="230" y="135" width="80" height="30" rx="6" /><text x="270" y="154" text-anchor="middle">router</text>
<path class="key-link" d="M310,150 C330,150 330,125 350,125" /><path class="key-link" d="M310,150 C330,150 330,175 350,175" />
<rect class="fold-train" x="350" y="112" width="90" height="26" rx="6" /><text x="395" y="129" text-anchor="middle">billing</text>
<rect class="fold-train" x="350" y="162" width="90" height="26" rx="6" /><text x="395" y="179" text-anchor="middle">technical</text>
<path class="key-link" d="M440,125 C460,125 460,150 480,150" /><path class="key-link" d="M440,175 C460,175 460,150 480,150" />
<text class="note" x="488" y="154">out</text>
<text class="table-name" x="20" y="246">Parallelization</text><text class="note" x="20" y="264">sectioning or voting</text>
<text class="note" x="182" y="254">in</text>
<path class="key-link" d="M200,250 C220,250 220,222 240,222" /><path class="key-link" d="M200,250 L240,250" /><path class="key-link" d="M200,250 C220,250 220,278 240,278" />
<rect class="fold-train" x="240" y="210" width="80" height="24" rx="6" /><text x="280" y="226" text-anchor="middle">LLM</text>
<rect class="fold-train" x="240" y="238" width="80" height="24" rx="6" /><text x="280" y="254" text-anchor="middle">LLM</text>
<rect class="fold-train" x="240" y="266" width="80" height="24" rx="6" /><text x="280" y="282" text-anchor="middle">LLM</text>
<path class="key-link" d="M320,222 C335,222 335,250 350,250" /><path class="key-link" d="M320,250 L350,250" /><path class="key-link" d="M320,278 C335,278 335,250 350,250" />
<rect class="fold-test" x="350" y="235" width="100" height="30" rx="6" /><text x="400" y="254" text-anchor="middle">aggregate</text>
<path class="key-link" d="M450,250 L475,250" /><text class="note" x="483" y="254">out</text>
<text class="table-name" x="20" y="351">Orchestrator-workers</text><text class="note" x="20" y="369">subtasks chosen at run time</text>
<text class="note" x="182" y="359">in</text><path class="key-link" d="M200,355 L230,355" />
<rect class="fold-test" x="230" y="340" width="100" height="30" rx="6" /><text x="280" y="359" text-anchor="middle">orchestrator</text>
<path class="key-link" d="M330,355 C345,355 345,327 360,327" /><path class="key-link" d="M330,355 L360,355" /><path class="key-link" d="M330,355 C345,355 345,383 360,383" />
<rect class="fold-train" x="360" y="315" width="80" height="24" rx="6" /><text x="400" y="331" text-anchor="middle">worker</text>
<rect class="fold-train" x="360" y="343" width="80" height="24" rx="6" /><text x="400" y="359" text-anchor="middle">worker</text>
<rect class="fold-train" x="360" y="371" width="80" height="24" rx="6" /><text x="400" y="387" text-anchor="middle">worker</text>
<path class="key-link" d="M440,327 C455,327 455,355 470,355" /><path class="key-link" d="M440,355 L470,355" /><path class="key-link" d="M440,383 C455,383 455,355 470,355" />
<rect class="fold-test" x="470" y="340" width="100" height="30" rx="6" /><text x="520" y="359" text-anchor="middle">synthesize</text>
<path class="key-link" d="M570,355 L595,355" /><text class="note" x="603" y="359">out</text>
<text class="table-name" x="20" y="456">Evaluator-optimizer</text><text class="note" x="20" y="474">loop until it passes</text>
<text class="note" x="182" y="464">in</text><path class="key-link" d="M200,460 L230,460" />
<rect class="fold-train" x="230" y="445" width="100" height="30" rx="6" /><text x="280" y="464" text-anchor="middle">generator</text>
<path class="key-link" d="M330,452 C355,436 375,436 400,452" /><text class="note" x="365" y="432" text-anchor="middle">draft</text>
<path class="key-link" d="M400,468 C375,484 355,484 330,468" /><text class="note" x="365" y="499" text-anchor="middle">feedback</text>
<rect class="fold-test" x="400" y="445" width="100" height="30" rx="6" /><text x="450" y="464" text-anchor="middle">evaluator</text>
<path class="key-link" d="M500,460 L525,460" /><text class="note" x="533" y="464">pass: out</text>
</svg>
</div>
<figcaption>The five workflow patterns. Plain boxes are LLM calls; shaded boxes decide the flow, by code (gate, aggregate) or by another LLM call (router, orchestrator, evaluator). In an agent, a single loop replaces these fixed paths.</figcaption>
</figure>

The code below shares one helper, a single augmented-LLM call:

```java
String ask(String system, String user) {
    return chatClient.prompt().system(system).user(user).call().content();
}
```

**Prompt chaining** — a sequence of LLM calls where each one processes the previous one's output; code between the steps can check the output and stop early (a **gate**). Use it when the task splits cleanly into fixed subtasks; it trades latency for accuracy, because each call does an easier job. Example: extract the changes from a diff, write release notes, translate them.

```java
String releaseNotes(String diff) {
    String changes = ask("List the user-visible changes in this diff, one per line.", diff);
    if (changes.isBlank()) {
        return "No user-visible changes.";
    }
    String draft = ask("Write release notes for these changes, grouped by feature.", changes);
    return ask("Translate these release notes into German.", draft);
}
```

**Routing** — one LLM call classifies the input, and code sends it to a specialised prompt, model, or tool set. Use it when inputs fall into distinct categories that are better handled separately, and the classification is reliable. A router can also send easy questions to a small, cheap model and hard ones to a large one. `entity(...)` is Spring AI's structured output (G3.5): the reply is parsed into the record, and the enum limits the answer to the three routes.

```java
enum Route { BILLING, TECHNICAL, GENERAL }

record Classification(Route route) {}

String answerTicket(String ticket) {
    Route route = chatClient.prompt()
        .system("Classify the support ticket.")
        .user(ticket)
        .call()
        .entity(Classification.class)
        .route();
    String specialist = switch (route) {
        case BILLING -> "You are a billing specialist. Refunds need an order id.";
        case TECHNICAL -> "You are a support engineer. Ask for logs before guessing.";
        case GENERAL -> "You are a friendly customer service agent.";
    };
    return ask(specialist, ticket);
}
```

**Parallelization** — several LLM calls run at the same time, and code combines their outputs. It has two variants: **sectioning** splits the task into independent parts, and **voting** runs the same task several times and takes the majority or the strictest result. Use it when the parts are independent and speed matters, or when several perspectives make the answer more reliable. Virtual threads, Java's lightweight threads that cost little while blocked, suit calls that mostly wait on the network.

```java
String reviewCode(String code) {
    List<String> reviewers = List.of(
        "Review only for security flaws.",
        "Review only for performance problems.",
        "Review only for readability.");
    try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
        List<CompletableFuture<String>> reviews = reviewers.stream()
            .map(focus -> CompletableFuture.supplyAsync(() -> ask(focus, code), executor))
            .toList();
        return reviews.stream().map(CompletableFuture::join).collect(Collectors.joining("\n\n"));
    }
}
```

**Orchestrator-workers** — an orchestrator LLM breaks the task into subtasks at run time, worker LLM calls handle them, and a final call synthesizes the results. It differs from parallelization in who decides the split: here the model does, because the subtasks cannot be predicted in advance. Example: a coding change that touches an unknown number of files. This is the smallest multi-agent system: the workers are separate calls with their own prompts and context.

```java
record Subtask(String title, String instructions) {}

record Plan(List<Subtask> subtasks) {}

String writeDocs(String endpointSpec) {
    Plan plan = chatClient.prompt()
        .system("Split the documentation job into 2 to 4 independent subtasks.")
        .user(endpointSpec)
        .call()
        .entity(Plan.class);
    try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
        List<CompletableFuture<String>> sections = plan.subtasks().stream()
            .map(subtask -> CompletableFuture.supplyAsync(() -> ask(subtask.instructions(), endpointSpec), executor))
            .toList();
        String drafts = sections.stream().map(CompletableFuture::join).collect(Collectors.joining("\n\n---\n\n"));
        return ask("Merge these sections into one coherent document.", drafts);
    }
}
```

**Evaluator-optimizer** — one LLM call generates a response, a second evaluates it against criteria and returns feedback, and the loop repeats until the evaluation passes or a round limit is hit. Use it when there are clear evaluation criteria and a revision measurably improves the result, as when a human editor's feedback would. The round limit matters: without it, an evaluator that never passes loops forever (G5.5).

```java
record Evaluation(boolean pass, String feedback) {}

String writeWithReview(String task) {
    String draft = ask("Write Java code for the task.", task);
    for (int round = 1; round <= 3; round++) {
        Evaluation evaluation = chatClient.prompt()
            .system("Check the code against the task: correctness, thread safety, tests. Pass only if all hold.")
            .user("Task: " + task + "\n\nCode:\n" + draft)
            .call()
            .entity(Evaluation.class);
        if (evaluation.pass()) {
            return draft;
        }
        draft = ask("Revise the code to address the feedback.", "Task: " + task + "\n\nCode:\n" + draft + "\n\nFeedback:\n" + evaluation.feedback());
    }
    return draft;
}
```

**Agents**, by the same article, fit open-ended problems where the number of steps cannot be predicted; they trade latency and cost for better task performance, so the trade must be worth it. Its advice is to start with the simplest pattern that works and add agency only when a fixed path demonstrably fails. The patterns also combine: a router can send one category of input to an agent and the rest to a chain.

**Frameworks.** A framework packages the loop, state, and wiring so each project does not rebuild them. The article's caution: frameworks can hide the prompts and responses underneath, so start with the model API directly (G5.1) and adopt a framework once you know what it does for you.

| Framework | Language | Core abstraction | Fits when |
|---|---|---|---|
| Spring AI 2.0 | Java | `ChatClient` with advisors, `@Tool`, structured output; the patterns above are plain Java over them | the app is Spring Boot; the capstone's choice |
| LangGraph 1.x | Python, JS | a `StateGraph`: nodes are functions, edges (fixed or conditional) decide what runs next, over a shared state | explicit control of an agent's flow, with loops and branches |
| CrewAI 1.x | Python | `Agent`s with a role, goal, and backstory; `Task`s; a `Crew` that runs them in a `Process` (sequential, or hierarchical with a manager) | role-based multi-agent teams, set up quickly |
| AutoGen 0.7 | Python | conversable agents that exchange messages | legacy code only: it is in maintenance mode, and Microsoft names Microsoft Agent Framework as its successor |

The G5.1 loop as a LangGraph graph, condensed from its quickstart (`model_with_tools`, the tools, and the state class are defined there):

```python
from langchain.messages import ToolMessage
from langgraph.graph import StateGraph, START, END

def llm_call(state):
    return {"messages": [model_with_tools.invoke(state["messages"])]}

def tool_node(state):
    results = []
    for call in state["messages"][-1].tool_calls:
        observation = tools_by_name[call["name"]].invoke(call["args"])
        results.append(ToolMessage(content=observation, tool_call_id=call["id"]))
    return {"messages": results}

def should_continue(state):
    return "tool_node" if state["messages"][-1].tool_calls else END

builder = StateGraph(MessagesState)
builder.add_node("llm_call", llm_call)
builder.add_node("tool_node", tool_node)
builder.add_edge(START, "llm_call")
builder.add_conditional_edges("llm_call", should_continue, ["tool_node", END])
builder.add_edge("tool_node", "llm_call")
agent = builder.compile()
```

The conditional edge is the `stop_reason` check of G5.1, and the edge back from `tool_node` is the loop. For a ready-made agent LangChain 1.x, the LLM-app library from the same team, offers `create_agent(model=..., tools=...)` from `langchain.agents`.

A CrewAI crew for comparison, where roles replace graph edges:

```python
from crewai import Agent, Crew, Process, Task

analyst = Agent(role="Data Analyst", goal="Analyze data trends in the market", backstory="An experienced analyst with a background in economics")
writer = Agent(role="Report Writer", goal="Turn analysis into a short report", backstory="A writer who explains numbers plainly")
research = Task(description="Collect recent market data and identify trends.", expected_output="A list of trends with evidence.", agent=analyst)
report = Task(description="Write a one-page report from the trends.", expected_output="A one-page report.", agent=writer)

crew = Crew(agents=[analyst, writer], tasks=[research, report], process=Process.sequential)
result = crew.kickoff()
```

Versions on PyPI, the Python package index, as of 2026-10-01: `langgraph` 1.2.12, `langchain` 1.4.3, `crewai` 1.15.23, `autogen-agentchat` 0.7.5, `agent-framework` 1.19.0.

Sources: [Anthropic — Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) · [Spring AI — Building Effective Agents](https://docs.spring.io/spring-ai/reference/api/effective-agents.html) · [spring-ai-examples — agentic-patterns](https://github.com/spring-projects/spring-ai-examples/tree/main/agentic-patterns) · [LangGraph quickstart](https://docs.langchain.com/oss/python/langgraph/quickstart) · [LangChain — Agents (create_agent)](https://docs.langchain.com/oss/python/langchain/agents) · [CrewAI — Crews](https://docs.crewai.com/en/concepts/crews) · [AutoGen README (maintenance mode)](https://github.com/microsoft/autogen) · [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) · PyPI: [langgraph](https://pypi.org/project/langgraph/), [langchain](https://pypi.org/project/langchain/), [crewai](https://pypi.org/project/crewai/), [autogen-agentchat](https://pypi.org/project/autogen-agentchat/), [agent-framework](https://pypi.org/project/agent-framework/)
