---
title: Cloud vs on-premises
---

Where the system runs:

- **Cloud** — the servers belong to a provider such as AWS, rented by the hour, or by the token for a model API. The provider runs the hardware, and its managed services (G6.1) can run the models too.
- **On-premises** — the organization's own servers, in its own data center. It buys the hardware and runs everything on it, models included; those can only be **open-weight models** (G3.3), whose weights anyone can download. Proprietary models such as Claude are offered only as a service, through the maker's API or a cloud's (unsourced).
- **Hybrid** — some parts in each, joined by a private network. A bank may keep its documents and vector store on-premises and send only prompts to a cloud model. AWS Outposts goes the other way: AWS installs and runs its own racks in the customer's building, with the same APIs as an AWS Region (one of the geographic areas where AWS runs its data centers, such as Frankfurt).

The main trade-offs:

| Factor | Cloud | On-premises |
|---|---|---|
| **Data residency** — the rule that data stay inside a given country or site | pick a region; the data leaves the building. Some model APIs route requests to other regions unless the app pins a geography | the data never leaves the site |
| **Cost** | pay per use, nothing upfront; a high, steady load gets expensive | a large upfront hardware purchase plus staff; cheaper per request once the GPUs stay busy |
| **GPU availability** | available at once, within account quotas (usage limits the provider sets per account) and the region's capacity | ordered months ahead; a fixed capacity that cannot burst |
| **Latency** | a network round trip to the region on every call | close to the users and data, on the same network |
| **Compliance** | the provider secures the infrastructure; the customer secures its data and configuration (the **shared responsibility model**) | full control and full responsibility; the only option for an **air-gapped** site, one with no internet connection |
| **Models** | proprietary frontier models (the newest, most capable ones) and open-weight ones | open-weight models only |
| **Operations** | the provider patches, scales, and replaces hardware | the team does all of it |

A common rule of thumb: start in the cloud, and move a workload on-premises when regulation requires it, or when a steady, high GPU load makes owning the hardware cheaper than renting it.

Sources: [What is AWS Outposts?](https://docs.aws.amazon.com/outposts/latest/userguide/what-is-outposts.html) · [Bedrock cross-Region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html) · [Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html) · [AWS shared responsibility model](https://aws.amazon.com/compliance/shared-responsibility-model/)
