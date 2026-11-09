---
title: Cloud vs on-premises
---

**Total cost of ownership (TCO)** is every cost of running a system over its planned life, usually three years: hardware or cloud bills, but also power, space, software licences, and the people who operate it. Comparing a cloud invoice with a server's purchase price leaves most of the on-premises cost out, and comparing two models' prices leaves out whether they answer equally well.

**A worked TCO for the G6.1 client.** The workload is the same: 630,000 questions a month, 3,500 input and 400 output tokens each, 2.2 billion input and 0.25 billion output tokens a month. Only the model serving differs; the database, app, and network are the same in all three options and are left out.

- **A: Bedrock, pay per token.** Claude Sonnet 5.5 at the Frankfurt EU price: $7,623 a month (G6.1).
- **B: self-hosted on AWS.** An open-weight model of about 70B parameters on two `g6e.12xlarge` instances, each with 4 NVIDIA L40S GPUs (48 GB each, 192 GB per instance), two for availability, at $13.12 an hour each in Frankfurt.
- **C: on-premises.** The same two 4-GPU servers, bought. The cloud prices below are from the AWS Price List; every on-premises figure is an assumption to replace with the client's quotes, and is marked as such.

| 3-year cost | A: Bedrock | B: GPUs on AWS | C: on-premises |
|---|---|---|---|
| Model serving | $7,623 × 36 = **$274,000** | 2 × $13.12 × 730 h × 36 = **$690,000** | 2 servers × $60,000 = $120,000 (assumed) |
| Power | in the price | in the price | 2 × 2.4 kW × PUE 1.5 × 26,280 h × $0.25 / kWh = $47,000 (assumed) |
| Space | in the price | in the price | $1,500 a month of rack space = $54,000 (assumed) |
| Operations staff | small | 0.5 engineer = $225,000 (assumed $150,000 a year) | 0.5 engineer = $225,000 (assumed) |
| Software and support | in the price | small | $20,000 a year = $60,000 (assumed) |
| **Total** | **≈ $274,000** | **≈ $915,000** | **≈ $506,000** |

- **PUE (power usage effectiveness)** — a data center's total power divided by the power its IT equipment uses. At 1.5, every kilowatt a server draws costs 1.5 kW including cooling. The 2.4 kW per server is 4 × 350 W, the L40S's maximum power, plus about 1 kW for the rest of the server (assumed).
- **Why B loses** — the GPUs bill for every hour, while this load uses them during office hours only. Running them 10 hours a day on working days cuts B's serving cost from $19,155 to about $5,500 a month, below A's token bill; the half engineer still makes B the most expensive. B earns its place when no managed API offers the model, or the model is fine-tuned (G4).
- **Why C loses here** — about $14,100 a month of mostly fixed cost against $7,600 of tokens. C breaks even at about 1.85 times today's volume, and only if the two servers can carry that load at the latency target, which only a load test can show. Staff is 44% of C's cost, so a client with an existing GPU platform team sees a different number.
- **Quality first** — the comparison is fair only if the open-weight model passes the same evaluation gate as Claude (G6.5). When it answers correctly 80% of the time against Claude's 90%, compare **cost per correct answer**, and price in the human work the extra wrong answers cause.
- **Money over time** — A has no upfront cost and scales down with a failed pilot. C spends $120,000 on day one and is sized for a load that is still a guess. Buying capacity before the demand is proven is the largest risk in C, beyond anything in the table.

The TCO flips toward C at a sustained, high, and predictable load: many millions of requests a month, steady around the clock, on a model the organization can host. Pay-per-token wins at low and uneven load, and when the best model is proprietary.

**Regulated and air-gapped environments.** A **regulated** environment is one where law or contract restricts where data goes and who may operate the systems: banks, health care, the public sector. An **air-gapped** environment has no network connection to the outside at all. They lead to different designs:

- **Regulated, cloud allowed** — the G6.1 controls usually suffice: EU Region, geographic inference profile, private endpoints, customer-managed keys (encryption keys the client controls in KMS), audit logs. Where the rule is also about who operates the cloud, the AWS European Sovereign Cloud fits: a separate partition, operated only by EU residents in the EU, with Bedrock available, in its first Region `eusc-de-east-1` since January 2026.
- **Air-gapped** — only self-hosted, open-weight models are possible, and every piece of software crosses the gap on approved media:
  - **Model weights** — downloaded outside, scanned, checksummed (a hash recorded to prove the file arrives unchanged), reviewed for licence terms, and carried in. Inside, `HF_HUB_OFFLINE=1` stops Hugging Face libraries (Hugging Face is the main hub for downloading open models) from making any HTTP call, so nothing silently tries to download.
  - **Images and packages** — a local container registry and package mirror. NVIDIA documents an air-gapped install of its GPU Operator (the Kubernetes add-on that installs the GPU drivers and device plugin) from a local registry and package repository.
  - **Supply chain** — OWASP lists supply-chain risks (LLM03:2025) and data and model poisoning (LLM04:2025): a tampered weight file is a real threat, so the import process verifies signatures or hashes against the publisher's.
  - **Updates** — every new model, patch, or eval set goes through the same import. Plan releases quarterly, not weekly, and keep the eval set on-site, since the evaluator also runs inside the gap.
  - **Observability** — traces, metrics, and the LLM judge (G6.6) all run inside; no SaaS (software as a service, hosted by its vendor) observability tool is reachable.

**Hybrid patterns.** A hybrid design splits the system across both, and each split has a cost:

| Pattern | What runs where | Trade-off |
|---|---|---|
| **Data on-premises, model in the cloud** | documents and vector store in the client's data center; only prompts, with retrieved chunks, go to Bedrock over Direct Connect | the chunks still leave the building; redact personal data before the call (G6.7) and accept a network round trip per request |
| **Route by data class** | sensitive requests go to a model on-premises, the rest to a cloud model | two models to evaluate and operate; the classifier that routes becomes a security control, and its mistakes are leaks |
| **Cloud burst** | on-premises GPUs carry the base load; the cloud takes the peaks | on-premises is sized for the average, not the peak; both paths must give answers of the same quality and meet the same residency rules |
| **Train in the cloud, serve on-premises** | fine-tuning on rented GPUs (G4), serving on owned ones | the training data leaves the site, so it must be allowed to or be anonymized; the tuned weights are carried back in |
| **AWS inside the building** | AWS Outposts racks in the client's data center, with AWS APIs | AWS runs the hardware on site, but only a listed subset of services runs locally, such as EC2, EKS nodes, RDS, and S3; Bedrock is not among them, so a local model is self-hosted on the Outpost's EC2 capacity, and the Outpost depends on its service link, the network connection back to its AWS Region |

Sources: [AWS Price List (EC2 and Bedrock offers for eu-central-1)](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html) · [NVIDIA L40S specifications](https://www.nvidia.com/en-us/data-center/l40s/) · [Opening the AWS European Sovereign Cloud](https://aws.amazon.com/blogs/aws/opening-the-aws-european-sovereign-cloud) · [Hugging Face environment variables (`HF_HUB_OFFLINE`)](https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables) · [NVIDIA GPU Operator air-gapped install](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/install-gpu-operator-air-gapped.html) · [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/) · [What is AWS Outposts?](https://docs.aws.amazon.com/outposts/latest/userguide/what-is-outposts.html)

**In an interview**

- *The client's CFO says owning GPUs is cheaper than paying per token. How do you answer?* It can be, at a high and steady load, so I would put both on a three-year TCO rather than argue. For their 630,000 questions a month, tokens cost about $274,000 over three years; two owned GPU servers cost about $506,000 once power, space, support, and half an engineer are counted, and break even only near twice the volume. I would also compare cost per correct answer, since the open-weight model must pass the same eval set first.
- *The client is air-gapped. What changes in your design?* Every model is open-weight and self-hosted, and every artifact, from weights to container images to eval sets, crosses the gap through a controlled import with checksums or signatures and a licence review. Libraries run in offline mode so nothing tries to reach the internet, and observability and the LLM judge run inside. Releases slow to the import cadence, so I would design the eval gate and the rollout around a quarterly cycle.
