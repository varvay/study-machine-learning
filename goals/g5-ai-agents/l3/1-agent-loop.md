---
title: Planning, stopping, and long loops
---

ReAct (L1) decides one step at a time: think, call a tool, read the result, repeat. That is flexible, and it has three costs: every step is a model call that re-reads the whole history, the agent never commits to a plan it can be held to, and nothing in the pattern tells it when to stop. The patterns below each fix one of these.

**Plan-and-execute** — a planner call writes the whole plan as a list of steps up front; an executor runs the steps; a replanner is called only when a step fails or a result contradicts the plan. The executor can be a cheaper model or plain code, because the hard reasoning happened once.

- **Plan-and-Solve** (Wang et al., 2023) is the prompting form: one call is told to devise a plan first, then carry it out step by step.
- **ReWOO** (Xu et al., 2023) writes the plan with placeholders for tool results (`#E1`, `#E2`), runs the tools without feeding each result back into reasoning, and calls the model once more to combine them. It reports 5× fewer tokens and 4% better accuracy on HotpotQA, a benchmark of questions that each need facts from two Wikipedia articles.
- **LLMCompiler** (Kim et al., 2023) writes the plan as a dependency graph, so tool calls that do not depend on each other run in parallel.

| | ReAct | Plan-and-execute |
|---|---|---|
| Model calls | one per step | one to plan, one to combine, plus replans |
| Adapts to a surprising result | at once | only through a replan |
| Parallel tool calls | only within one step | whenever the plan's graph allows |
| Auditable before acting | no | yes: the plan can be shown to a person and approved (G5.3) |
| Fits | exploration, where each result decides the next step (debugging, research) | tasks whose steps are known once the goal is read (reports, bulk updates) |

**Reflection** — the agent critiques its own output or trajectory, then tries again with the critique in its context.

- **Self-Refine** (Madaan et al., 2023) loops within one task: draft, critique, revise, with one model playing all three roles.
- **Reflexion** (Shinn et al., 2023) works across attempts: after a failed trial, the agent writes a short lesson into an episodic memory (G5.2) and reads it on the next trial. It reports 91% pass@1 on HumanEval, a benchmark of Python functions checked by unit tests, where GPT-4 alone scored 80%.

Reflection is only as good as its feedback signal. Its gains come from an external check: failing tests, a schema validator, a tool error. Without one, a model critiquing its own reasoning often fails to fix it and sometimes makes a right answer wrong (Huang et al., 2023). So give the critic something to check against, or use a different model or rubric as the evaluator (the evaluator-optimizer pattern, G5.3 L2).

**Stopping conditions** — the rules that end a loop. "Stop when the model stops calling tools" is the only built-in one, and it fails when the model loops. A production loop needs several, checked by code on every step:

- **Success** — a check passes: tests green, output validates, the target record exists. Stronger than the model saying it is done.
- **Final-answer tool** — the model ends by calling a `submit_result` tool whose schema forces a structured answer, so "done" is an explicit act, not the absence of a tool call.
- **Hard caps** — maximum steps, maximum calls per tool, a token or cost budget, a wall-clock timeout. Spring AI 2.0's `ToolCallingManager` caps calls per tool (`maxCallsPerTool`) and in total (`maxTotalToolCalls`) within a turn, and on a breach either throws or returns an error to the model (`ToolCallLimitBehavior.THROW` or `RETURN_ERROR_RESPONSE`).
- **No progress** — the same tool with the same arguments twice, the same error twice, or no change in the task state over several steps. A cap stops a loop eventually; this stops it early.
- **Escalation** — some conditions end the loop by handing over to a person: low confidence, a policy refusal, a cap reached on a task that matters.

When a cap fires, end cleanly: return what was done, what was not, and why, and save the state so a person or a later run can resume. A loop killed mid-write leaves half-done work that nobody knows about.

**Managing context in long loops.** The model is stateless, so every call re-sends the whole context. With a fixed base B and R tokens added per step, N steps bill N·B + R·N(N−1)/2 input tokens: the cost grows with the square of the loop length. Length also hurts quality: as the context grows, the model recalls what is in it less reliably, which Anthropic calls **context rot** (Chroma, a vector-database company, measured it across 18 models), and facts in the middle of a long context are used worst (Liu et al., "Lost in the Middle"). The walkthrough below shows the growth and one remedy.

The remedies, from lightest to heaviest:

- **Trim at the source** — tools return only what the next decision needs, paginated and truncated (G5.4). Claude Code, Anthropic's coding agent, caps a tool response at 25,000 tokens by default.
- **Tool-result clearing** — replace old tool results with a placeholder once they have been used. Anthropic calls it the safest, lightest form of compaction; its API does it server-side (`clear_tool_uses_20250919`: by default it triggers at 100,000 input tokens and keeps the last 3 tool uses).
- **Compaction** — when the context nears a limit, summarize it and start a new context from the summary. The summary is lossy: what it drops is gone for the rest of the task.
- **Structured notes** — the agent writes progress, decisions, and open questions to a file or table outside the context, and reads them back when needed (G5.2). They survive compaction because they were never in the context.
- **Sub-agents** — a sub-agent works in its own fresh context and returns a short summary, so the lead agent's context holds conclusions, not the search that produced them (G5.3).
- **Just-in-time retrieval** — keep identifiers (a file path, a record id, a query) in the context and load the content only when a step needs it.

**Prompt caching** stores the processed start of a prompt, its prefix, and reuses it when the next call begins with the same text (G3.5 L3). It lowers the price of re-reading, not the length. A cached prefix is read at about a tenth of the normal input price on most Claude models, and the cache covers the prompt in order, tools then system then messages, up to a marked point. Put stable content first and anything that changes after it. Every clearing or compaction changes the prefix and invalidates the cache after that point, so clear in large batches, not a little on every step.

**In an interview**

- *Your agent runs 40 steps and gets slower, costlier, and worse towards the end. Why, and what do you do?* Each step re-sends the whole history, so cost grows with the square of the step count, and recall drops as the context grows (context rot). I would trim tool outputs at the source, clear used tool results, keep progress in structured notes outside the context, and compact near a limit. If the steps are independent, I would give them to sub-agents with fresh contexts.
- *How do you make sure an agent loop terminates?* Code, not the model, enforces the stop: a success check, a final-answer tool, hard caps on steps, tool calls, tokens, and time, and no-progress detection for repeated calls or errors. A cap ends the run cleanly: it saves state, reports what is done and what is not, and escalates tasks that matter to a person.

Sources: [Yao et al., ReAct](https://arxiv.org/abs/2210.03629) · [Wang et al., Plan-and-Solve](https://arxiv.org/abs/2305.04091) · [Xu et al., ReWOO](https://arxiv.org/abs/2305.18323) · [Kim et al., LLMCompiler](https://arxiv.org/abs/2312.04511) · [Madaan et al., Self-Refine](https://arxiv.org/abs/2303.17651) · [Shinn et al., Reflexion](https://arxiv.org/abs/2303.11366) · [Huang et al., LLMs cannot self-correct reasoning yet](https://arxiv.org/abs/2310.01798) · [Spring AI 2.0 — Tool calling](https://docs.spring.io/spring-ai/reference/api/tools.html) · [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) · [Anthropic — Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) · [Chroma — Context rot](https://www.trychroma.com/research/context-rot) · [Liu et al., Lost in the Middle](https://arxiv.org/abs/2307.03172) · [Claude docs — Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) · [Claude docs — Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
