---
title: Fine-tuning datasets
---

L2 built a JSONL dataset: deduplicated, cleaned, filtered, split, with synthetic examples from a stronger model. At L3 the questions are how to prove the data is good, whether it covers the task, whether you may use it at all, and how to keep the eval honest.

Data quality decides the result more than size. QLoRA's authors found a 9,000-example dataset (OASST1, assistant conversations written and rated by volunteers) beat a 450,000-example one (a FLAN v2 subsample, academic NLP tasks rewritten as instructions) for chatbot quality, and LIMA reached strong results from 1,000 carefully curated examples. The reason is the loss: SFT trains the model to imitate every example with equal weight, so a wrong or sloppy example teaches the error as firmly as a good one teaches the task.

**Data quality audit.** An audit is a systematic check of the dataset against written criteria, before any training run. Four passes:

1. **Read a random sample** — 100 rows, each tagged with its defect, as in error analysis (G2.5): wrong answer, inconsistent format, truncated text, a refusal where an answer was due, facts a synthetic generator made up. The tag counts say which fix comes first.
2. **Automated checks over every row** — valid JSON against the schema; token counts against the training `max_length`, since rows over it are cut silently; exact and near duplicates; language; each row rendered through the model's chat template and back.
3. **Label consistency** — two people label the same 100 rows and you measure their agreement with **Cohen's kappa**, agreement corrected for what chance alone would produce (scikit-learn: `cohen_kappa_score`). Low agreement means the labeling guideline is ambiguous, and the model will learn the ambiguity.
4. **A model-assisted pass** — a strong model flags suspicious rows against the same criteria; a person decides each flag. The model finds candidates; it does not delete rows.

Synthetic data needs two extra checks. **Diversity** — generated examples repeat phrasings and skip hard cases, so measure distinct openings and n-grams (runs of n consecutive words) and compare them to real data. **Correctness** — the generator's mistakes become the student's, so verify outputs with rules (parse, execute, compare with the known answer) wherever the task allows.

**Task coverage and balance.** A **coverage matrix** lists the dimensions the task varies along and counts the examples in each cell. For ticket routing:

| Category | Short | Long | Other language | Ambiguous | Not a ticket |
|---|---|---|---|---|---|
| Billing | 180 | 60 | 12 | 20 | — |
| Technical | 220 | 140 | 5 | 35 | — |
| Account | 90 | 15 | 0 | 8 | — |
| Out of scope | — | — | — | — | 0 |

The empty and thin cells are the model's future failures: it will never output "out of scope" because it never saw it, and account tickets in other languages are a guess. Fill gaps with targeted collection or synthesis, then check the new rows against real ones.

- **Balance** — a class that dominates the data biases the model toward it, as with class imbalance (G2.3). Downsample it or weight the others, and report metrics per class.
- **Negative cases** — include inputs whose correct output is "none", "not found", or an abstention. Without them an extraction model always extracts something.
- **Output length** — the model learns the length distribution of the answers, so long answers in training become long answers in production.
- **Production mirror** — sample training inputs from real traffic logs, stratified by the matrix above, so the distribution matches what the model will see.

**Licensing.** Every source carries terms that follow the model:

- **The base model's license.** Llama 3.1's license requires anyone who distributes a model, or a product containing one, to display "Built with Llama"; a model trained or improved with Llama materials *or their outputs* must have "Llama" at the start of its name; and licensees with over 700 million monthly active users need a separate license from Meta.
- **Dataset licenses.** A dataset under CC BY-NC permits non-commercial use only, which rules it out for a client's product.
- **Generator outputs.** Some model providers' terms restrict using outputs to build competing models (unsourced here; read each provider's current terms before generating synthetic data).
- **Provenance** — record per row its source, license, collection date, and any consent. A licensing question months later is then a query, not an investigation.

**PII in training data.** PII (personally identifiable information) is any data that identifies a person: a name, a phone number, an email address. A model can memorize training text and repeat it: Carlini et al. extracted hundreds of verbatim sequences from GPT-2, including names, phone numbers, and email addresses, and found larger models more vulnerable. So:

- **Minimize** — keep only the fields the task needs.
- **Redact or pseudonymize before training** — detect PII with a tool such as Presidio, an open-source PII detection and anonymization library, and replace it with consistent fake values, so the format stays realistic while the person disappears.
- **Restrict the raw data** — access control and audit logs on the unredacted source (G6.7).
- **Plan for deletion** — a trained model cannot reliably forget one person's data except by retraining without it (unsourced). A versioned dataset and a cheap LoRA run make that retraining routine.

**Dataset versioning with DVC.** A model is reproducible only if you know exactly which data trained it. DVC (Data Version Control), an open-source tool, versions data next to code: `dvc add data/train.jsonl` moves the file into DVC's cache and writes a small `data/train.jsonl.dvc` pointer, which Git commits; `dvc push` uploads the data to remote storage such as S3; `git checkout <commit>` followed by `dvc checkout` restores the data of any past version. Record the Git commit, and with it the dataset version, in every training run (G4.6). Then you can reproduce a model, roll back a bad data change, and answer "was this person's record in the training data of the model we shipped in March?"

**Keeping eval data out of training.** **Contamination** is eval examples, or near copies, present in the training data. It inflates scores the way leakage does (G2.3), and fine-tuning makes it easy: synthetic examples generated from eval items, the same document split into chunks on both sides, one customer's tickets in both sets.

- **Split first** — carve out the eval set before deduplication, augmentation, or synthesis, and split by group: all rows of one document or customer on one side (G2.3).
- **Check overlap** — exact hashes, then near duplicates between the two sets. GPT-3's authors flagged any eval example sharing a 13-word sequence (a 13-gram) with training data. MinHash with locality-sensitive hashing finds near duplicates without comparing every pair. MinHash turns each text into a short signature whose overlap with another estimates how many of their 5-word shingles (overlapping word runs) the two share; locality-sensitive hashing indexes the signatures so similar ones land in the same bucket. The `datasketch` library provides both; `num_perm` is the signature length (longer is more accurate), and `threshold=0.8` flags pairs whose estimated Jaccard similarity (shared shingles ÷ all distinct shingles of the two) is about 0.8 or more:

```python
from datasketch import MinHash, MinHashLSH

def shingles(text: str, size: int = 5) -> set[str]:
    words = text.lower().split()
    return {" ".join(words[i : i + size]) for i in range(len(words) - size + 1)} or {" ".join(words)}

def minhash_of(text: str) -> MinHash:
    signature = MinHash(num_perm=128)
    for shingle in shingles(text):
        signature.update(shingle.encode("utf8"))
    return signature

train_index = MinHashLSH(threshold=0.8, num_perm=128)
for row_id, text in train_rows.items():
    train_index.insert(row_id, minhash_of(text))

contaminated = {eval_id: hits for eval_id, text in eval_rows.items() if (hits := train_index.query(minhash_of(text)))}
```

- **Freeze and guard the eval set** — version it separately, restrict who can read it, and never use it to generate training data. Add fresh eval items over time, since production drifts (G2.6).

**In an interview**

- *How do you know your fine-tuning data is good enough?* I audit it before training: read a random sample of about 100 rows and tag the defects, run automated checks on every row for schema, length against the context limit, and duplicates, and measure labeler agreement on a shared subset. I also build a coverage matrix of categories against input types, so gaps and imbalance are visible before they become failures. Data is good enough when the audit's defect rate is low and every cell the product needs has examples; then the eval decides.
- *How do you make sure your eval isn't contaminated?* I split before any augmentation or synthetic generation, and split by group so one document or customer never appears on both sides. Then I check overlap with exact hashes and MinHash near-duplicate search, and remove any training row that matches an eval row. The eval set is versioned and access-controlled, and nothing is ever generated from it.

Sources: [Dettmers et al., QLoRA paper (OASST1 vs FLAN v2)](https://arxiv.org/abs/2305.14314) · [Zhou et al., LIMA](https://arxiv.org/abs/2305.11206) · [scikit-learn — `cohen_kappa_score`](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.cohen_kappa_score.html) · [Llama 3.1 Community License](https://github.com/meta-llama/llama-models/blob/main/models/llama3_1/LICENSE) · [Creative Commons — CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) · [Carlini et al., Extracting Training Data from Large Language Models](https://arxiv.org/abs/2012.07805) · [Presidio](https://github.com/data-privacy-stack/presidio) · [DVC — Get started](https://doc.dvc.org/start) · [Brown et al., GPT-3 paper (13-gram contamination check)](https://arxiv.org/abs/2005.14165) · [datasketch — MinHash LSH](https://ekzhu.com/datasketch/lsh.html)
