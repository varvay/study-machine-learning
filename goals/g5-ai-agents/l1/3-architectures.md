---
title: Agent architectures
---

LLM systems that use tools come in two shapes, by who decides the steps:

- **Workflow** — LLM calls and tools run along code paths the developer fixed in advance. Invoice processing is a workflow: extract the fields, check the totals, post the record. Every invoice takes the same steps.
- **Agent** — the LLM decides its own steps: which tool to call, in what order, and when it is done (G5.1). A support question such as "why was I charged twice?" suits an agent, because the next step depends on what the last lookup found.

Both are built from the same block, the **augmented LLM**: one LLM with retrieval, tools, and memory. A workflow wires several of them together in code; an agent runs one in a loop.

Agents trade speed and cost for better results on open-ended tasks. Each extra loop turn is another model call, and the path is harder to predict and test. So the usual advice is to start simple: a single LLM call with retrieval first, a workflow when the steps are known, and an agent only when they cannot be known in advance.

Agent systems also differ in how many agents they use:

- **Single agent** — one model in one loop, with all the tools. It is the default: one context, one prompt, and one place to debug.
- **Multi-agent** — several agents, each with its own prompt, tools, and context, that hand work to each other.
- **Orchestrator-worker** — the common multi-agent shape. A central **orchestrator** LLM splits the task into subtasks, hands each to a **worker**, and combines their results into the answer. The orchestrator chooses the subtasks at run time, after it reads the task. Workers can run in parallel, and each keeps its own context, so one worker's search results never crowd out another's.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 292" role="img" aria-labelledby="architectures-title">
<title id="architectures-title">Three shapes side by side: a workflow as a fixed chain of steps, a single agent looping between an LLM and its tools, and an orchestrator handing subtasks to three workers</title>
<text class="table-name" x="132" y="24" text-anchor="middle">workflow</text>
<text class="note" x="132" y="42" text-anchor="middle">the developer fixes the path</text>
<text x="132" y="70" text-anchor="middle">an invoice</text>
<path class="key-link" d="M132,76 L132,92 M127,85 L132,92 L137,85" />
<rect class="fold-test" x="57" y="92" width="150" height="32" rx="8" /><text x="132" y="113" text-anchor="middle">LLM: extract fields</text>
<path class="key-link" d="M132,124 L132,140 M127,133 L132,140 L137,133" />
<rect class="fold-train" x="57" y="140" width="150" height="32" rx="8" /><text x="132" y="161" text-anchor="middle">code: check totals</text>
<path class="key-link" d="M132,172 L132,188 M127,181 L132,188 L137,181" />
<rect class="fold-test" x="57" y="188" width="150" height="32" rx="8" /><text x="132" y="209" text-anchor="middle">LLM: write summary</text>
<path class="key-link" d="M132,220 L132,236 M127,229 L132,236 L137,229" />
<text x="132" y="252" text-anchor="middle">record posted</text>
<text class="note" x="132" y="280" text-anchor="middle">same steps for every input</text>
<text class="table-name" x="377" y="24" text-anchor="middle">single agent</text>
<text class="note" x="377" y="42" text-anchor="middle">the model chooses each step</text>
<text x="377" y="70" text-anchor="middle">“why was I charged twice?”</text>
<path class="key-link" d="M377,76 L377,92 M372,85 L377,92 L382,85" />
<rect class="fold-test" x="317" y="92" width="120" height="40" rx="8" /><text class="table-name" x="377" y="117" text-anchor="middle">LLM</text>
<path class="key-link" d="M352,132 L352,180 M347,173 L352,180 L357,173" />
<path class="key-link" d="M402,180 L402,132 M397,139 L402,132 L407,139" />
<text class="key-tag" x="344" y="160" text-anchor="end">call</text>
<text class="key-tag" x="410" y="160">result</text>
<rect class="fold-train" x="317" y="180" width="120" height="32" rx="8" /><text x="377" y="201" text-anchor="middle">tools</text>
<text class="note" x="377" y="236" text-anchor="middle">call a tool, read the result, repeat</text>
<text class="note" x="377" y="280" text-anchor="middle">stops when it answers in text</text>
<text class="table-name" x="625" y="24" text-anchor="middle">orchestrator-workers</text>
<text class="note" x="625" y="42" text-anchor="middle">the orchestrator splits the task</text>
<text x="625" y="70" text-anchor="middle">“compare EU and US AI rules”</text>
<path class="key-link" d="M625,76 L625,92 M620,85 L625,92 L630,85" />
<rect class="fold-test" x="550" y="92" width="150" height="32" rx="8" /><text class="table-name" x="625" y="113" text-anchor="middle">orchestrator</text>
<path class="key-link" d="M600,124 L552,180" /><path class="key-link" d="M625,124 L625,180" /><path class="key-link" d="M650,124 L698,180" />
<rect class="fold-test" x="520" y="180" width="64" height="32" rx="8" /><text x="552" y="201" text-anchor="middle">worker</text>
<rect class="fold-test" x="593" y="180" width="64" height="32" rx="8" /><text x="625" y="201" text-anchor="middle">worker</text>
<rect class="fold-test" x="666" y="180" width="64" height="32" rx="8" /><text x="698" y="201" text-anchor="middle">worker</text>
<text class="note" x="625" y="236" text-anchor="middle">subtasks out, results back</text>
<text class="note" x="625" y="280" text-anchor="middle">combines the results into the answer</text>
</svg>
</div>
<figcaption>Shaded boxes are LLM calls. In the workflow, code fixes the order; in the agent, the model chooses; in orchestrator-workers, the orchestrator chooses the subtasks and each worker is an agent with its own context.</figcaption>
</figure>

Anthropic's research feature is an orchestrator-worker system: a lead agent sends subagents to search different angles in parallel. On Anthropic's internal research evaluation, a Claude Opus 4 lead with Claude Sonnet 4 subagents (Opus is Anthropic's larger model, Sonnet its mid-size one) beat a single Claude Opus 4 agent by 90.2%. The cost: agents used about 4 times the tokens of a chat, and the multi-agent system about 15 times. Multi-agent fits wide, parallel tasks. It fits poorly when every agent needs the same context or the subtasks depend on each other, as in most coding.

Sources: [Anthropic — Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) · [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
