# Goal: Win the AI / ML Engineer Role

This document defines **what I need to achieve** to be hired as an AI / ML Engineer, not the study material itself. Every study note in this folder should trace back to one of the goals below.

## North Star
Walk into the interview able to **design, build, fine-tune, evaluate, and ship a production-grade GenAI system on the cloud** and defend every design decision, with database architecture as my strongest pillar, and one working project that proves it.

## Decoding the Job Description
What the JD says, and what the interviewer will actually probe.

| Priority | JD signal | What they will test |
|---|---|---|
| **Primary** | Database architecture (intermediate, *required*) | Data modeling, SQL, indexing, transactions, scaling, OLTP vs OLAP, vector databases, and designing the data layer of an AI application |
| **Secondary** | Machine Learning (intermediate, *recommended*) | ML fundamentals, evaluation metrics, error analysis, "analyze recurring patterns in model performance" |
| Other | Foundation Models, LLM / Foundation Model Fine-Tuning | When and how to fine-tune (SFT, LoRA / QLoRA, DPO), dataset curation, evaluation, cost trade-offs |
| Other | AI Agents | Tool use, planning, memory, multi-agent patterns, guardrails, evaluating agents |
| Core duty | Applications using AI tools and cloud AI services, cloud / on-prem pipeline, production-ready quality | LLM application frameworks (Spring AI), MLOps / LLMOps, deployment, monitoring, security, cost and latency |
| Core duty | GenAI incl. deep learning, neural networks, chatbots, image processing | RAG chatbots, transformer and CNN basics, vision / multimodal models |
| Behavior | Independent, SME, team discussion, feedback, continuous learning | STAR stories showing autonomy, knowing when to escalate, and influencing technical direction |

> The JD's skill-code format suggests a consulting / delivery organization. Expect **client-scenario questions** ("a client wants X, design it").

## Goals and Definition of Done
Each goal is done when I can do every "I can..." statement **out loud, without notes, in under 3 minutes**.

### G1 — Database Architecture (Primary, highest weight)
- [ ] I can model a domain into a normalized relational schema, and explain when to denormalize.
- [ ] I can explain index types (B-tree, hash, GIN, composite, covering) and read a query plan (`EXPLAIN ANALYZE`).
- [ ] I can explain ACID, isolation levels, and the anomalies each one prevents.
- [ ] I can compare OLTP vs OLAP, data warehouse vs data lake vs lakehouse, and star vs snowflake schema.
- [ ] I can explain scaling: replication, partitioning, sharding, CAP / PACELC, and read replicas vs caching.
- [ ] I can choose between SQL, NoSQL (document, key-value, graph), and vector databases for a given workload.
- [ ] I can explain vector search internals (embeddings, cosine / dot product, HNSW, IVF, recall vs latency) and hybrid search (BM25 + vector).
- [ ] I can design the full data layer of an AI app: documents and chunks, embeddings, chat history, agent memory, feature store, eval and trace logs, and PII handling.

### G2 — Machine Learning Fundamentals (Secondary)
- [ ] I can explain supervised vs unsupervised learning, bias-variance, overfitting, regularization, and cross-validation.
- [ ] I can pick the right metric (precision / recall / F1, ROC-AUC, RMSE, BLEU / ROUGE, perplexity) and justify it.
- [ ] I can explain data leakage, class imbalance, and train / validation / test splitting pitfalls.
- [ ] I can explain how a neural network trains (forward pass, loss, backpropagation, gradient descent, optimizers).
- [ ] I can do **error analysis**: slice model failures, find recurring patterns, and propose fixes (data, features, model, or prompt).
- [ ] I can explain model drift (data drift vs concept drift) and how to detect it in production.

### G3 — Foundation Models and LLMs
- [ ] I can explain the transformer architecture: tokenization, embeddings, self-attention, positional encoding, and decoder-only vs encoder-decoder.
- [ ] I can explain inference controls (temperature, top-p, max tokens), context windows, and why hallucinations happen.
- [ ] I can compare model options (proprietary vs open-weight, size vs cost vs latency) and pick one for a scenario.
- [ ] I can explain multimodal models and basic image processing (CNNs, vision transformers, OCR / document understanding).
- [ ] I can write robust prompts: system prompts, few-shot, structured output, and prompt-injection defenses.

### G4 — LLM / Foundation Model Fine-Tuning
- [ ] I can answer **"prompting vs RAG vs fine-tuning"** with a clear decision framework.
- [ ] I can explain full fine-tuning vs PEFT (LoRA, QLoRA, adapters) and why PEFT is usually the right default.
- [ ] I can explain SFT / instruction tuning and preference tuning (RLHF, DPO) at a conceptual level.
- [ ] I can describe how to build and clean a fine-tuning dataset, and how much data is typically needed.
- [ ] I can evaluate a fine-tuned model against a baseline, and explain catastrophic forgetting and overfitting risks.
- [ ] I have **actually fine-tuned** a small open model (e.g. with LoRA) and can talk through the run: hyperparameters, loss curves, and results.
- [ ] I know the managed fine-tuning path on at least one cloud.

### G5 — AI Agents
- [ ] I can explain the agent loop: reasoning, tool calling, observation, and the ReAct pattern.
- [ ] I can explain agent memory (short-term context, long-term store) and how it maps to the database layer (ties back to G1).
- [ ] I can compare single-agent vs multi-agent (orchestrator / worker) designs, and say when *not* to use an agent.
- [ ] I can explain tool / function definitions, MCP, and agent frameworks at a high level, and implement them in Spring AI (G6).
- [ ] I can explain agent failure modes (loops, wrong tool, cost blow-up) and guardrails (human-in-the-loop, limits, permissions).
- [ ] I can explain how to evaluate agents (task success rate, trajectory checks, LLM-as-judge).

### G6 — Production, Cloud, and MLOps
- [ ] I know **one cloud's AI stack deeply** (AWS Bedrock / SageMaker, Azure AI Foundry / Azure OpenAI, or GCP Vertex AI) and can name the equivalents on the others.
- [ ] I can build an LLM application with **Spring AI** — `ChatClient`, advisors (RAG, chat memory), `VectorStore` over pgvector, tool calling, MCP, structured output, and observability — and map each piece to its LangChain / LlamaIndex equivalent.
- [ ] I can draw an end-to-end pipeline: ingestion, processing, embedding, storage, serving, monitoring, and feedback loop.
- [ ] I can explain cloud vs on-premises trade-offs (data residency, cost, GPU availability, latency, compliance).
- [ ] I can explain CI/CD for ML / LLM apps, model versioning, and evaluation gates before release.
- [ ] I can explain observability: tracing, latency, token cost, quality metrics, and user feedback.
- [ ] I can explain security: PII redaction, access control, secrets, prompt injection, and data governance.
- [ ] I can optimize cost and latency: caching, batching, smaller models, quantization, and streaming.

### G7 — Behavioral and Collaboration
Prepare **6 STAR stories** from my own experience:
- [ ] Delivered something end-to-end independently.
- [ ] Hit a complex problem and knew when to seek guidance.
- [ ] Improved a system's performance or accuracy through analysis.
- [ ] Gave or received tough technical feedback.
- [ ] Influenced a team decision or project direction.
- [ ] Learned a new technology quickly and applied it.

## Proof: Capstone Project
One project that proves G1 to G6 together, and that I can demo and walk through in the interview.

**Idea:** An *AI assistant over a document corpus* (e.g. technical manuals or my own study notes).

| Component | Proves |
|---|---|
| Postgres + pgvector schema for documents, chunks, embeddings, chat history, and eval logs | G1 |
| RAG chatbot with hybrid search and citations | G3, G6 |
| Agent that uses tools (search, SQL query, calculator) | G5 |
| LoRA fine-tuned small model for one narrow task (e.g. classification or structured extraction), compared against a prompted baseline | G4 |
| Evaluation set + error analysis report of recurring failure patterns | G2 |
| Deployed on one cloud with basic monitoring, cost tracking, and a README architecture diagram | G6 |

**Done when:** the repo is public, runs from its README, and I can explain every design decision and its trade-off.

## Interview Readiness Checklist
- [ ] All G1 to G6 "I can..." statements checked.
- [ ] Capstone project done and rehearsed as a 5-minute walkthrough.
- [ ] Can whiteboard 3 system designs in 30 minutes each:
  - [ ] RAG chatbot for enterprise documents
  - [ ] AI agent that automates a business workflow
  - [ ] Data platform feeding an ML model (batch + real-time)
- [ ] Can write intermediate SQL live (joins, window functions, CTEs, aggregation).
- [ ] Can write a small Python ML / LLM script live (load data, call a model, evaluate).
- [ ] 6 STAR stories rehearsed.
- [ ] A 60-second "tell me about yourself" pitch aligned to this role.
- [ ] 3 thoughtful questions ready for the interviewer.

## Non-Goals
To stay focused, I will **not** go deep on:
- Training foundation models from scratch.
- Heavy math proofs or research-level ML theory.
- Every framework and every cloud; one of each, known well, beats many known shallowly. The framework is Spring AI.
