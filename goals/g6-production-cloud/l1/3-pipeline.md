---
title: End-to-end pipeline
---

An AI app's **pipeline** is the chain of stages that turns raw data into answers, and turns what happens to those answers into improvements. A RAG app has seven stages in two halves.

The **offline** half prepares the knowledge. It runs when documents change, not when a user asks:

- **Ingestion** — collecting the source documents from where they live (file storage such as Amazon S3, wikis, databases) and recording each one's version, so a changed document is picked up again.
- **Processing** — turning each document into clean, searchable pieces: extract the text from PDFs and web pages, drop boilerplate such as headers and menus, mask personal data (G6.7), split the text into chunks, and attach metadata to each chunk: its source, date, and who may read it.
- **Embedding** — computing each chunk's vector with an embedding model (G1.7). Questions must later be embedded by the same model: vectors from two different models do not share a space, so they cannot be compared.
- **Storage** — writing the chunks, their vectors, and their metadata to a store that searches by similarity, such as PostgreSQL with pgvector (G1.8).

The **online** half runs on every question:

- **Serving** — the API that answers: embed the question, retrieve the nearest chunks, build the prompt, call the model, and return the answer with its citations. G6.8 follows one request through these steps.
- **Monitoring** — recording what each request did and how well it went: latency, tokens, cost, errors, and quality scores (G6.6); and watching trends such as questions on new topics or answers built on stale documents (G2.6).
- **Feedback** — turning what users and monitoring report into fixes. A thumbs-down or a failed quality check points to a missing document, a badly cut chunk, or a weak prompt; error analysis (G2.5) groups them by cause, and each failed question becomes a new test case for the evaluation gate, the automated check that blocks a release whose answers got worse (G6.5).

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 185" role="img" aria-labelledby="pipeline-stages-title">
<title id="pipeline-stages-title">The seven pipeline stages in a row: four offline stages, then three online stages, with a feedback loop back to processing and serving</title>
<text class="note" x="217" y="24" text-anchor="middle">offline: runs when documents change</text>
<text class="note" x="588" y="24" text-anchor="middle">online: runs on every question</text>
<path class="key-link" d="M14,40 V34 H420 V40 M438,40 V34 H738 V40" />
<rect class="fold-train" x="14" y="48" width="88" height="58" rx="8" /><text class="table-name" x="58" y="72" text-anchor="middle">ingestion</text><text class="key-tag" x="58" y="92" text-anchor="middle">S3, wikis, DBs</text>
<rect class="fold-train" x="120" y="48" width="88" height="58" rx="8" /><text class="table-name" x="164" y="72" text-anchor="middle">processing</text><text class="key-tag" x="164" y="92" text-anchor="middle">parse, chunk</text>
<rect class="fold-train" x="226" y="48" width="88" height="58" rx="8" /><text class="table-name" x="270" y="72" text-anchor="middle">embedding</text><text class="key-tag" x="270" y="92" text-anchor="middle">embedding API</text>
<rect class="fold-train" x="332" y="48" width="88" height="58" rx="8" /><text class="table-name" x="376" y="72" text-anchor="middle">storage</text><text class="key-tag" x="376" y="92" text-anchor="middle">pgvector</text>
<rect class="fold-test" x="438" y="48" width="88" height="58" rx="8" /><text class="table-name" x="482" y="72" text-anchor="middle">serving</text><text class="key-tag" x="482" y="92" text-anchor="middle">RAG API</text>
<rect class="fold-test" x="544" y="48" width="88" height="58" rx="8" /><text class="table-name" x="588" y="72" text-anchor="middle">monitoring</text><text class="key-tag" x="588" y="92" text-anchor="middle">traces, evals</text>
<rect class="fold-test" x="650" y="48" width="88" height="58" rx="8" /><text class="table-name" x="694" y="72" text-anchor="middle">feedback</text><text class="key-tag" x="694" y="92" text-anchor="middle">user ratings</text>
<path class="key-link" d="M102,77 H119 M113,73 L119,77 L113,81 M208,77 H225 M219,73 L225,77 L219,81 M314,77 H331 M325,73 L331,77 L325,81 M420,77 H437 M431,73 L437,77 L431,81 M526,77 H543 M537,73 L543,77 L537,81 M632,77 H649 M643,73 L649,77 L643,81" />
<path class="key-link" d="M694,106 V150 H164 V107 M160,113 L164,107 L168,113 M482,150 V107 M478,113 L482,107 L486,113" />
<text class="note" x="172" y="134">re-ingest, re-chunk</text>
<text class="note" x="490" y="134">new prompt, model, test cases</text>
<text class="note" x="429" y="172" text-anchor="middle">the feedback loop: what users and monitoring report becomes the next fix</text>
</svg>
</div>
<figcaption>A RAG app's pipeline. The offline stages fill the vector store; the online stages answer questions from it and learn from each answer.</figcaption>
</figure>

Why split the work in two? Embedding a whole corpus takes minutes to hours and is billed per token. Done once per document change, it leaves each question with a single short embedding to compute, so answers stay fast and cheap. Amazon Bedrock Knowledge Bases runs the offline half and the retrieval step as a managed service (G6.1).

A classic ML model has the same shape with a different middle: processing computes features, the input values a model learns from (G1.8), training takes the place of embedding, storage keeps the trained model in a registry (G6.5), and serving returns predictions.

Source: [Amazon Bedrock Knowledge Bases](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html)
