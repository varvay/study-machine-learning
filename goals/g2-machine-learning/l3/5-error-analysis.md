---
title: Error analysis
---

At L3, error analysis is a loop that runs every release, and its output is decisions: which failure to fix first, at which layer of the system, and which test keeps it fixed. It is also the literal answer to "analyze recurring patterns in model performance".

**Finding the recurring patterns.** A **failure taxonomy** is the list of failure categories, each with a definition and an example, that every failed output gets tagged with (G2.5 L2 keeps it as a sheet). Build it from the data, not from a list written in advance:

1. **Open coding** — read about 100 varied traces (a trace is the full record of one request: input, retrieved context, prompts, tool calls, output) and write a free note on what went wrong in each.
2. **Axial coding** — group the notes into categories, and give each a one-line definition.
3. **Saturation** — keep reading new traces until they stop adding categories or changing existing ones. Husain's evals FAQ gives this procedure and stopping rule.

Tag each failed trace with its **first** failure in the pipeline order. A wrong retrieval makes every later step wrong, so tagging the later symptoms too counts one cause several times. Expect the categories to change as you read: Shankar et al. call this **criteria drift**, finding that people need criteria to grade outputs, yet grading outputs is how they discover the criteria. Version the taxonomy, and re-tag a sample after each change.

Reading scales to hundreds of traces; production has millions. Three ways to go further:

- **Automated tagging** — once the categories are stable, an LLM classifier or plain rules tag the rest. Check its tags against human tags on a sample first; its accuracy is a metric like any other (G2.2).
- **Cross-slicing** — compute the failure rate for combinations of segment and category, not each alone. Patterns often live in intersections: retrieval failures that occur only for scanned PDFs from one product line.
- **Embedding clusters** — embed the failing inputs, cluster them, and read a few from each cluster. Clusters where the model fails far more than average are candidate slices; Domino automates this kind of **slice discovery** and names each slice in words.

Two patterns deserve a check in every analysis. First, read a sample of the model's most confident mistakes: some are label errors, and their fix is the label. Second, compare this taxonomy with the previous release's: a category that grows is a regression (a behavior that used to work and now fails) or a drift (G2.6), even when the overall score holds.

**Fix each failure at the right layer.** The same symptom, a wrong answer, can come from the data, retrieval, context assembly, prompt, or model, and a fix at the wrong layer costs time and changes nothing. Find the layer by experiment, not by guess. Ng's *Machine Learning Yearning* calls this **error analysis by parts**: replace one component's output with a perfect one and see whether the end result becomes correct. For a RAG system, walk each failed trace down this ladder:

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 420" role="img" aria-labelledby="error-analysis-ladder-title">
<title id="error-analysis-ladder-title">Four questions asked in order for a failed RAG answer; the first "no" names the layer to fix, and a final "yes" points at distractors in retrieval</title>
<path class="key-link" d="M185,78 L185,110" /><path class="key-link" d="M185,158 L185,190" /><path class="key-link" d="M185,238 L185,270" /><path class="key-link" d="M185,318 L185,350" />
<text class="key-tag" x="195" y="98">yes</text><text class="key-tag" x="195" y="178">yes</text><text class="key-tag" x="195" y="258">yes</text><text class="key-tag" x="195" y="338">yes</text>
<path class="key-link" d="M350,54 L430,54" /><path class="key-link" d="M350,134 L430,134" /><path class="key-link" d="M350,214 L430,214" /><path class="key-link" d="M350,294 L430,294" />
<text class="key-tag" x="390" y="47" text-anchor="middle">no</text><text class="key-tag" x="390" y="127" text-anchor="middle">no</text><text class="key-tag" x="390" y="207" text-anchor="middle">no</text><text class="key-tag" x="390" y="287" text-anchor="middle">no</text>
<rect class="fold-train" x="20" y="30" width="330" height="48" rx="6" /><text class="table-name" x="32" y="50">1. Is the answer in the corpus at all?</text><text class="note" x="32" y="68">search the sources by hand</text>
<rect class="fold-train" x="20" y="110" width="330" height="48" rx="6" /><text class="table-name" x="32" y="130">2. Is the right chunk in the top k?</text><text class="note" x="32" y="148">log retrieved chunk IDs in every trace</text>
<rect class="fold-train" x="20" y="190" width="330" height="48" rx="6" /><text class="table-name" x="32" y="210">3. Does that chunk reach the prompt?</text><text class="note" x="32" y="228">read the exact prompt that was sent</text>
<rect class="fold-train" x="20" y="270" width="330" height="48" rx="6" /><text class="table-name" x="32" y="290">4. Correct with only the gold chunk?</text><text class="note" x="32" y="308">the oracle test: perfect retrieval, same model</text>
<rect class="fold-test" x="430" y="30" width="310" height="48" rx="6" /><text class="table-name" x="442" y="50">Data</text><text class="note" x="442" y="68">missing or stale source: add or re-sync it</text>
<rect class="fold-test" x="430" y="110" width="310" height="48" rx="6" /><text class="table-name" x="442" y="130">Retrieval recall</text><text class="note" x="442" y="148">chunking, embeddings, hybrid search (G1.7)</text>
<rect class="fold-test" x="430" y="190" width="310" height="48" rx="6" /><text class="table-name" x="442" y="210">Context assembly</text><text class="note" x="442" y="228">truncation, token budget, chunk order</text>
<rect class="fold-test" x="430" y="270" width="310" height="48" rx="6" /><text class="table-name" x="442" y="290">Generation</text><text class="note" x="442" y="308">prompt, then a stronger model, then fine-tune</text>
<rect class="fold-test" x="20" y="350" width="330" height="48" rx="6" /><text class="table-name" x="32" y="370">Retrieval precision</text><text class="note" x="32" y="388">distractors bury the answer: rerank, send fewer</text>
</svg>
</div>
<figcaption>Walk each failed trace down the ladder; the first "no" names the layer. If the model answers correctly from the gold chunk alone but not from the real context, the other retrieved chunks are misleading it.</figcaption>
</figure>

The steps map onto the seven RAG failure points of Barnett et al.: missing content (step 1), missed top-ranked documents (step 2), not in context (step 3), and not extracted, wrong format, incorrect specificity, and incomplete answers (generation). A failure whose content is right but whose format or level of detail is wrong goes straight to the prompt or to structured output (G3.5). Ragas, a library of RAG evaluation metrics, scores several rungs automatically: context recall and context precision for retrieval, faithfulness for whether the answer sticks to the context.

Once the layer is known, the fixes come in rough order of cost, cheapest and most reversible first:

| Layer | Evidence | Typical fixes | Cost to try |
|---|---|---|---|
| Prompt | gold chunk present, instruction ignored or misread | clearer instructions, few-shot examples, output schema | hours |
| Data | answer absent or outdated in the corpus | add sources, re-sync, version filters (G2.6 L3) | hours to days |
| Retrieval | gold chunk ranked low or absent | chunk size, hybrid search, reranker (a second model that re-scores the retrieved chunks; G1.7 L3), metadata filters | days |
| Model | still wrong with gold context and a good prompt | a stronger model, or routing hard queries to one (G3.3) | per-request cost |
| Fine-tune | a narrow, stable behavior (format, style, domain terms) still fails after prompt work | SFT (supervised fine-tuning on input-output examples) with LoRA (training small added weight matrices while the model's own weights stay frozen) on curated examples (G4) | weeks, plus upkeep |

For a classic model the layers are data, features, and model, and one question separates them: **could a human expert decide correctly from the same inputs?** If not, the information is missing, and no model change helps: add features or data. If yes, look at the slice's training error: high means the model cannot fit it (bias: more capacity, better features); low with high validation error means it memorized (variance: more data for that slice, regularization).

**Prioritize by frequency × impact.** The largest category is not always the first to fix. Rank each category by its expected cost, frequency × impact per failure, and then by cost removed per unit of effort. An illustrative week for a support assistant with 2,000 failed conversations:

| Category | Share | Failures / week | Cost per failure | Weekly cost | Effort | Cost removed per week of effort |
|---|---|---|---|---|---|---|
| Retrieval missed the document | 40% | 800 | $6 (escalation) | $4,800 | 2 weeks | $2,400 |
| Wrong format | 25% | 500 | $0.50 | $250 | 1 day | $1,250 |
| Answer ignored the context | 17% | 340 | $6 | $2,040 | 3 days | $3,400 |
| Outdated document | 15% | 300 | $10 | $3,000 | 1 week | $3,000 |
| Wrong refund amount | 3% | 60 | $120 (disputes) | $7,200 | 1 week | $7,200 |

By frequency, retrieval comes first and refunds last. By cost, the 3% refund category is the most expensive. By return on effort, the order is refunds (fetch the amount from the order system through a tool, never generate it), then the ignored context, then outdated documents, then retrieval. Three refinements:

- **Weight by production traffic.** If the reading sample over-represents a segment, reweight the counts to real traffic before multiplying.
- **Discount by how much a fix removes.** A reranker might remove half the retrieval failures, not all; multiply by the expected share.
- **A category's share is its ceiling.** Fixing wrong formats perfectly improves the failure rate by at most 25% of failures, so no format fix is worth more than that.

**Turn past failures into a regression eval set.** A **regression eval set** is a fixed collection of past failures, each stored with a check its fixed behavior must pass, run before every release so a fixed failure stays fixed. Store each case with its origin, its fixture (the data the system sees during the test, here a stub order), and a check that tests behavior rather than exact wording:

```json
{"id": "reg-0142", "category": "wrong_refund_amount", "source_trace": "tr_8f31c", "added": "2026-09-14", "input": "I returned order 55120 last week. How much will I get back?", "fixture": {"order_55120": {"refund_total": 84.50}}, "checks": [{"type": "contains", "value": "84.50"}, {"type": "judge", "criterion": "Says the refund goes to the original payment method"}]}
```

- **Checks** — deterministic checks first (a value present, JSON valid, the right document cited); an LLM judge only for what code cannot test, with one pass / fail criterion per check (G2.2 L3).
- **Coverage** — keep the set stratified by category and report a pass rate per category, and include a random sample of ordinary traffic so fixes are not tuned only to past failures. CheckList-style variations (after Ribeiro et al.'s behavioral testing method) of each failure (paraphrases, typos, other entities) test the capability rather than one string.
- **The gate** — run it in CI (continuous integration: the automated checks that run on every change) on every change to the prompt, model, retrieval, or data (G6.5). A change passes when its target category improves and no other category drops by more than noise, judged with a paired test (G2.2 L3).
- **Overfitting the set** — iterate on one part and gate on a held-out part; tuning prompts against the gate itself makes its pass rate meaningless, the same way tuning on the test set does (G2.3 L1).
- **Upkeep** — retire cases whose source document is gone, update expected values when the facts change, and remove near-duplicates so no single failure dominates the pass rate.

**Present the findings to a team.** Lead with the decision, not the method. A one-page readout:

1. **Headline** — one sentence with the number and the ask: "Wrong refund amounts are 3% of failures but $7,200 a week; routing amounts through the order API removes them in one week of work."
2. **Method in two lines** — how many traces, sampled how, from which period, tagged by whom, and how well two taggers agreed on a shared sample.
3. **Taxonomy table** — frequency, cost, and one real trace per category. A real example convinces faster than any definition.
4. **Ranked fixes** — layer, owner, effort, expected cost removed.
5. **Evidence and uncertainty** — before / after pass rates on the regression set with intervals, and what is not yet known.
6. **Decisions needed** — what the team must agree on today.

State facts and hypotheses separately ("40% of failures miss the document" is a count; "a reranker will fix half" is a bet), and expect the question "is this sample representative?", with the answer ready. This is also the material for the G7.3 story.

**In an interview**

- *The RAG assistant's accuracy dropped from 85% to 78%. How do you find out why?* First confirm the drop is real with a paired comparison on the same questions, then diff the failure taxonomy between the two releases to see which category grew. For that category I walk failed traces down the layers: is the answer in the corpus, in the top-k results, in the final prompt, and does the model get it right from the gold passage alone. The first "no" names the layer; I fix it there and add those traces to the regression set.
- *You have five failure categories and one sprint. How do you choose?* I estimate each category's weekly cost as frequency times the cost of one failure, reweighted to production traffic, then divide by effort and by how much of it a fix would remove. That often reorders the list: a rare failure that costs money or trust beats a common cosmetic one. I present the ranking with one real example per category, so the team argues about the numbers, not about anecdotes.

Sources: [Husain — AI Evals FAQ (open and axial coding)](https://hamel.dev/blog/posts/evals-faq/) · [Husain — A Field Guide to Rapidly Improving AI Products](https://hamel.dev/blog/posts/field-guide/) · [Shankar et al., Who Validates the Validators? (criteria drift)](https://arxiv.org/abs/2404.12272) · [Eyuboglu et al., Domino (slice discovery)](https://arxiv.org/abs/2203.14960) · [Ng, Machine Learning Yearning (error analysis by parts)](https://info.deeplearning.ai/machine-learning-yearning-book) · [Barnett et al., Seven Failure Points of RAG Systems](https://arxiv.org/abs/2401.05856) · [Ragas — Available metrics](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/) · [Ribeiro et al., CheckList](https://arxiv.org/abs/2005.04118)
