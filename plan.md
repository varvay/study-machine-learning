# Study Plan

This plan splits every checkbox in [goal.md](goal.md) into three depth levels.

| Level | Name | Done when I can… |
|---|---|---|
| **L1** | Surface | define it and explain how it works in a nutshell |
| **L2** | Practical | use the common tools, frameworks, and formulas hands-on |
| **L3** | Expertise | explain the internals and trade-offs, and defend a design under follow-up questions |

- Tick the goal.md checkbox when its L2 is done. L3 is what makes me the subject matter expert.
- Each item's slug is its topic folder, e.g. `topics/g1-relational-modeling/`.
- Tool and product names come from general knowledge (unsourced). Check the current docs when studying a topic.

## Phases

1. **Breadth** — every L1, G1 to G7. Every interview question then gets a correct short answer.
2. **Practice** — L2 in priority order: G1, G6, G5, G3, G4, G2. Build the capstone as I go; most L2 items produce one piece of it.
3. **Depth** — L3 on G1 and on everything the capstone uses. Rehearse the G7 stories.
4. **Rehearsal** — the Interview Readiness Checklist in goal.md, and mock interviews.

---

## G1 — Database Architecture

#### G1.1 Relational modeling · `g1-relational-modeling`
- [ ] **L1** — Entities, attributes, relationships, primary and foreign keys, cardinality (1:1, 1:N, M:N). 1NF, 2NF, 3NF in one line each. What denormalization is.
- [ ] **L2** — Draw an ERD (dbdiagram.io, draw.io) and write its PostgreSQL DDL. Normalize a flat spreadsheet to 3NF. Add constraints: `NOT NULL`, `UNIQUE`, `CHECK`, foreign keys with `ON DELETE` rules.
- [ ] **L3** — BCNF, and when 3NF is enough. Denormalize read-heavy paths (materialized views, summary tables) and keep them consistent. Schema migrations without downtime (Flyway, Liquibase, expand-contract).

#### G1.2 Indexing and query plans · `g1-indexing`
- [ ] **L1** — What an index is, and why it speeds up reads and slows down writes. B-tree vs hash. What a query plan is.
- [ ] **L2** — Create composite, partial, covering (`INCLUDE`), and GIN indexes in Postgres. The leftmost-prefix rule. Read `EXPLAIN ANALYZE`: sequential, index, and bitmap scans; cost; estimated vs actual rows.
- [ ] **L3** — Planner statistics and selectivity, and why the planner skips an index. Index bloat, fillfactor, write amplification. Find slow queries with `pg_stat_statements`.

#### G1.3 Transactions and isolation · `g1-transactions`
- [ ] **L1** — ACID in one line each. Transaction, commit, rollback.
- [ ] **L2** — The four isolation levels against the anomalies they prevent: dirty read, non-repeatable read, phantom, lost update, write skew. Reproduce them with two `psql` sessions. `SELECT … FOR UPDATE`. Optimistic locking with a version column.
- [ ] **L3** — MVCC in Postgres (`xmin`/`xmax`, vacuum). Postgres Repeatable Read as snapshot isolation, Serializable as SSI. Deadlocks and how to avoid them. Distributed transactions: 2PC, saga, outbox pattern.

#### G1.4 OLTP, OLAP, and warehousing · `g1-oltp-olap`
- [ ] **L1** — OLTP vs OLAP. Row vs column storage. Warehouse vs lake vs lakehouse. Star vs snowflake schema. Fact vs dimension tables.
- [ ] **L2** — Model a star schema for a business case. ETL vs ELT with dbt. Platforms: Snowflake, BigQuery, Redshift, Databricks. Open table formats: Delta Lake, Apache Iceberg.
- [ ] **L3** — Slowly changing dimensions (type 1, type 2). Partitioning and clustering to cut scan cost. Medallion architecture (bronze, silver, gold). Choose a platform for a client's scale, cost, and governance.

#### G1.5 Scaling and distribution · `g1-scaling`
- [ ] **L1** — Vertical vs horizontal scaling. Replication, partitioning, sharding. CAP in one sentence.
- [ ] **L2** — Postgres streaming replication and read replicas. Declarative partitioning (range, list, hash). Redis caching (cache-aside, TTL). Connection pooling with PgBouncer.
- [ ] **L3** — Shard key choice and hot spots. Consistent hashing. Replication lag and read-your-writes. PACELC. Consensus at a high level (Raft). Cache invalidation and cache stampede.

#### G1.6 Choosing a database · `g1-choosing-a-database`
- [ ] **L1** — The families — relational, document, key-value, wide-column, graph, time-series, vector — and one typical use of each.
- [ ] **L2** — One hands-on example per family: PostgreSQL, MongoDB, Redis, Cassandra, Neo4j, and a vector store (pgvector, Qdrant, Weaviate, Milvus, Pinecone). Polyglot persistence.
- [ ] **L3** — Decide from access patterns, consistency needs, scale, and team skills. Defend Postgres + pgvector against a dedicated vector database. Operational cost and migration paths.

#### G1.7 Vector search · `g1-vector-search`
- [ ] **L1** — What an embedding is. Cosine, dot product, and Euclidean similarity. Exact vs approximate nearest neighbor (ANN). What hybrid search is.
- [ ] **L2** — cos(a, b) = a·b / (‖a‖‖b‖). pgvector: the `vector` column, the `<=>` operator, HNSW and IVFFlat indexes. Chunking strategies. BM25 through Postgres full-text search or OpenSearch. Merge result lists with Reciprocal Rank Fusion: score = Σ 1 / (k + rank).
- [ ] **L3** — HNSW (`m`, `ef_construction`, `ef_search`) and IVF (`lists`, `probes`) against recall and latency. Measure recall@k against exact search. Metadata filtering before vs after the search. Quantization (product, binary). Cross-encoder re-ranking. Re-indexing when the embedding model changes.

#### G1.8 Data layer of an AI app · `g1-ai-data-layer`
- [ ] **L1** — The data an AI app keeps: source documents, chunks, embeddings, conversations, agent memory, features, eval results, traces.
- [ ] **L2** — Write the capstone's Postgres schema: `documents`, `chunks` (with an embedding column), `conversations`, `messages`, `eval_runs`, `traces`. The feature store idea (Feast). Mark PII columns and restrict access to them.
- [ ] **L3** — Multi-tenancy: row-level security vs schema per tenant. Document versioning and lineage, so answers cite the right version. Retention and right-to-be-forgotten across embeddings. Audit logs. Encryption at rest and in transit.

---

## G2 — Machine Learning Fundamentals

#### G2.1 Learning basics · `g2-learning-basics`
- [ ] **L1** — Supervised, unsupervised, reinforcement learning. Classification vs regression. Bias vs variance. Overfitting vs underfitting. What regularization and cross-validation do.
- [ ] **L2** — scikit-learn: linear and logistic regression, decision tree, random forest, gradient boosting (XGBoost, LightGBM). k-fold cross-validation. L1 and L2 penalties: λΣ|w| and λΣw². Learning curves.
- [ ] **L3** — Bias-variance decomposition. Why ensembles work: bagging lowers variance, boosting lowers bias. Hyperparameter search: grid, random, Bayesian (Optuna). Choose a model for a client's data size and need for interpretability.

#### G2.2 Evaluation metrics · `g2-metrics`
- [ ] **L1** — The confusion matrix. Accuracy, precision, recall, F1, ROC-AUC, RMSE, perplexity, BLEU, ROUGE in one line each.
- [ ] **L2** — Precision = TP / (TP + FP). Recall = TP / (TP + FN). F1 = 2PR / (P + R). RMSE = √mean((y − ŷ)²). Perplexity = exp(mean negative log-likelihood). Compute them in scikit-learn. Pick a threshold from the precision-recall curve.
- [ ] **L3** — PR-AUC over ROC-AUC on imbalanced data. Metrics weighted by business cost. Why BLEU and ROUGE fail on LLM output, and what replaces them (LLM-as-judge, task-specific checks). Significance testing between two models.

#### G2.3 Data pitfalls · `g2-data-pitfalls`
- [ ] **L1** — Data leakage, class imbalance, train / validation / test splits.
- [ ] **L2** — Stratified, time-based, and group splits in scikit-learn. Class weights, oversampling (SMOTE in imbalanced-learn), undersampling. Fit preprocessing on train only, with `Pipeline`.
- [ ] **L3** — Subtle leakage: target leakage, duplicates across splits, future information in features. Shift between training and production data. Benchmark contamination in LLM pretraining data.

#### G2.4 Neural network training · `g2-neural-networks`
- [ ] **L1** — Neuron, layer, activation, loss, forward pass, backpropagation, gradient descent.
- [ ] **L2** — Train a small MLP in PyTorch. MSE and cross-entropy loss. SGD and AdamW. Update rule w ← w − η∇L. Learning rate, batch size, epochs. Dropout and normalization layers.
- [ ] **L3** — Vanishing and exploding gradients, and their fixes: ReLU, residual connections, normalization, gradient clipping. Learning rate warmup and cosine decay. Mixed precision (fp16, bf16). Diagnose training from a loss curve.

#### G2.5 Error analysis · `g2-error-analysis`
- [ ] **L1** — Error analysis: collect failures, group them, fix the largest group first.
- [ ] **L2** — Slice metrics by segment in pandas. Per-class confusion matrices. A failure taxonomy sheet for LLM outputs. Compare runs in MLflow or Weights & Biases.
- [ ] **L3** — Fix each recurring failure at the right layer: data, retrieval, prompt, model, or fine-tune. Prioritize by frequency × impact. Turn past failures into a regression eval set. Present the findings to a team.

#### G2.6 Drift and monitoring · `g2-drift`
- [ ] **L1** — Data drift vs concept drift. Why models decay in production.
- [ ] **L2** — Population Stability Index, Kolmogorov-Smirnov test, KL divergence. Evidently AI. Cloud model monitoring (SageMaker Model Monitor, Vertex AI Model Monitoring). Embedding drift for LLM inputs.
- [ ] **L3** — Alert thresholds without alert fatigue. Proxy metrics when labels arrive late. Retraining on triggers vs on a schedule. Stale documents in a RAG corpus.

---

## G3 — Foundation Models and LLMs

#### G3.1 Transformer architecture · `g3-transformer`
- [ ] **L1** — Tokens and tokenization. Embeddings. Self-attention in one sentence. Positional encoding. Decoder-only (GPT), encoder-only (BERT), encoder-decoder (T5).
- [ ] **L2** — Attention(Q, K, V) = softmax(QKᵀ / √dₖ) V. Multi-head attention. Tokenize and count tokens with Hugging Face `transformers` or `tiktoken`. Run a small model locally.
- [ ] **L3** — The KV cache, and why generation is memory-bound. O(n²) attention cost and long-context techniques (RoPE, FlashAttention) at a high level. Mixture-of-experts. Scaling laws at a high level.

#### G3.2 Inference and hallucination · `g3-inference`
- [ ] **L1** — Temperature, top-p, max tokens. Context window. What a hallucination is.
- [ ] **L2** — Temperature sampling: pᵢ = exp(zᵢ / T) / Σ exp(zⱼ / T). Tune the parameters per task. Reduce hallucination with grounding (RAG), citations, and answer-only-from-context prompts.
- [ ] **L3** — Why hallucinations happen: the next-token objective, gaps in training data, decoding. Detect them with faithfulness checks, self-consistency, LLM-as-judge. Lost-in-the-middle in long contexts. Serving engines (vLLM, TGI) and continuous batching.

#### G3.3 Model selection · `g3-model-selection`
- [ ] **L1** — Proprietary vs open-weight. The trade-off between size, cost, latency, and quality.
- [ ] **L2** — Compare API models (Claude, GPT, Gemini) with open-weight models (Llama, Mistral, Qwen) on one task. Price per million tokens. Read a model card. Use leaderboards with caution.
- [ ] **L3** — Choose a model for a client scenario: data residency, on-premises, cost at scale, latency targets. Model routing and fallback. Build a task-specific eval to decide.

#### G3.4 Multimodal and vision · `g3-vision`
- [ ] **L1** — CNNs (convolution, pooling). Vision transformers (image patches as tokens). OCR. Multimodal LLMs.
- [ ] **L2** — Classify images with a pretrained ResNet (torchvision). OCR with Tesseract or a cloud service (Amazon Textract, Azure Document Intelligence, Google Document AI). Send an image to a multimodal LLM. CLIP embeddings for image search.
- [ ] **L3** — Document understanding for RAG: layout, tables, forms. OCR vs a vision LLM on cost and accuracy. Transfer learning and augmentation. Vision metrics (IoU, mAP).

#### G3.5 Prompt engineering · `g3-prompting`
- [ ] **L1** — System prompt, few-shot, chain-of-thought, structured output, prompt injection.
- [ ] **L2** — Prompt templates. JSON output validated against a schema (JSON Schema, Pydantic, Spring AI `BeanOutputConverter`). Choosing few-shot examples. Versioning prompts.
- [ ] **L3** — Direct vs indirect prompt injection, and defenses: isolating untrusted input, least-privilege tools, output filtering. Regression tests for prompts. Prompt caching for cost.

---

## G4 — LLM / Foundation Model Fine-Tuning

#### G4.1 Prompting vs RAG vs fine-tuning · `g4-decision`
- [ ] **L1** — What each changes: prompting changes instructions, RAG adds knowledge at query time, fine-tuning changes the weights.
- [ ] **L2** — The decision table: changing knowledge → RAG; format, style, or a narrow task → fine-tune; always start with prompting; RAG and fine-tuning combine.
- [ ] **L3** — Defend the choice for a client with cost, latency, data volume, maintenance, and eval evidence. When a fine-tuned small model beats a prompted large one.

#### G4.2 PEFT and LoRA · `g4-lora`
- [ ] **L1** — Full fine-tuning updates all weights; PEFT updates a small set. LoRA adds low-rank matrices. QLoRA also quantizes the base model to 4-bit.
- [ ] **L2** — W′ = W + BA, with B ∈ ℝ^(d×r), A ∈ ℝ^(r×k), r ≪ min(d, k). Hyperparameters: rank, alpha, dropout, target modules. Hugging Face `peft` and `bitsandbytes`.
- [ ] **L3** — Choosing rank and target modules. Merged adapters vs serving many adapters on one base (vLLM multi-LoRA). GPU memory math. When full fine-tuning is worth its cost.

#### G4.3 SFT and preference tuning · `g4-sft-dpo`
- [ ] **L1** — Pretraining vs supervised fine-tuning (SFT) vs preference tuning. RLHF and DPO in one line each.
- [ ] **L2** — SFT with TRL `SFTTrainer`. Chat templates. DPO on chosen / rejected pairs with TRL `DPOTrainer`.
- [ ] **L3** — RLHF (reward model + PPO) vs DPO trade-offs. Reward hacking. Alignment tax. Newer methods (ORPO, KTO, GRPO) at a high level — verify what is current.

#### G4.4 Fine-tuning datasets · `g4-datasets`
- [ ] **L1** — The shape of an example (instruction / input / output, or chat messages). Quality over quantity.
- [ ] **L2** — Build a JSONL dataset: dedupe, clean, filter, split. Generate synthetic examples with a stronger model. A narrow task often needs hundreds to a few thousand good examples (unsourced rule of thumb).
- [ ] **L3** — Data quality audits. Task coverage and balance. Licensing and PII in training data. Dataset versioning (DVC). Keeping eval data out of training.

#### G4.5 Evaluating a fine-tune · `g4-evaluation`
- [ ] **L1** — Baseline vs fine-tuned comparison. Catastrophic forgetting. Overfitting.
- [ ] **L2** — Held-out task eval. Training vs eval loss curves. Regression checks on general ability. lm-evaluation-harness and LLM-as-judge.
- [ ] **L3** — Design an eval that predicts production value. Limit forgetting: lower learning rate, fewer epochs, LoRA, mixing in general data. A/B tests in production.

#### G4.6 Hands-on fine-tune · `g4-hands-on`
- [ ] **L1** — The steps: data → base model → config → train → evaluate → serve.
- [ ] **L2** — QLoRA fine-tune a small open model (1B–8B: Llama, Qwen, Mistral) on Colab or Kaggle with TRL or Unsloth. Log to Weights & Biases.
- [ ] **L3** — Walk through my run: hyperparameters, loss curves, failures, results against the baseline. Serve it with vLLM or Ollama and plug it into the capstone.

#### G4.7 Managed fine-tuning · `g4-managed`
- [ ] **L1** — What managed fine-tuning is, and why teams use it.
- [ ] **L2** — The managed path on my chosen cloud: Amazon Bedrock custom models or SageMaker, Azure AI Foundry, or Vertex AI tuning. The OpenAI fine-tuning API as a reference point.
- [ ] **L3** — Cost, hosting charges for custom models, data governance, and lock-in, against self-hosted fine-tuning.

---

## G5 — AI Agents

#### G5.1 The agent loop · `g5-agent-loop`
- [ ] **L1** — An agent is an LLM calling tools in a loop: reason → act → observe. ReAct.
- [ ] **L2** — Build a ReAct loop by hand against one model API with two tools. Rebuild it in Spring AI.
- [ ] **L3** — Plan-and-execute and reflection patterns. Stopping conditions. Managing context in long loops.

#### G5.2 Agent memory · `g5-memory`
- [ ] **L1** — Short-term memory (the context window) vs long-term memory (an external store). Episodic vs semantic memory.
- [ ] **L2** — Spring AI chat memory (`MessageWindowChatMemory`, JDBC repository) and vector-store memory. Summarizing old turns. Store it in the G1.8 schema.
- [ ] **L3** — What to remember and what to forget. Memory retrieval quality. Per-user isolation and privacy. The cost of large contexts.

#### G5.3 Agent architectures · `g5-architectures`
- [ ] **L1** — Workflow vs agent. Single agent vs multi-agent. Orchestrator-worker.
- [ ] **L2** — The patterns in Anthropic's *Building effective agents*: prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer. Frameworks: Spring AI, LangGraph, CrewAI, AutoGen.
- [ ] **L3** — When a fixed workflow beats an agent. Coordination cost of multi-agent systems. Human-in-the-loop checkpoints. Defend an architecture for a business workflow.

#### G5.4 Tools and MCP · `g5-tools-mcp`
- [ ] **L1** — Tool (function) calling. MCP: a standard protocol connecting models to tools and data, through hosts, clients, and servers.
- [ ] **L2** — Define tools with JSON Schema and with Spring AI `@Tool`. Build an MCP server that exposes a SQL query tool, and connect a client. MCP transports (stdio, HTTP).
- [ ] **L3** — Tool design: names, descriptions, and errors the model can act on. Tool security: auth, least privilege, injection through tool results. Tool count vs accuracy.

#### G5.5 Failure modes and guardrails · `g5-guardrails`
- [ ] **L1** — Failure modes: loops, wrong tool, invented arguments, cost blow-up. What a guardrail is.
- [ ] **L2** — Max steps, timeouts, budget caps. Input and output validation. Human approval for risky tools. Guardrails AI, NeMo Guardrails, Amazon Bedrock Guardrails.
- [ ] **L3** — Threat model for an agent with write access. Sandboxing. Audit trails. Graceful degradation.

#### G5.6 Evaluating agents · `g5-evaluation`
- [ ] **L1** — Why agent eval differs from single-answer eval. Task success rate. Trajectories.
- [ ] **L2** — A task test set with expected outcomes. LLM-as-judge rubrics. Tracing with Langfuse, LangSmith, or Arize Phoenix.
- [ ] **L3** — Calibrate the judge against human labels. Evals in CI. Online eval from production traces.

---

## G6 — Production, Cloud, and MLOps

#### G6.1 One cloud's AI stack · `g6-cloud-ai`
- [ ] **L1** — The services by cloud: AWS (Bedrock, SageMaker), Azure (AI Foundry, Azure OpenAI), GCP (Vertex AI). Managed model APIs vs managed ML platforms.
- [ ] **L2** — On my chosen cloud: call a model, build RAG with its managed knowledge base, deploy an endpoint, set IAM. An equivalents table across the three clouds.
- [ ] **L3** — A client architecture on that cloud: private networking, quotas, region and data residency, cost estimate.

#### G6.2 Spring AI · `g6-spring-ai`
- [ ] **L1** — Spring AI is a Java / Spring framework with portable APIs over model providers, vector stores, and tools. Its core parts: `ChatClient`, advisors, `VectorStore`, tool calling, MCP.
- [ ] **L2** — A Spring Boot app with: `ChatClient` on a provider starter; RAG through `QuestionAnswerAdvisor` over `PgVectorStore`; a chat memory advisor; `@Tool` methods; structured output into a Java record; MCP client and server starters; the ETL pipeline (`DocumentReader` → `TextSplitter` → `VectorStore`).
- [ ] **L3** — Write a custom advisor. Streaming with Reactor. Observability through Micrometer and OpenTelemetry. Map each piece to LangChain / LlamaIndex. Retries, timeouts, rate limits, and cost control.

#### G6.3 End-to-end pipeline · `g6-pipeline`
- [ ] **L1** — The stages: ingestion, processing, embedding, storage, serving, monitoring, feedback.
- [ ] **L2** — Draw the capstone pipeline. Batch ingestion (scheduled jobs) vs streaming (Kafka). Orchestration (Airflow, AWS Step Functions). Serving through a REST API.
- [ ] **L3** — Idempotent re-ingestion and incremental updates. Backpressure. Failure recovery. The on-premises variant.

#### G6.4 Cloud vs on-premises · `g6-cloud-vs-onprem`
- [ ] **L1** — Cloud, on-premises, hybrid. The main trade-offs.
- [ ] **L2** — An on-premises stack: Kubernetes, vLLM or Ollama, open-weight models, self-hosted Postgres. GPU sizing: VRAM ≈ parameters × bytes per parameter + KV cache.
- [ ] **L3** — Total cost of ownership for a client. Regulated and air-gapped environments. Hybrid patterns.

#### G6.5 CI/CD and evaluation gates · `g6-cicd`
- [ ] **L1** — CI/CD, model versioning, model registry, evaluation gate.
- [ ] **L2** — A GitHub Actions pipeline running tests and an offline eval. MLflow model registry. Docker images. Versioned prompts and datasets.
- [ ] **L3** — Canary and shadow deployments. Rollback. Eval gate thresholds for model, prompt, and retrieval changes.

#### G6.6 Observability · `g6-observability`
- [ ] **L1** — Logs, metrics, traces. What an LLM app tracks: latency, tokens, cost, quality, user feedback.
- [ ] **L2** — OpenTelemetry tracing. Langfuse or LangSmith. Grafana dashboards. Thumbs up / down collection.
- [ ] **L3** — Targets for LLM apps: time to first token, p95 latency. Link traces to eval results. Catch quality regressions from production signals.

#### G6.7 Security and governance · `g6-security`
- [ ] **L1** — PII, access control, secrets management, prompt injection, data governance.
- [ ] **L2** — PII redaction (Microsoft Presidio, cloud DLP). Secrets in a vault (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault). The OWASP Top 10 for LLM Applications.
- [ ] **L3** — Threat model for a RAG and agent system. Document-level access control in retrieval. GDPR and the EU AI Act at a high level. Responsible AI.

#### G6.8 Cost and latency · `g6-cost-latency`
- [ ] **L1** — Where cost and latency come from: tokens, model size, network, retrieval.
- [ ] **L2** — Cost per request = input tokens × input price + output tokens × output price. Prompt caching, semantic caching, batching, streaming, smaller models. Quantization (int8, int4; GGUF, AWQ).
- [ ] **L3** — Model cascades and routing. Speculative decoding at a high level. Capacity planning. Cost vs quality curves for a client.

---

## G7 — Behavioral and Collaboration

Levels for every story:

- **L1** — The story is picked, and I know the STAR structure: Situation, Task, Action, Result.
- **L2** — It is written in STAR form with a measurable result.
- **L3** — I tell it in under 2 minutes and handle follow-ups: what I would do differently, what the team thought, what I learned.

#### G7.1 Delivered end-to-end independently
- [ ] **L1**
- [ ] **L2**
- [ ] **L3**

#### G7.2 Knew when to seek guidance
- [ ] **L1**
- [ ] **L2**
- [ ] **L3**

#### G7.3 Improved performance or accuracy through analysis
- [ ] **L1**
- [ ] **L2**
- [ ] **L3**

#### G7.4 Gave or received tough feedback
- [ ] **L1**
- [ ] **L2**
- [ ] **L3**

#### G7.5 Influenced a team decision
- [ ] **L1**
- [ ] **L2**
- [ ] **L3**

#### G7.6 Learned a new technology quickly
- [ ] **L1**
- [ ] **L2**
- [ ] **L3**
