---
title: Choosing and defending an architecture
---

L1 separated workflows from agents; L2 named the patterns between them. This level is the decision: how much autonomy a client's process should get, where people stay in the loop, and how to defend that choice when an interviewer pushes on it.

**When a fixed workflow beats an agent.** A **workflow** runs LLM calls and tools along paths written in code; an **agent** lets the model choose its own path and tools (Anthropic's definitions). Anthropic's advice is to find the simplest solution that works, which "might mean not building agentic systems at all". The deciding questions:

| Question | Points to a workflow | Points to an agent |
|---|---|---|
| Can the steps be listed in advance? | yes, the path is known | no, each result decides the next step |
| What does a wrong action cost? | money, customers, compliance | a retry |
| Must an auditor predict the behavior? | yes | no |
| Volume and latency budget? | high volume, tight budget | low volume, minutes are fine |
| Can a run be checked automatically? | each step has a clear check | only the end result can be judged |

Reliability is the hidden cost of autonomy. If each step succeeds 95% of the time and a run needs 10 of them, a run succeeds about 0.95¹⁰ ≈ 60% of the time. Consistency is worse than the average suggests: on τ-bench, the best function-calling agents solved under 50% of tasks, and in the retail domain fewer than 25% of tasks were solved in all 8 of 8 trials (pass^8, G5.6). A workflow fixes the path, so only the LLM steps inside it vary.

The usual answer for a client is a **hybrid**: a workflow skeleton for the known path, with a bounded agent as one step for the part that is genuinely open-ended, such as handling exceptions.

**The coordination cost of multi-agent systems.** A multi-agent system splits the work between agents with their own contexts, usually an orchestrator and workers. Anthropic's research system shows both sides:

- **The gain** — an Opus 4 lead with Sonnet 4 workers beat a single Opus 4 agent by 90.2% on their research eval. Research is breadth-first: many independent searches, each filling its own context, run in parallel.
- **The bill** — agents used about 4 times the tokens of a chat, and the multi-agent system about 15 times. Token usage alone explained 80% of the performance variance on BrowseComp, a benchmark of hard-to-find facts on the web.
- **The poor fits** — tasks where all agents need the same context, or with many dependencies between agents, and most coding.

Where the cost comes from:

- **Lossy handoffs** — a worker sees only the task description the orchestrator wrote, not the conversation behind it. The rule of Cognition, the company behind the Devin coding agent: share full agent traces, not just messages.
- **Conflicting decisions** — "actions carry implicit decisions": two workers building parts of one game chose clashing styles, and the parts could not be merged (Cognition's Flappy Bird example).
- **New failure modes** — the MAST study (Multi-Agent System failure Taxonomy) of 1,600+ traces from 7 frameworks sorts multi-agent failures into three categories: system design issues, inter-agent misalignment, and task verification.
- **Harder debugging and evaluation** — non-determinism compounds across agents, and a failure's cause can sit in another agent's context.

When multi-agent is justified, contain the cost: the orchestrator owns the plan and every final decision; workers get a precise brief (objective, output format, boundaries, tool and token budget); workers are read-only and the writes stay in one place; results land in a shared store rather than being retold through chat.

**Human-in-the-loop checkpoints.** A checkpoint pauses the run until a person approves, edits, or rejects what the agent proposes. Place them:

- before **irreversible or external effects**: payments, emails to customers, deletes, production changes;
- at **low confidence**: a validator failed, an amount is above a limit, the case is unlike the eval set;
- at **plan approval**: approve a plan-and-execute plan once (G5.1), instead of every step;
- at **policy refusals and caps** (G5.1, G5.5).

What makes a checkpoint work:

- **Show the decision, not the transcript** — the exact action and arguments, the evidence, and what differs from normal (a new bank account, a duplicate invoice number).
- **Durable pause** — the run's state is saved so an approval hours later resumes it. Anthropic's research system resumes from checkpoints instead of restarting after failures.
- **Timeouts and fallbacks** — an unanswered approval escalates or expires; it never auto-approves.
- **Measure and graduate** — track approval and override rates per kind of action; a class approved nearly 100% of the time over months becomes a candidate for automatic approval with sampled audits.
- **Guard against approval fatigue** — a reviewer who approves hundreds of items a day stops reading. Keep approvals rare, and move every check that can be code into code (G5.5).

The mechanics exist in the stack: Spring AI 2.0 lets you drive the tool loop yourself, and names "gating tool execution on an external approval step" as the reason to; the MCP specification says a human SHOULD always be able to deny a tool call; AgentCore Policy, AWS's rule engine for agent tool calls, can require that an approval was granted before a transfer.

**Worked defense: an agent for accounts payable.** A client, a distributor, says: "We get 3,000 supplier invoices a month by email. Build an agent that processes them."

*1. Clarify before drawing.* Ask for volume and peaks, the systems (email, the ERP or enterprise resource planning system that holds orders, stock, and accounts, the bank), today's error and fraud history, the approval rules, and what "processed" means. Here: invoices arrive as PDFs, are matched to the purchase order (PO) and the goods receipt (a **3-way match**) in the ERP, then paid; about 15% fail matching and wait for a clerk.

*2. Design.*

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 430" role="img" aria-labelledby="architectures-ap-title">
<title id="architectures-ap-title">Invoice processing: a workflow with one LLM extraction step, a bounded exception agent, and a clerk approval before posting</title>
<rect class="fold-train" x="20" y="40" width="165" height="66" rx="8" />
<text class="table-name" x="32" y="64">Supplier email</text>
<text class="key-tag" x="32" y="84">PDF invoice arrives</text>
<rect class="fold-test" x="205" y="40" width="165" height="66" rx="8" />
<text class="table-name" x="217" y="64">Extract fields</text>
<text class="key-tag" x="217" y="84">LLM, structured output</text>
<rect class="fold-train" x="390" y="40" width="165" height="66" rx="8" />
<text class="table-name" x="402" y="64">Validate</text>
<text class="key-tag" x="402" y="84">totals, vendor, duplicate</text>
<rect class="fold-train" x="575" y="40" width="165" height="66" rx="8" />
<text class="table-name" x="587" y="64">3-way match</text>
<text class="key-tag" x="587" y="84">invoice = PO = receipt</text>
<rect class="fold-test" x="390" y="170" width="165" height="66" rx="8" />
<text class="table-name" x="402" y="194">Exception agent</text>
<text class="key-tag" x="402" y="212">LLM, read-only tools,</text>
<text class="key-tag" x="402" y="227">drafts supplier emails</text>
<rect class="dimension-head" x="575" y="170" width="165" height="66" rx="8" />
<rect class="table-outline" x="575" y="170" width="165" height="66" rx="8" />
<text class="table-name" x="587" y="194">AP clerk</text>
<text class="key-tag" x="587" y="214">approve, edit, or reject</text>
<rect class="fold-train" x="575" y="300" width="165" height="66" rx="8" />
<text class="table-name" x="587" y="322">Post to ERP, pay</text>
<text class="key-tag" x="587" y="340">idempotency key,</text>
<text class="key-tag" x="587" y="355">approver above a limit</text>
<path class="key-link" d="M185,73 L205,73" /><path class="key-link" d="M199,69 L205,73 L199,77" />
<path class="key-link" d="M370,73 L390,73" /><path class="key-link" d="M384,69 L390,73 L384,77" />
<path class="key-link" d="M555,73 L575,73" /><path class="key-link" d="M569,69 L575,73 L569,77" />
<path class="key-link" d="M472,106 L472,170" /><path class="key-link" d="M468,164 L472,170 L476,164" />
<text class="note" x="480" y="142">fails</text>
<path class="key-link" d="M610,106 C610,140 530,136 530,170" /><path class="key-link" d="M526,164 L530,170 L534,164" />
<text class="note" x="618" y="136">mismatch</text>
<path class="key-link" d="M555,203 L575,203" /><path class="key-link" d="M569,199 L575,203 L569,207" />
<path class="key-link" d="M657,236 L657,300" /><path class="key-link" d="M653,294 L657,300 L661,294" />
<text class="note" x="665" y="272">approved</text>
<path class="key-link" d="M740,73 L752,73 L752,333 L740,333" /><path class="key-link" d="M746,329 L740,333 L746,337" />
<text class="note" x="746" y="160" text-anchor="end">match</text>
<text class="note" x="20" y="186">Bank-detail changes never pass</text>
<text class="note" x="20" y="203">through the agent: treasury</text>
<text class="note" x="20" y="220">confirms them by phone.</text>
<text class="note" x="20" y="322">Every step writes to the trace</text>
<text class="note" x="20" y="339">and the audit log (G5.5, G5.6).</text>
<rect class="fold-train" x="20" y="398" width="26" height="16" rx="4" />
<text x="54" y="411">code</text>
<rect class="fold-test" x="130" y="398" width="26" height="16" rx="4" />
<text x="164" y="411">LLM step</text>
<rect class="dimension-head" x="260" y="398" width="26" height="16" rx="4" />
<rect class="table-outline" x="260" y="398" width="26" height="16" rx="4" />
<text x="294" y="411">person</text>
</svg>
</div>
<figcaption>The proposed design. Code runs the known path; the model extracts fields and handles exceptions; a clerk approves every exception's resolution, and payments above a limit need an approver.</figcaption>
</figure>

*3. Defend each choice.*

- **Why a workflow, not one agent over the whole process?** The happy path is known and repeats 3,000 times a month, money moves, and auditors must predict the behavior. Code does the matching, posting, and paying: it is cheaper, faster, and gives the same answer every time.
- **Why an LLM for extraction?** Invoice layouts vary by supplier, which rules cannot keep up with. Structured output against a schema, followed by code validation (line items sum to the total, the vendor exists, the invoice number is new), catches most extraction errors before they matter.
- **Why an agent only for exceptions?** Exceptions are open-ended: a partial delivery, a price change, a missing PO. Here each result decides the next lookup, which is what an agent is for. Its tools are read-only lookups plus a draft email, so its worst failure is a bad proposal that a clerk rejects.
- **Why not multi-agent?** The steps are sequential and share one context; nothing runs in parallel. A second agent would add handoffs and tokens and buy nothing.
- **Why the checkpoints sit where they do?** The clerk approves every exception resolution, because those are the uncertain cases. Payments above a limit need an approver, because the cost of a mistake grows with the amount. Bank-detail changes go to treasury, who confirm them on a phone number already on file: a request to pay an invoice to a new account is a known fraud scheme (the FBI calls it the bogus invoice scheme), and exactly what an injected document would ask for (G5.5).
- **Why an idempotency key on posting?** A retry after a timeout must not pay an invoice twice: vendor plus invoice number is unique in the ERP.

*4. Prove it and roll it out.* Build an eval set of about 200 past invoices, exceptions included, with the correct outcome for each (G5.6). Run in **shadow mode** first: the system proposes while clerks work as today, and the proposals are compared with what the clerks did. Then **assist**: clerks approve every proposal. Then automate the classes whose approval rate has stayed near 100%. Report the straight-through processing rate (the share of invoices paid with no human touch), field-level extraction accuracy, the exception resolution rate, and the false-approval rate.

*5. Say what would change the design.* If exceptions were half of all invoices, the agent would earn a larger role and a bigger eval set. If the client were a bank, every step would log to tamper-evident storage and more checkpoints would be mandatory. If volume were 300 a month, a simpler assistant for the clerks might beat any automation.

**In an interview**

- *A client wants "an AI agent" to automate a business process. How do you decide how agentic it should be?* I map the process first: the steps that are known go into a code workflow, and only the open-ended ones become a bounded agent step. The deciding factors are whether the path can be listed in advance, the cost of a wrong action, auditability, volume, and whether each step can be checked. People approve irreversible or unusual actions, and autonomy grows with measured approval rates.
- *Why not a multi-agent design?* Multi-agent pays off for broad, parallel, read-heavy work such as research; in Anthropic's system it used about 15 times the tokens of a chat. For a sequential process with shared context, it adds lossy handoffs and conflicting decisions for no gain. I start with one agent and split only when the context or the parallelism demands it.

Sources: [Anthropic — Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) · [Yao et al., τ-bench](https://arxiv.org/abs/2406.12045) · [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) · [Cognition — Don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents) · [Cemri et al., Why do multi-agent LLM systems fail?](https://arxiv.org/abs/2503.13657) · [Spring AI 2.0 — Tool calling, user-controlled tool execution](https://docs.spring.io/spring-ai/reference/api/tools.html) · [MCP specification 2026-07-28 — Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) · [Policy in Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy.html) · [FBI IC3 — Business email compromise, bogus invoice scheme](https://www.ic3.gov/PSA/2017/PSA170504)
