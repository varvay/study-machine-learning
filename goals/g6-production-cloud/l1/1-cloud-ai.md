---
title: One cloud's AI stack
---

Clouds sell AI at two levels:

- **Managed model API** — a service that hosts ready-made foundation models (large models pre-trained on broad data, usable for many tasks; G3) and bills per token (a piece of text of about 4 characters; G6.8). The app sends a prompt over HTTPS and gets the answer back; the provider runs the GPUs. The app picks from the service's catalog and can adapt a model only through the tuning options the service offers.
- **Managed ML platform** — a service for the whole life of the team's own models: notebooks (documents that mix runnable code with its output), training jobs on rented GPUs, a model registry (a catalog of trained model versions; G6.5), and **endpoints**, servers that host a trained model behind an API. The team brings the data and the training code; the platform runs the machines.

Which to use: a GenAI (generative AI) app starts on the model API, since it has nothing to run. The platform earns its place when the team trains or fine-tunes its own model (trains it further on its own examples; G4), or hosts an open-weight model (one whose weights anyone can download; G3.3) the API does not offer. The bills differ too: the model API charges per token, while a real-time endpoint on the platform charges for its instances (the rented virtual servers it runs on) by the hour while it runs, busy or idle.

| | AWS (chosen) | Azure | GCP |
|---|---|---|---|
| Managed model API | Amazon Bedrock | Microsoft Foundry (formerly Azure AI Foundry), which includes Azure OpenAI | Gemini Enterprise Agent Platform (formerly Vertex AI): Gemini models and Model Garden, its catalog of Google and third-party models |
| Managed ML platform | Amazon SageMaker AI | Azure Machine Learning | the same Gemini Enterprise Agent Platform: training jobs, endpoints, pipelines |

The names moved between 2024 and 2026, so an interviewer may still say Vertex AI, Azure AI Foundry, or SageMaker; they mean the services in this table.

**AWS in more detail.**

- **Amazon Bedrock** — AWS's managed model API: 100+ foundation models from Amazon (Nova), Anthropic (Claude), DeepSeek, OpenAI, xAI, and others, behind one API and one bill. Around the models it offers:
  - **Knowledge Bases** — managed RAG (retrieval-augmented generation: find the documents relevant to a question and add them to the prompt; G1.7). It connects to data sources such as S3 (AWS's file storage) or SharePoint (Microsoft's document-sharing service), chunks and embeds the documents (splits them into short pieces and turns each into a vector, a list of numbers that captures its meaning; G1.7), stores the vectors, retrieves the relevant chunks for a question, and returns answers with citations. It runs the offline half of the pipeline in G6.3 as a service.
  - **Guardrails** — filters applied to the user's input and the model's output: harmful content, denied topics, PII masking (hiding personal data such as names and emails), prompt attacks (inputs written to make the model ignore its instructions), and checks that an answer is grounded in the retrieved sources (G6.7).
  - **AgentCore** — services for running agents, LLMs that call tools in a loop to complete a task (G5): a serverless runtime (it runs the agent's code without the team managing servers), memory, a gateway that turns existing APIs into MCP tools (tools behind one standard protocol; G6.2), identity, and observability (recording what each request did; G6.6).
  - **Model customization** — fine-tuning, continued pre-training (further training on a domain's raw text), and distillation (training a smaller model to copy a larger one's answers) of supported models (G4.7).
- **Amazon SageMaker AI** — AWS's managed ML platform: build, train, and deploy models on managed infrastructure. It was called Amazon SageMaker until December 2024; that name now covers a wider platform for data, analytics, and AI that includes both SageMaker AI and Bedrock.

Sources: [What is Amazon Bedrock?](https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html) · [Bedrock Knowledge Bases](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html) · [Bedrock Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html) · [What is Amazon Bedrock AgentCore?](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html) · [What is Amazon SageMaker AI?](https://docs.aws.amazon.com/sagemaker/latest/dg/whatis.html) · [SageMaker AI pricing](https://aws.amazon.com/sagemaker/ai/pricing/) · [What is Microsoft Foundry?](https://learn.microsoft.com/en-us/azure/foundry/what-is-foundry) · [What is Azure Machine Learning?](https://learn.microsoft.com/en-us/azure/machine-learning/overview-what-is-azure-machine-learning) · [Gemini Enterprise Agent Platform (formerly Vertex AI)](https://cloud.google.com/products/gemini-enterprise-agent-platform)
