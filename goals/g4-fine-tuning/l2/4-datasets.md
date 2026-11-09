---
title: Fine-tuning datasets
---

Recap (G4.4 L1): an example is an instruction with its ideal output, written as chat messages, and a few hundred clean examples beat thousands of noisy ones. In practice, a dataset is a JSONL file built by a small pipeline: normalize, filter, dedupe, split, write.

**JSONL** (JSON Lines) is a text file with one complete JSON object per line. It streams line by line and appends cheaply, and every trainer and managed service here reads it: TRL, Bedrock (AWS's hosted-model service), OpenAI, Vertex (Google Cloud's AI platform) (G4.7). One example of the capstone routing task (G4.1) in TRL's conversational prompt-completion format (G4.3):

```json
{"prompt": [{"role": "system", "content": "Route the question to a study goal. Reply with JSON only: {\"goal\": \"G1\"-\"G7\", \"type\": \"define\" | \"how-to\" | \"compare\" | \"debug\"}."}, {"role": "user", "content": "When should I pick IVF over HNSW?"}], "completion": [{"role": "assistant", "content": "{\"goal\": \"G1\", \"type\": \"compare\"}"}]}
```

- **Use one system prompt everywhere.** The same text goes in every example and at inference; Amazon's Nova guide recommends this "during both training and inference to achieve the best results."
- **Make the target consistent.** Use the same keys, in the same order, with the same spacing. The model copies the format of its targets exactly, inconsistencies included.

**Quality checks**, each a cheap filter:

| Check | Why it matters |
|---|---|
| empty or very short inputs | they teach nothing |
| inputs longer than `max_length` tokens | the trainer truncates them and can cut off the answer being trained |
| labels outside the allowed set | a typo such as `"G8"` becomes a class the model learns to produce |
| the same input with different labels | the model is trained toward both answers; fix the label or drop the example |
| exact and near duplicates | repeats overweight some examples, and a duplicate across train and test inflates the test score (data leakage, G2.3) |
| personal data | a model can repeat its training data; redact or drop it (G6.7) |

**The pipeline**: read raw labeled rows, normalize, filter, dedupe, split, and write three JSONL files.

```python
import hashlib
import json
import random
import re
from collections import defaultdict

SYSTEM_PROMPT = 'Route the question to a study goal. Reply with JSON only: {"goal": "G1"-"G7", "type": "define" | "how-to" | "compare" | "debug"}.'
GOALS = {f"G{number}" for number in range(1, 8)}
TYPES = {"define", "how-to", "compare", "debug"}


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def load_rows(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as file:
        return [{**row, "question": normalize(row["question"])} for row in map(json.loads, file)]


def is_valid(row: dict) -> bool:
    return 10 <= len(row["question"]) <= 1000 and row["goal"] in GOALS and row["type"] in TYPES


def fingerprint(question: str) -> str:
    return hashlib.sha256(question.lower().encode()).hexdigest()


def deduplicate(rows: list[dict]) -> list[dict]:
    label_by_fingerprint = {}
    unique_rows = []
    for row in rows:
        key, label = fingerprint(row["question"]), (row["goal"], row["type"])
        if key not in label_by_fingerprint:
            label_by_fingerprint[key] = label
            unique_rows.append(row)
        elif label_by_fingerprint[key] != label:
            print("conflicting labels, fix by hand:", row["question"])
    return unique_rows


def stratified_split(rows: list[dict], validation_share=0.1, test_share=0.1, seed=42):
    rows_by_goal = defaultdict(list)
    for row in rows:
        rows_by_goal[row["goal"]].append(row)
    train, validation, test = [], [], []
    shuffler = random.Random(seed)
    for group in rows_by_goal.values():
        shuffler.shuffle(group)
        test_count = round(len(group) * test_share)
        validation_count = round(len(group) * validation_share)
        test.extend(group[:test_count])
        validation.extend(group[test_count:test_count + validation_count])
        train.extend(group[test_count + validation_count:])
    return train, validation, test


def to_example(row: dict) -> dict:
    answer = json.dumps({"goal": row["goal"], "type": row["type"]})
    return {
        "prompt": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": row["question"]}],
        "completion": [{"role": "assistant", "content": answer}],
    }


def write_jsonl(path: str, rows: list[dict]) -> None:
    with open(path, "w", encoding="utf-8") as file:
        for row in rows:
            file.write(json.dumps(to_example(row), ensure_ascii=False) + "\n")


rows = deduplicate([row for row in load_rows("labeled_questions.jsonl") if is_valid(row)])
train, validation, test = stratified_split(rows)
for name, split in [("train", train), ("val", validation), ("test", test)]:
    write_jsonl(f"{name}.jsonl", split)
    print(name, len(split))
```

- **Dedupe before splitting**, so no question lands in both train and test.
- **Stratify the split**: shuffle within each goal, so every split keeps the same class mix (G2.3). The Hugging Face `datasets` library does the same with `Dataset.train_test_split(test_size=0.1, seed=42)`.
- **Near duplicates** ("How does HNSW work?" and "how does hnsw work??") pass an exact hash. Catch them by normalizing harder (lowercase, strip punctuation), or by comparing embeddings and dropping pairs above a cosine similarity threshold (G1.7).
- **Freeze the test split.** Write it once, never train on it, and never tune on it. It is the only honest score you get (G4.5).

**Synthetic examples** are examples written by a stronger model, the **teacher**, to fill gaps in real data. For a classification task, the label comes free: ask for questions of a given class, and the class you asked for is the label. On AWS, the teacher runs through the Bedrock Converse API, one request format for chatting with any Bedrock model, called from boto3, AWS's Python SDK:

```python
import json

import boto3

bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
TEACHER_MODEL_ID = "<a strong model enabled in your Bedrock account>"


def generate_questions(goal_topic: str, question_type: str, count: int) -> list[str]:
    request = (
        f"Write {count} different questions a student might ask about {goal_topic}. "
        f"Each must be a '{question_type}' question. Vary wording, length, and difficulty. "
        "Return only a JSON array of strings."
    )
    response = bedrock.converse(
        modelId=TEACHER_MODEL_ID,
        messages=[{"role": "user", "content": [{"text": request}]}],
        inferenceConfig={"temperature": 0.9, "maxTokens": 2000},
    )
    return json.loads(response["output"]["message"]["content"][0]["text"])
```

- **Seed diversity** by calling it once per (topic, type) pair with a high temperature, the sampling setting that makes output more varied (G3.2 L1), instead of one big request that drifts into repeats.
- **Filter the output** with the same pipeline: validity, dedupe against the real rows, and a human read of a random sample.
- **Tag provenance** with a field such as `"source": "synthetic"`, so you can compare a run with and without synthetic data.
- **Keep the test set real.** Synthetic data sounds like its teacher, and a test set made of it measures how well the student imitates the teacher.

**How much data.** A narrow task often needs hundreds to a few thousand good examples (unsourced rule of thumb). Vendor guidance sits at the low end of that range:

- OpenAI requires at least 10 examples and suggests starting with about 50.
- Amazon Nova recommends "at least 100 samples for each task", and says "a few hundred high-quality, consistent examples typically outperform thousands of noisy or contradictory ones."
- Google's Gemini tuning guide suggests starting with about 100.

The reliable test is a **learning curve**: train on 25%, 50%, and 100% of the data and score each run on the fixed test set. If the score is still climbing at 100%, more data will help; if it has flattened, spend the effort on quality.

**Count tokens** to predict cost and to set `max_length`. Managed services bill training by tokens × epochs (G4.7).

```python
from transformers import AutoTokenizer

tokenizer = AutoTokenizer.from_pretrained("Qwen/Qwen3-4B-Instruct-2507")


def token_count(example: dict) -> int:
    return len(tokenizer.apply_chat_template(example["prompt"] + example["completion"])["input_ids"])
```

In Transformers 5, `apply_chat_template` tokenizes and returns a dict by default, so the token ids sit under `"input_ids"`. Take the largest count in the data and set `max_length` just above it.

Sources: [JSON Lines](https://jsonlines.org/) · [Amazon Nova — Preparing data for fine-tuning](https://docs.aws.amazon.com/nova/latest/userguide/fine-tune-prepare-data-understanding.html) · [Amazon Bedrock — Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) · [Hugging Face Datasets — Process (`train_test_split`)](https://huggingface.co/docs/datasets/process) · [OpenAI — Supervised fine-tuning](https://developers.openai.com/api/docs/guides/supervised-fine-tuning) · [Google — Prepare supervised tuning data](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tuning/supervised-tuning/prepare-data) · [Transformers source — `apply_chat_template` defaults (v5)](https://github.com/huggingface/transformers/blob/main/src/transformers/tokenization_utils_base.py)
