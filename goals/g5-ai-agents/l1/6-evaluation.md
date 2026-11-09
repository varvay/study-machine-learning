---
title: Evaluating agents
---

**Evaluating an agent** means measuring how often it completes real tasks correctly, and how it gets there. Scoring a single answer (G2.2) compares one output with a reference. An agent needs more, for three reasons:

- **It takes many steps.** The result depends on a chain of tool calls, and a mistake early in the chain carries into every later step. A right answer can follow a bad path, and one bad step can sink an otherwise good run.
- **It changes things.** Success is often a state of the world, not a sentence: a refund record exists, the tests pass, the flight is booked. So the check inspects that state.
- **It varies from run to run.** The model samples its output (it picks each next token at random, weighted by its probability; G3.2 L1), so the same task can succeed once and fail the next time. Each task therefore runs several times.

The terms used for agent evaluation:

- **Task** — one test case: an input plus the criteria for success. "Refund order 1042" might succeed when a refund row exists for order 1042 and no other order changed.
- **Trial** — one attempt at a task. A task gets several trials because runs vary.
- **Trajectory** — the full record of one trial: every model output, tool call, argument, result, and error. It is also called a **transcript** or **trace**.
- **Outcome** — the state of the environment when the trial ends, such as the rows in the refunds table.
- **Grader** — the logic that scores a trial. It can be code that checks the outcome, such as a SQL query for the refund row, or another model that judges the output against a rubric (**LLM-as-judge**, G5.6 L2), or a human.

**Task success rate** is the share of trials whose outcome meets the task's criteria: 42 successes in 50 trials is 84%. It is the headline number of an agent evaluation. Because runs vary, two views of it answer different questions:

- **pass@k** — the chance that at least one of k trials succeeds. It fits when a person can retry or pick the best of several attempts.
- **pass^k** — the chance that all k trials succeed. It fits when every run must work, as with a customer-facing agent. At 84% per trial, and with independent trials, pass^3 is 0.84³ ≈ 59%.

**Trajectory checks** score the path as well as the outcome. They ask whether the agent called a tool it must never call, repeated a step, invented an argument, or took 40 calls for a 5-call task (G5.5). They serve two purposes:

- they explain why a trial failed, which drives error analysis (G2.5);
- they catch a dangerous path that happened to end well, such as a refund issued without the required approval.

Checking that the agent followed one exact sequence of tool calls makes a brittle test, because agents often find valid paths the test's author did not foresee. So grade the outcome for success, and use trajectory checks to flag bad behavior along the way.

Sources: [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
