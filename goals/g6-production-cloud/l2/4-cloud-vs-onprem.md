---
title: Cloud vs on-premises
---

Recap (G6.4 L1): on-premises means the organization's own servers, so the models must be open-weight and the team runs everything; the cloud rents the same pieces as managed services. Here you build the capstone's on-premises variant and size its GPU.

## The stack

Each managed piece of the AWS capstone has a self-hosted replacement:

| Layer | On-premises | AWS capstone |
|---|---|---|
| Runs the containers | Kubernetes (the open-source system that runs and restarts containers across a cluster of machines), with the NVIDIA GPU device plugin, which lets it hand GPUs to containers | Amazon ECS or EKS |
| Serves the chat model | vLLM in production, Ollama on a laptop | Bedrock |
| Chat model | an open-weight model, such as Qwen3-8B (Apache 2.0 license, which allows commercial use) | Claude Haiku 4.5 |
| Embedding model | an open embedding model on vLLM or Ollama | Titan Text Embeddings V2 |
| Vector store and memory | self-hosted PostgreSQL with the pgvector extension | Amazon RDS (AWS's managed relational databases) or Aurora PostgreSQL |
| Observability | self-hosted Langfuse (LLM tracing), Prometheus (metrics storage), and Grafana (dashboards), all in G6.6 | the same, or managed versions |

The Spring AI app stays the same: only its model starter and properties change, since every `ChatModel` sits behind the same `ChatClient` (G6.2).

## Ollama: the model on a laptop

**Ollama** runs open-weight models locally with one command. Its default `qwen3:8b` tag is the same 5.2 GB build as `qwen3:8b-q4_K_M`, a 4-bit GGUF quantization (each weight stored in about 4 bits instead of 16, in the GGUF file format; G6.8), which is why an 8-billion-parameter model fits in a laptop's memory.

```bash
ollama pull qwen3:8b
ollama run qwen3:8b "Summarize RAG in one sentence."
curl http://localhost:11434/api/chat -d '{
  "model": "qwen3:8b",
  "messages": [{"role": "user", "content": "Summarize RAG in one sentence."}],
  "stream": false
}'
```

Ollama listens on port 11434, with its own API under `/api` and an OpenAI-compatible one, which accepts OpenAI's request format, under `/v1`. For Spring AI, swap the Bedrock starters for `spring-ai-starter-model-ollama`:

```yaml
spring:
  ai:
    model:
      chat: ollama
      embedding: ollama
    ollama:
      base-url: http://localhost:11434
      chat:
        model: qwen3:8b
      embedding:
        model: nomic-embed-text
```

The embedding model changes the vector's dimensions, so drop the `vector_store` table and re-index (G6.2). Ollama suits development: it serves one user well, but it is not built for many concurrent requests (unsourced).

## vLLM: the model server in production

**vLLM** is an open-source inference server built for throughput: it batches many users' requests together and stores the attention cache (the KV cache, values the model keeps for every token so far; see GPU sizing below) in small pages (**PagedAttention**), so one GPU serves many conversations at once. It exposes an OpenAI-compatible API, so any OpenAI client can call it.

```bash
vllm serve Qwen/Qwen3-8B \
  --max-model-len 16384 \
  --gpu-memory-utilization 0.90 \
  --tensor-parallel-size 1

curl http://localhost:8000/v1/chat/completions -H 'Content-Type: application/json' -d '{
  "model": "Qwen/Qwen3-8B",
  "messages": [{"role": "user", "content": "Summarize RAG in one sentence."}]
}'
```

The flags that size the server:

- `--max-model-len` — the longest context, prompt plus answer, the server accepts. It defaults to the model's own maximum; a lower value leaves memory for more parallel requests.
- `--gpu-memory-utilization` — the share of GPU memory vLLM may take, 0.92 by default. It loads the weights, then fills the rest of that share with KV cache.
- `--tensor-parallel-size` — the number of GPUs to split each layer across, for a model too large for one GPU.
- `--quantization` — the weight format, such as `awq` (a 4-bit weight quantization method); usually detected from the model's config.
- `--kv-cache-dtype fp8` — stores the KV cache in 8 bits, halving its size.
- `--port` — 8000 by default.

On Kubernetes, vLLM runs from the `vllm/vllm-openai` image. A trimmed version of the deployment in vLLM's docs:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: qwen3-8b
spec:
  replicas: 1
  selector:
    matchLabels:
      app: qwen3-8b
  template:
    metadata:
      labels:
        app: qwen3-8b
    spec:
      volumes:
        - name: model-cache
          persistentVolumeClaim:
            claimName: qwen3-8b-cache
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 2Gi
      containers:
        - name: vllm
          image: vllm/vllm-openai:latest
          command: ["/bin/sh", "-c"]
          args: ["vllm serve Qwen/Qwen3-8B --max-model-len 16384 --gpu-memory-utilization 0.90"]
          ports:
            - containerPort: 8000
          resources:
            limits:
              nvidia.com/gpu: "1"
          volumeMounts:
            - name: model-cache
              mountPath: /root/.cache/huggingface
            - name: shm
              mountPath: /dev/shm
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 60
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: qwen3-8b
spec:
  selector:
    app: qwen3-8b
  ports:
    - port: 80
      targetPort: 8000
```

What each part is for: the `Deployment` keeps `replicas` copies of the container running, and the `Service` gives them one stable address; `nvidia.com/gpu: "1"` asks the scheduler for a node (a machine in the cluster) with a free GPU; the volume at `/root/.cache/huggingface` keeps the downloaded weights across restarts; the in-memory `/dev/shm` is shared memory that vLLM needs when it splits a model across GPUs; the readiness probe keeps traffic away until the model has loaded, which takes minutes. Pin a version tag in production instead of `latest`.

The Spring AI app reaches it through the OpenAI starter, `spring-ai-starter-model-openai`, pointed at the Service. The property names below are the ones the Spring AI docs use for vLLM:

```yaml
spring:
  ai:
    model:
      chat: openai
    openai:
      base-url: http://qwen3-8b
      api-key: not-used
      chat:
        model: Qwen/Qwen3-8B
```

## PostgreSQL with pgvector

On-premises, PostgreSQL is yours to run: install the pgvector package for your PostgreSQL version on the database servers, or use the `pgvector/pgvector` container image, then enable it once per database with `CREATE EXTENSION vector;`. The capstone's schema, HNSW index, and chat memory table are unchanged (G1.7, G6.2). What the cloud did for you is now your runbook (the team's written operating procedures): backups and point-in-time recovery (restoring the database as it was at any chosen moment), a standby replica for failover (G1.5), upgrades, and monitoring.

## GPU sizing

A model server needs GPU memory, **VRAM**, for two things: the weights, and the **KV cache**, the keys and values the model has already computed for every token of every active request, kept so they are not recomputed for each new token (G3.1).

**VRAM ≈ P × b + KV cache**

- P — the number of parameters.
- b — bytes per parameter: 2 for FP16 or BF16 (16-bit floating-point formats), 1 for INT8 or FP8 (8-bit integer or float), about 0.5 for INT4 (4-bit integer); quantization in G6.8.
- KV cache — **2 × L × H_kv × d_head × b_kv × T**, where:
  - 2 — one key and one value per token;
  - L — the number of layers (`num_hidden_layers` in the model's `config.json`);
  - H_kv — the number of key-value heads (`num_key_value_heads`). Attention runs as several parallel **heads**, each with its own queries, keys, and values (G3.1 L2). Models with **grouped-query attention** share each key-value head among several query heads, so H_kv is smaller than the attention head count, and so is the cache;
  - d_head — the size of each head (`head_dim`);
  - b_kv — bytes per cached number, 2 for BF16, 1 with `--kv-cache-dtype fp8`;
  - T — the total tokens held at once: concurrent requests × tokens per request.

Add a margin, often 10–20% (unsourced), for activations (the intermediate values each layer computes) and the runtime.

**Worked example: Qwen3-8B in BF16.** From its `config.json` and model page: 8.19 billion parameters, 36 layers, 8 key-value heads, head size 128.

- Weights: 8.19 × 10⁹ × 2 bytes = **16.4 GB**.
- KV cache per token: 2 × 36 × 8 × 128 × 2 bytes = 147,456 bytes ≈ **0.15 MB**.
- Target load: 16 conversations at once, each up to 8,192 tokens, so T = 131,072 tokens. KV cache: 131,072 × 147,456 bytes = **19.3 GB**.
- Total: 16.4 + 19.3 = **35.7 GB**, before the margin.

A 48 GB GPU such as the NVIDIA L40S fits it: at `--gpu-memory-utilization 0.90` vLLM takes 43.2 GB, and 7.5 GB remain for activations. A 24 GB GPU does not, unless the model shrinks: the AWQ 4-bit build, `Qwen/Qwen3-8B-AWQ`, needs about 4.1 GB of weights (8.19 × 10⁹ × 0.5 bytes, plus a little for scales, the factors that map the 4-bit values back to real ones), and FP8 KV cache halves the 19.3 GB to 9.7 GB. Quantization trades some quality for this memory; measure it on your evaluation set (G6.5) before you ship it.

The formula also explains the flags: `--max-model-len` caps the tokens per request, and whatever memory the weights leave decides how many requests fit at once.

Sources: [Qwen3-8B model card and config.json](https://huggingface.co/Qwen/Qwen3-8B) · [Qwen3-8B-AWQ](https://huggingface.co/Qwen/Qwen3-8B-AWQ) · [Ollama API](https://docs.ollama.com/api) · [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) · [Ollama qwen3 tags](https://ollama.com/library/qwen3/tags) · [Spring AI — Ollama chat](https://docs.spring.io/spring-ai/reference/api/chat/ollama-chat.html) · [Spring AI — Ollama embeddings](https://docs.spring.io/spring-ai/reference/api/embeddings/ollama-embeddings.html) · [Spring AI — OpenAI chat (vLLM example)](https://docs.spring.io/spring-ai/reference/api/chat/openai-chat.html) · [vLLM — features (PagedAttention, continuous batching)](https://docs.vllm.ai/en/latest/) · [Kubernetes — scheduling GPUs](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/) · [vLLM — `vllm serve` flags](https://docs.vllm.ai/en/latest/cli/serve/) · [vLLM — OpenAI-compatible server](https://docs.vllm.ai/en/latest/serving/online_serving/) · [vLLM — Kubernetes](https://docs.vllm.ai/en/latest/deployment/k8s/) · [PagedAttention paper (Kwon et al.)](https://arxiv.org/abs/2309.06180) · [pgvector README](https://github.com/pgvector/pgvector) · [NVIDIA — KV cache size per token](https://developer.nvidia.com/blog/mastering-llm-techniques-inference-optimization/) · [Raschka — KV cache with grouped-query attention](https://sebastianraschka.com/llm-architecture-gallery/kv-cache-calculations/) · [GQA paper (Ainslie et al.)](https://arxiv.org/abs/2305.13245) · [NVIDIA L40S (48 GB)](https://www.nvidia.com/en-us/data-center/l40s/)
