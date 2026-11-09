---
title: One cloud's AI stack
---

A consulting design answer is a chain: the client's constraints, the decision each one forces, and the number that proves it fits.

**The brief.** An EU insurer wants an internal assistant that answers questions from 200,000 policy and claims documents, with citations, for 2,000 claims handlers. The documents hold personal data. Four constraints come with it:

- **Residency** — data and processing stay in the EU.
- **Private network** — no traffic crosses the public internet.
- **Single sign-on** — staff log in with the corporate identity provider (the system that holds the staff accounts), and each sees only the documents they may read (G6.7).
- **Budget** — a monthly cost estimate before the pilot.

| Constraint | Decision | Why |
|---|---|---|
| EU residency | Region eu-central-1 (Frankfurt); Claude through Bedrock's **EU geographic inference profile** | A geographic profile keeps processing inside the EU; a global one may route anywhere |
| No public internet | VPC (virtual private cloud: the client's own isolated network inside AWS) with private subnets only, address ranges with no route to the internet; **interface VPC endpoints** for Bedrock and the other AWS APIs; Direct Connect (a dedicated line from the client's site to AWS) or VPN (an encrypted tunnel) to the client | The app reaches AWS services through private IPs in its own subnets |
| Personal data | Guardrails PII masking on input and output; KMS encryption (AWS Key Management Service holds and controls the encryption keys); invocation logging off, or on with the same controls as the database | Every copy of a prompt is another copy of the personal data |
| Per-user permissions | ACL (access control list) groups as chunk metadata, filtered at query time in PostgreSQL | Retrieval must never return a chunk the user may not read (G6.7) |
| Cost | Pay-per-token model API, Aurora PostgreSQL with pgvector, ECS Fargate (ECS's serverless mode: AWS runs the machines under the containers) for the app | Nothing to run for the model; the database is the capstone's store (G1.8) |

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 390" role="img" aria-labelledby="cloud-ai-architecture-title">
<title id="cloud-ai-architecture-title">Client architecture on AWS: the client network reaches an internal load balancer in a private VPC in Frankfurt; the Spring AI app and the ingestion job use Aurora and reach Bedrock and S3 only through VPC endpoints; Bedrock's EU profile may process requests in other EU Regions</title>
<rect class="table-outline" x="150" y="20" width="600" height="360" rx="10" />
<text class="table-name" x="162" y="40">AWS Region eu-central-1 (Frankfurt)</text>
<rect class="table-outline" x="162" y="52" width="372" height="252" rx="8" />
<text class="note" x="174" y="70">VPC: private subnets in 2 AZs, no internet gateway, no NAT</text>
<rect class="fold-train" x="10" y="84" width="110" height="80" rx="8" /><text class="table-name" x="65" y="106" text-anchor="middle">client network</text><text class="key-tag" x="65" y="126" text-anchor="middle">claims handlers</text><text class="key-tag" x="65" y="144" text-anchor="middle">corporate IdP (SSO)</text>
<text class="note" x="10" y="186">Direct Connect or VPN</text>
<path class="key-link" d="M120,113 H176" />
<rect class="fold-train" x="176" y="90" width="104" height="46" rx="8" /><text class="table-name" x="228" y="110" text-anchor="middle">internal ALB</text><text class="key-tag" x="228" y="127" text-anchor="middle">TLS, OIDC login</text>
<path class="key-link" d="M280,113 H298" />
<rect class="fold-test" x="298" y="90" width="112" height="46" rx="8" /><text class="table-name" x="354" y="110" text-anchor="middle">Spring AI app</text><text class="key-tag" x="354" y="127" text-anchor="middle">ECS Fargate × 2</text>
<path class="key-link" d="M354,136 V170" />
<rect class="fold-train" x="298" y="170" width="112" height="46" rx="8" /><text class="table-name" x="354" y="190" text-anchor="middle">Aurora PostgreSQL</text><text class="key-tag" x="354" y="207" text-anchor="middle">pgvector, 2 AZs</text>
<rect class="fold-train" x="176" y="170" width="104" height="46" rx="8" /><text class="table-name" x="228" y="190" text-anchor="middle">ingestion job</text><text class="key-tag" x="228" y="207" text-anchor="middle">sync, chunk, embed</text>
<path class="key-link" d="M280,193 H298" />
<path class="key-link" d="M410,113 H428" />
<path class="key-link" d="M228,216 V262 H476 V238" />
<rect class="fold-train" x="428" y="86" width="96" height="152" rx="8" /><text class="table-name" x="476" y="106" text-anchor="middle">VPC endpoints</text><text class="key-tag" x="476" y="128" text-anchor="middle">bedrock-runtime</text><text class="key-tag" x="476" y="148" text-anchor="middle">secretsmanager</text><text class="key-tag" x="476" y="168" text-anchor="middle">logs, sts</text><text class="key-tag" x="476" y="188" text-anchor="middle">ecr.api, ecr.dkr</text><text class="key-tag" x="476" y="212" text-anchor="middle">S3 (gateway)</text>
<path class="key-link" d="M524,120 H560" />
<path class="key-link" d="M524,208 H560" />
<rect class="fold-test" x="560" y="86" width="178" height="70" rx="8" /><text class="table-name" x="649" y="108" text-anchor="middle">Amazon Bedrock</text><text class="key-tag" x="649" y="127" text-anchor="middle">Claude via the EU profile</text><text class="key-tag" x="649" y="145" text-anchor="middle">Guardrails, Titan embeddings</text>
<rect class="fold-train" x="560" y="186" width="178" height="46" rx="8" /><text class="table-name" x="649" y="206" text-anchor="middle">S3 documents</text><text class="key-tag" x="649" y="223" text-anchor="middle">SSE-KMS, versioning on</text>
<path class="key-link" d="M700,156 V262" />
<rect class="fold-train" x="600" y="262" width="138" height="46" rx="8" /><text class="table-name" x="669" y="282" text-anchor="middle">other EU Regions</text><text class="key-tag" x="669" y="299" text-anchor="middle">inference may run here</text>
<rect class="fold-train" x="162" y="320" width="576" height="44" rx="8" /><text class="key-tag" x="450" y="347" text-anchor="middle">KMS keys · Secrets Manager · CloudTrail · CloudWatch logs and metrics · IAM task roles with least privilege</text>
</svg>
</div>
<figcaption>Every call from the app or the ingestion job to an AWS API leaves through a VPC endpoint in its own subnet. Only Bedrock's inference may leave Frankfurt, and only for other EU Regions.</figcaption>
</figure>

**Private networking.** An **interface VPC endpoint** (AWS PrivateLink) is a network interface with a private IP in the VPC's subnets that forwards to one AWS service. Bedrock has five: `bedrock` (control plane, the API that creates and manages resources), `bedrock-runtime` (inference), `bedrock-mantle` (inference through OpenAI- and Anthropic-compatible APIs), `bedrock-agent`, and `bedrock-agent-runtime`. With **private DNS** on, the SDK's default hostname, `bedrock-runtime.eu-central-1.amazonaws.com`, resolves to the endpoint, so the code needs no change. Three details carry the design:

- **Endpoint policy** — an IAM policy attached to the endpoint. The default allows all Bedrock actions; restrict it to `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` on the approved model and inference profile ARNs. Even a stolen credential then cannot use another model through this path.
- **No NAT gateway** (the gateway that lets private subnets reach the internet) — the subnets have no route to the internet at all. Anything the app forgot to reach through an endpoint fails in testing, which is how the gap is found. Fargate needs `ecr.api`, `ecr.dkr`, and the S3 gateway endpoint to pull its image, and `logs` to ship logs; S3's gateway endpoint costs nothing. STS (Security Token Service, which issues the role's short-lived credentials) and Secrets Manager each need an interface endpoint too.
- **Cost** — interface endpoints bill per endpoint per Availability Zone (AZ, one of a Region's physically separate data centers) per hour, plus per GB. Six endpoints in two AZs are part of the estimate below.

**Region and data residency.** In Frankfurt, the Bedrock price list sells the current Claude models for **cross-Region inference**: an **inference profile** names a model and the Regions a request may be routed to, and the app sends the profile's ID as its model ID.

- A **geographic profile** (ID prefix `eu.`, `us.`, `apac.`…) routes only within that geography. Stored data stays in the source Region, but prompts and answers may be processed in another EU Region, and where a model requires storage for abuse detection, it happens in the destination Region.
- A **global profile** routes to any commercial Region for about 10% less. It fails the EU constraint, so it is out.
- Traffic between Regions stays on the AWS network, and CloudTrail (AWS's audit log of API calls) records the Region that processed each request in `additionalEventData.inferenceRegion`, which is the evidence for an audit.
- If the client says "Germany only", the EU profile fails too. The options become a model offered in-Region without a profile, a self-hosted model on SageMaker AI or EC2 in Frankfurt (G6.4), or the AWS European Sovereign Cloud, a separate partition (an AWS environment with its own accounts and Regions, isolated from the global one) whose first Region, `eusc-de-east-1` in Brandenburg, opened in January 2026 with Bedrock available.
- Model providers have no access to prompts: Bedrock runs each provider's model in AWS-owned deployment accounts.
- **Model invocation logging** is off by default. When on, it writes full prompts and answers to CloudWatch Logs (AWS's log service) or S3, including text that Guardrails blocked, in plain text. So the log store gets the same KMS key, access policy, and retention as the documents, or it stays off and the app logs token counts only.
- A Service Control Policy (an organization-wide rule that caps what every account in it may do) that denies non-EU Regions must still allow the profile's EU destination Regions, or exempt calls that carry the `bedrock:InferenceProfileArn` condition key; otherwise cross-Region inference fails.

**Quotas.** Bedrock limits each model per Region in **requests per minute (RPM)** and **tokens per minute (TPM)**, with separate quotas for cross-Region profiles, visible and raised in Service Quotas. Two rules make naive sizing wrong:

- **Reservation at the start.** A request first reserves `input tokens + max_tokens` against TPM and is throttled (rejected with a "slow down" error) if that does not fit; the unused part is returned at the end. A generous `max_tokens` lowers concurrency even when answers are short.
- **Burndown rate.** Output tokens count several times against the quota: 5× for Claude models up to version 4.7, 10× for Claude Sonnet 5, Opus 5, and Opus 5.5, 15× for Opus 4.8. The docs do not yet list Sonnet 5.5, so the plan assumes 10× and confirms it in the Service Quotas console. Cache reads from prompt caching do not count.

Sizing for this client: 2,000 handlers × 15 questions a day over an 8-hour day is 62.5 requests per minute on average; plan for 3× at peak, about 190 RPM. Each request has 3,500 input and 400 output tokens, so it consumes 3,500 + 400 × 10 = 7,500 quota tokens, and the peak needs 190 × 7,500 ≈ 1.4 million TPM. That number, with the burndown math, goes into the quota increase request before go-live. The app still handles `ThrottlingException`: the AWS SDK retries throttling errors with exponential backoff (a wait that doubles after each failure), and once its attempts run out, the app answers from a smaller model or queues the question (G6.8).

**Cost estimate.** The assumptions come first, because the client will change them:

- 2,000 users × 15 questions × 21 working days = **630,000 requests a month**.
- Per request: 3,500 input tokens (600 of instructions, 5 chunks × 500, 400 of history and question) and 400 output tokens.
- Prices are Frankfurt on-demand from the AWS Price List API (September 2026). The EU geographic price is 10% above the global one: Claude Sonnet 5.5 is $2.20 / $11 per million input / output tokens here, against $2 / $10 globally.

| Item | Calculation | Per month |
|---|---|---|
| Claude Sonnet 5.5, input | 2,205 M tokens × $2.20 / M | $4,851 |
| Claude Sonnet 5.5, output | 252 M tokens × $11 / M | $2,772 |
| Query embeddings, Titan Text Embeddings V2 | 18.9 M tokens × $0.20 / M | $4 |
| Guardrails | content + PII filters on each question (1 text unit, $0.15 + $0.10 per 1,000); PII on each answer (2 units × $0.10 per 1,000) | $284 |
| Aurora PostgreSQL | 2 × db.r7g.large (writer + reader) × $0.333 / h × 730 h; about 12 GB storage at $0.119 / GB | $488 |
| App | 2 Fargate tasks × (1 vCPU at $0.04656 / h + 2 GB at $0.00511 / GB-h) × 730 h | $83 |
| VPC endpoints | 6 endpoints × 2 AZs × $0.012 / h × 730 h | $105 |
| **Total** | about **$0.0136 per question** | **≈ $8,590** |

A **text unit** of Guardrails is up to 1,000 characters. Embedding the corpus once (200,000 documents × 3,000 tokens) costs about $120. Aurora I/O, Direct Connect, CloudWatch, and support are left out and named as such in the proposal.

What the table says: tokens are **89%** of the bill, so the levers are all in G6.8. Caching the 600-token instruction block cuts input cost by about $750 a month (cache reads cost $0.22 instead of $2.20 per million). Routing easy questions to Claude Haiku 4.5 at half the price cuts more. Cutting from 5 chunks to 3 removes 1,000 of the 3,500 input tokens, if the eval set shows no loss.

**The other two clouds.**

| Need | AWS | Azure | GCP |
|---|---|---|---|
| Private access to the model API | Interface VPC endpoints (PrivateLink) | Private endpoints (Private Link) on the Foundry resource, public access disabled | Private Service Connect endpoint; VPC Service Controls perimeter blocks public access |
| Keep processing in the EU | EU geographic inference profile | **Data Zone Standard** deployment in an EU resource: processing stays within the EU Data Boundary, Microsoft's commitment to store and process EU customers' data in the EU | Regional endpoints, under the AI/ML data location terms |
| Quotas | RPM and TPM per model per Region, with output burndown | TPM per deployment | Per-model quotas per Region |

Sources: [Bedrock interface VPC endpoints](https://docs.aws.amazon.com/bedrock/latest/userguide/vpc-interface-endpoints.html) · [bedrock-mantle endpoint](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html) · [PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/) · [Cross-Region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html) · [Geographic cross-Region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html) · [Bedrock data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html) · [Model invocation logging](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html) · [Guardrails filters](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-components.html) · [How tokens are counted (burndown)](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-token-burndown.html) · [AWS SDK retry behavior](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html) · [ECR interface endpoints for Fargate](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html) · [Gateway endpoints (no charge)](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html) · [AWS Price List (offer files AmazonBedrock, AmazonBedrockFoundationModels, AmazonRDS, AmazonECS, AmazonVPC for eu-central-1)](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html) · [Amazon Bedrock pricing (text units)](https://aws.amazon.com/bedrock/pricing/) · [Opening the AWS European Sovereign Cloud](https://aws.amazon.com/blogs/aws/opening-the-aws-european-sovereign-cloud) · [Microsoft Foundry network isolation](https://learn.microsoft.com/en-us/azure/foundry/how-to/configure-private-link) · [Foundry deployment types (Data Zone)](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types) · [Vertex AI with VPC Service Controls](https://cloud.google.com/vertex-ai/docs/general/vpc-service-controls) · [Private Service Connect for generative AI](https://cloud.google.com/vertex-ai/docs/general/vertex-psc-gen-ai) · [Google Cloud data residency terms](https://cloud.google.com/terms/data-residency)

**In an interview**

- *The client says no data may leave Germany. Does your design hold?* Not as drawn: the EU inference profile may process a prompt in another EU Region, and the CloudTrail field `inferenceRegion` would show it. I would check which models Bedrock serves in Frankfurt without a profile; if the model we need is not one of them, the choices are an open-weight model self-hosted in Frankfurt, or the AWS European Sovereign Cloud in Brandenburg. Each changes the model and the cost, so I would put a re-run eval and a new estimate beside the option.
- *Your load test throttles at 60% of the TPM quota. Why?* Bedrock reserves input tokens plus `max_tokens` when a request starts, and counts each output token several times, 10× for Claude Sonnet 5 and Opus 5.5. If `max_tokens` is 4,000 and answers average 400 tokens, the reservations throttle us long before real usage fills the quota. I would lower `max_tokens` to just above the longest answers we see, cache the fixed prompt prefix, and request the increase with the burndown math attached.
