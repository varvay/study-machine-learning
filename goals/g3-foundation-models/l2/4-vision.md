---
title: Multimodal and vision
---

Recap (G3.4 L1): CNNs, vision transformers, OCR, and multimodal LLMs. This section runs each one: a pretrained classifier, two OCR engines, an image sent to Claude, and CLIP embeddings for image search.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 300" role="img" aria-labelledby="vision-l2-tools-title">
<title id="vision-l2-tools-title">One image, four tools: a CNN classifier returns labels, OCR returns text and tables, a multimodal LLM returns an answer, and CLIP returns a vector for search</title>
<rect class="fold-test" x="20" y="110" width="130" height="80" rx="10" />
<text class="table-name" x="85" y="146" text-anchor="middle">image</text>
<text class="key-tag" x="85" y="164" text-anchor="middle">photo, scan, chart</text>
<path class="key-link" d="M150,150 C200,150 200,45 250,45" />
<path class="key-link" d="M150,150 C200,150 200,115 250,115" />
<path class="key-link" d="M150,150 C200,150 200,185 250,185" />
<path class="key-link" d="M150,150 C200,150 200,255 250,255" />
<rect class="fold-train" x="250" y="20" width="230" height="50" rx="8" />
<text class="table-name" x="265" y="42">ResNet-50 (torchvision)</text>
<text class="key-tag" x="265" y="60">pretrained CNN classifier</text>
<rect class="fold-train" x="250" y="90" width="230" height="50" rx="8" />
<text class="table-name" x="265" y="112">Tesseract · Amazon Textract</text>
<text class="key-tag" x="265" y="130">OCR and document analysis</text>
<rect class="fold-train" x="250" y="160" width="230" height="50" rx="8" />
<text class="table-name" x="265" y="182">Claude on Bedrock</text>
<text class="key-tag" x="265" y="200">multimodal LLM</text>
<rect class="fold-train" x="250" y="230" width="230" height="50" rx="8" />
<text class="table-name" x="265" y="252">CLIP</text>
<text class="key-tag" x="265" y="270">image and text embeddings</text>
<path class="key-link" d="M480,45 L530,45" />
<path class="key-link" d="M480,115 L530,115" />
<path class="key-link" d="M480,185 L530,185" />
<path class="key-link" d="M480,255 L530,255" />
<text x="540" y="42">1 of 1,000 fixed labels</text>
<text class="note" x="540" y="60">with a probability each</text>
<text x="540" y="112">text, lines, tables, forms</text>
<text class="note" x="540" y="130">with positions and confidence</text>
<text x="540" y="182">an answer to any question</text>
<text class="note" x="540" y="200">free text or JSON (G3.5)</text>
<text x="540" y="252">a 512-number vector</text>
<text class="note" x="540" y="270">stored in pgvector (G1.7)</text>
</svg>
</div>
<figcaption>Four ways to get information out of an image. A classifier knows only the labels it was trained on; the LLM answers open questions at a higher cost per image; CLIP makes images searchable by text.</figcaption>
</figure>

**Classify an image with a pretrained ResNet.** A **pretrained model** is one already trained on a large dataset, ready to use or to adapt. **ResNet** is a widely used CNN family whose shortcut connections let it stack many layers; ResNet-50 has 50. torchvision, PyTorch's computer-vision library, ships ResNet-50 weights trained on ImageNet, the standard labelled image dataset, whose 1,000 classes range from "golden retriever" to "espresso". Each weights object carries its own preprocessing and class names, so the image is prepared exactly as in training:

```python
import torch
from torchvision.io import decode_image
from torchvision.models import ResNet50_Weights, resnet50

weights = ResNet50_Weights.DEFAULT
model = resnet50(weights=weights).eval()
preprocess = weights.transforms()

image = decode_image("dog.jpg")
batch = preprocess(image).unsqueeze(0)
with torch.no_grad():
    probabilities = model(batch).squeeze(0).softmax(dim=0)

top = probabilities.topk(5)
for probability, class_id in zip(top.values, top.indices):
    print(f"{weights.meta['categories'][class_id]}: {probability:.2f}")
```

- `weights.transforms()` — resizes, crops, and normalizes the image the way the training images were.
- `unsqueeze(0)` — adds the batch dimension: the model takes a stack of images, here a stack of one.
- `.eval()` — switches layers such as batch normalization (which rescales values by the current batch's statistics in training, and by stored averages at inference) to inference behavior.
- `softmax` — turns the 1,000 raw scores into probabilities (the same softmax as G3.1).

The model can only answer with its 1,000 labels. For your own classes (defect / no defect), replace the last layer and train it on your images: transfer learning (G3.4 L3).

**OCR with Tesseract.** Tesseract is an open-source OCR engine; `pytesseract` calls it from Python, PIL (the Pillow imaging library) opens the image, and the engine itself installs separately (`brew install tesseract` on macOS, `apt install tesseract-ocr` on Debian or Ubuntu).

```python
import pytesseract
from PIL import Image

page = Image.open("scan.png")
print(pytesseract.image_to_string(page, lang="eng"))

words = pytesseract.image_to_data(page, output_type=pytesseract.Output.DICT)
low_confidence = [text for text, confidence in zip(words["text"], words["conf"]) if text.strip() and float(confidence) < 60]
```

`image_to_data` returns every word with its position and a confidence score; words under a threshold are worth a human look. Tesseract returns plain text: a table comes back as lines of words, its columns lost.

**OCR with Amazon Textract.** Textract returns the page as a list of **blocks**, each with a type, its text, its position, and links to child blocks:

- `DetectDocumentText` — text only: `PAGE`, `LINE`, and `WORD` blocks.
- `AnalyzeDocument` with `FeatureTypes=["TABLES", "FORMS"]` — adds `TABLE` blocks whose children are `CELL` blocks (each with `RowIndex` and `ColumnIndex`, children `WORD`), and `KEY_VALUE_SET` blocks for form fields such as "Invoice no.: 1042".
- Both calls are synchronous for one page. A multi-page PDF in S3 (AWS's file storage) goes through the asynchronous pair `StartDocumentTextDetection` / `GetDocumentTextDetection` (or `StartDocumentAnalysis` / `GetDocumentAnalysis`).

```python
import boto3

textract = boto3.client("textract", region_name="us-east-1")
with open("invoice.png", "rb") as file:
    document = {"Bytes": file.read()}

text_blocks = textract.detect_document_text(Document=document)["Blocks"]
lines = [block["Text"] for block in text_blocks if block["BlockType"] == "LINE"]

analysis = textract.analyze_document(Document=document, FeatureTypes=["TABLES", "FORMS"])
blocks_by_id = {block["Id"]: block for block in analysis["Blocks"]}

def child_blocks(block: dict) -> list[dict]:
    return [blocks_by_id[child_id] for relation in block.get("Relationships", []) if relation["Type"] == "CHILD" for child_id in relation["Ids"]]

def cell_text(cell: dict) -> str:
    return " ".join(child["Text"] for child in child_blocks(cell) if child["BlockType"] == "WORD")

def table_rows(table: dict) -> list[list[str]]:
    grid: dict[int, dict[int, str]] = {}
    for cell in child_blocks(table):
        grid.setdefault(cell["RowIndex"], {})[cell["ColumnIndex"]] = cell_text(cell)
    return [[grid[row][column] for column in sorted(grid[row])] for row in sorted(grid)]

for table in (block for block in analysis["Blocks"] if block["BlockType"] == "TABLE"):
    for row in table_rows(table):
        print(" | ".join(row))
```

Keeping the table as rows matters for RAG: a chunk that says "| Premium | 49.00 |" can be answered from; the same words as a loose run of text often cannot.

The equivalents on the other clouds:

| | AWS | Azure | Google Cloud |
|---|---|---|---|
| Service | Amazon Textract | Azure Document Intelligence in Foundry Tools | Document AI |
| Text only | `DetectDocumentText` | `prebuilt-read` model | Enterprise Document OCR processor |
| Tables and forms | `AnalyzeDocument` (`TABLES`, `FORMS`) | `prebuilt-layout` model | Form Parser, Layout Parser processors |

**Send an image to a multimodal LLM.** Through Bedrock's Converse API, an image is one more content block next to the text:

```python
import boto3

client = boto3.client("bedrock-runtime", region_name="us-east-1")
with open("chart.png", "rb") as file:
    image_bytes = file.read()

response = client.converse(
    modelId="global.anthropic.claude-sonnet-5-5",
    messages=[{
        "role": "user",
        "content": [
            {"image": {"format": "png", "source": {"bytes": image_bytes}}},
            {"text": "What does this chart show? Answer in two sentences."},
        ],
    }],
    inferenceConfig={"maxTokens": 400},
)
print(next(block["text"] for block in response["output"]["message"]["content"] if "text" in block))
```

- `format` — the image type: `png`, `jpeg`, `gif`, or `webp`.
- `bytes` — the raw file bytes; the AWS SDK base64-encodes them for you.
- Claude Sonnet 5.5 on Bedrock accepts text and image input.

The same call in Spring AI, the Java framework for calling LLMs from Spring applications (G6.2), where `media` attaches the image to the user message:

```java
String answer = chatClient.prompt()
        .user(user -> user.text("What does this chart show? Answer in two sentences.")
                .media(MimeTypeUtils.IMAGE_PNG, new ClassPathResource("/chart.png")))
        .call()
        .content();
```

A vision LLM reads a scanned form and returns its fields as JSON in one call, where OCR returns text you still have to interpret. It costs more per page and returns no per-word confidence, so a misread digit gives no warning, whereas OCR scores every word; G3.4 L3 weighs the two.

**CLIP embeddings for image search.** **CLIP** is a pair of encoders, one for images and one for text, trained on 400 million image-caption pairs so that an image and a caption describing it get nearby vectors. Both land in one shared vector space, so a text query can retrieve images. The `sentence_transformers` library loads embedding models like CLIP behind one `encode` call:

```python
from PIL import Image
from sentence_transformers import SentenceTransformer, util

model = SentenceTransformer("clip-ViT-B-32")
paths = ["beach.jpg", "office.jpg", "dog.jpg"]
image_embeddings = model.encode([Image.open(path) for path in paths])
query_embedding = model.encode(["a dog playing on the sand"])

scores = util.cos_sim(query_embedding, image_embeddings)[0]
for path, score in sorted(zip(paths, scores.tolist()), key=lambda pair: -pair[1]):
    print(f"{score:.3f}  {path}")
```

- `clip-ViT-B-32` — a CLIP model whose image encoder is a vision transformer over 32 × 32-pixel patches of a 224 × 224 image, so 7 × 7 = 49 patch tokens (G3.4 L1).
- Each embedding has 512 numbers.
- `util.cos_sim` — cosine similarity (G1.7); the highest score is the best match.

At scale, the vectors go into pgvector exactly like text embeddings (G1.7):

```sql
CREATE TABLE images (
  id        bigserial PRIMARY KEY,
  path      text NOT NULL,
  embedding vector(512) NOT NULL
);
CREATE INDEX ON images USING hnsw (embedding vector_cosine_ops);

SELECT path FROM images ORDER BY embedding <=> $1 LIMIT 5;
```

`$1` is the embedding of the text query, and `<=>` is cosine distance, so the smallest distance comes first. The same model gives zero-shot classification: embed candidate captions such as "a photo of a cat" and "a photo of a dog", and pick the caption closest to the image, with no training.

Sources: [torchvision — Models and pre-trained weights](https://docs.pytorch.org/vision/stable/models.html) · [pytesseract](https://pypi.org/project/pytesseract/) · [Amazon Textract — Detecting text](https://docs.aws.amazon.com/textract/latest/dg/how-it-works-detecting.html) · [Amazon Textract — Tables](https://docs.aws.amazon.com/textract/latest/dg/how-it-works-tables.html) · [Azure Document Intelligence overview](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/overview) · [Google Document AI overview](https://docs.cloud.google.com/document-ai/docs/overview) · [Amazon Bedrock — Converse API (image blocks)](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) · [Bedrock — Claude Sonnet 5.5 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html) · [Spring AI — Multimodality](https://docs.spring.io/spring-ai/reference/api/multimodality.html) · [Hugging Face — CLIP](https://huggingface.co/docs/transformers/main/en/model_doc/clip) · [sentence-transformers/clip-ViT-B-32](https://huggingface.co/sentence-transformers/clip-ViT-B-32) · [openai/clip-vit-base-patch32 config](https://huggingface.co/openai/clip-vit-base-patch32/blob/main/config.json) · [pgvector](https://github.com/pgvector/pgvector)
