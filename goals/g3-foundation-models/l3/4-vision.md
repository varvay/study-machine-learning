---
title: Vision and document understanding
---

L2 classified images with a pretrained ResNet, ran OCR, and sent images to a multimodal LLM. At L3 the questions are how to turn real business documents into good RAG input, when a vision LLM beats OCR, how to adapt a vision model with little data, and how to measure it.

**Document understanding for RAG** is turning a document's pages into text that keeps the document's structure: reading order, headings, tables, form fields, and figures. Plain text extraction loses exactly that structure, and retrieval quality falls with it:

- **Reading order** — a two-column page extracted line by line interleaves the columns into nonsense.
- **Tables** — flattened to a run of numbers, a table loses which value belongs to which row and column; a chunk boundary through a table separates values from their headers.
- **Forms** — "Name: Ana Silva" must stay a key with its value.
- **Headers, footers, page numbers** — repeated on every page, they pollute every chunk and every embedding.
- **Scans** — a scanned PDF has no text layer at all until OCR runs.

A layout-aware pipeline:

1. **Detect the page type**: digital text layer, or scan that needs OCR.
2. **Analyze layout**: find regions (title, section header, paragraph, list, table, figure, header, footer) with bounding boxes (the rectangle around each region, as page coordinates), in reading order.
3. **Extract per region**: text as text, tables as Markdown or HTML with header rows, form fields as key-value pairs, figures as a caption written by a vision model.
4. **Chunk by structure**: split at section headers, keep each table whole with its caption, repeat the header row if a table must be split, drop headers and footers.
5. **Store provenance**: page number and bounding box per chunk, so an answer can cite the exact spot (G1.8).

Tools for steps 2–3:

- **Amazon Textract** `AnalyzeDocument` with `FeatureTypes` `TABLES`, `FORMS`, `QUERIES` (answers to questions you ask of the page, such as "What is the policy number?"), `SIGNATURES` (where signatures are), and `LAYOUT`. `LAYOUT` returns blocks such as `LAYOUT_TITLE`, `LAYOUT_SECTION_HEADER`, `LAYOUT_TEXT`, `LAYOUT_TABLE`, `LAYOUT_FIGURE`, `LAYOUT_HEADER`, and `LAYOUT_FOOTER`, each with a bounding box, in reading order column by column. `AnalyzeDocument` is synchronous (documents up to 10 MB); multi-page PDFs go through the asynchronous `StartDocumentAnalysis`.
- **Bedrock Knowledge Bases parsing** — Knowledge Bases is Bedrock's managed RAG service, which parses, chunks, embeds, and retrieves your documents. Its default parser extracts text only, at no charge. For figures, charts, and tables, choose the **Bedrock Data Automation** parser, AWS's managed extraction service for documents and media (priced per page), or a **foundation model as parser**, a multimodal LLM such as Claude reading each page (priced per token, with a prompt you can customize). Either applies to every PDF in the data source.
- **Docling** — an open-source parser of PDF layout, reading order, and tables into Markdown or JSON, for on-premises pipelines.
- **Azure Document Intelligence layout model** and **Google Document AI Layout Parser** are the equivalents on the other clouds.

A different route skips text extraction: **ColPali** embeds images of whole pages with a vision-language model, as many vectors per page, and retrieves pages by late interaction with the query's token vectors: each query vector finds its most similar vector on the page, and those best-match scores add up to the page's score. On the paper's visually rich document benchmark it beat text-extraction pipelines while being simpler. The retrieved page image then goes to a multimodal LLM to answer. The cost is many vectors per page to store and search.

**OCR against a vision LLM.** OCR here means a dedicated text-recognition service (Textract, Tesseract); a vision LLM reads the page image and writes the text or answer directly. The accuracy rows are general experience (unsourced) and need measuring on the client's documents; the cost row is sourced.

| | OCR and layout service | Vision LLM |
|---|---|---|
| Clean printed text | very accurate, character-level | very accurate |
| Complex tables, charts, handwriting in context | tables with the right feature; charts are out of scope | strong: it reads structure and meaning together |
| Failure mode | misread characters, with a confidence score per word | fluent invented or "corrected" values, with no confidence score |
| Traceability | bounding box for every word | coordinates only if asked for, and approximate |
| Determinism | same output every run | varies with sampling; use temperature 0 |
| Cost per 1,000 pages (US) | Textract text only $1.50; with tables $15 (layout free with tables); forms $50; forms + tables + queries $70 | about $18 in the example below |

The vision LLM cost, worked out. A page scanned at 200 dpi is about 1,700 × 2,200 pixels. Claude reads images in 28 × 28-pixel patches, one token each, capped at 4,784 tokens on Claude 4.7 and later models, so the page costs about 4,784 input tokens. With about 800 tokens of Markdown out, at Claude Sonnet 5.5's list price of $2 / $10 per million: 4,784 × $2 / 10⁶ + 800 × $10 / 10⁶ ≈ $0.018 per page, about $18 per 1,000 pages, or about $9 with the 50% batch discount. Older Claude models cap an image at 1,568 tokens, which is cheaper but downsizes a full page enough to blur small print.

The design that follows is a **hybrid**: run OCR and layout on every page, then send a page to a vision LLM only when it needs one: low OCR confidence, a chart or diagram, or a table the layout service could not parse. Verify numbers the vision LLM extracts against the OCR text where both exist.

**Transfer learning** is reusing a network trained on a large dataset as the starting point for a new task. Early layers of a vision network learn general features such as edges and textures, and later layers learn features specific to the original task, which is why the early layers transfer well (Yosinski et al.). The choice depends on data size and how close the new images are to the pretraining images:

- **Feature extraction** — freeze (keep fixed) the pretrained backbone, the layers that turn an image into features, and train only a new classification head, the final layer that maps those features to your classes. For small datasets close to the pretraining domain.
- **Fine-tune the top blocks** — unfreeze the last blocks as well, with a lower learning rate than the head. For more data, or a domain further away.
- **Full fine-tuning** — train everything at a low learning rate. For large datasets or very different domains (medical scans, document images).

Two traps: preprocess inputs exactly as in pretraining (same resize and ImageNet normalization), and freeze batch-normalization statistics when batches are small (common practice; unsourced). Vision transformers depend on transfer even more than CNNs: ViT did well only after pretraining on large datasets (ImageNet-21k and JFT-300M, image sets far larger than ImageNet), since a transformer lacks a CNN's built-in assumption that nearby pixels belong together.

**Data augmentation** is applying random, label-preserving changes to training images, so the model sees more variety than the dataset holds. Common transforms: random crops and resizes, flips, small rotations, colour jitter (random shifts in brightness, contrast, and colour), blur. `torchvision.transforms.v2` applies them to images together with their bounding boxes and masks (per-pixel outlines of objects), so a crop moves the boxes with it, and adds batch-level CutMix and MixUp, which blend pairs of images and their labels.

- **Preserve the label**: flipping a document or a digit changes its meaning; flipping a photo of a cat does not.
- **Match production**: augment with the distortions real inputs have (phone photos, skew, glare, low light), not arbitrary ones.
- **Train set only**: validation and test images stay untouched, or the score stops measuring real performance (G2.3).

**Vision metrics.** Classification uses the metrics of G2.2 per class. Detection, finding each object in an image and drawing a box around it, needs one more idea: how well a predicted box matches a true box.

- **IoU (intersection over union)** — the area where two boxes overlap divided by the area they cover together. 1 is a perfect match, 0 no overlap.

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 245" role="img" aria-labelledby="vision-iou-title">
<title id="vision-iou-title">Intersection over union: a ground-truth box and a predicted box overlapping in a 120 by 100 region, giving IoU 0.27</title>
<rect class="fold-train" x="40" y="40" width="200" height="140" />
<rect class="fold-test" x="120" y="80" width="120" height="100" />
<rect class="table-outline" x="120" y="80" width="200" height="140" />
<text class="note" x="40" y="30">ground truth box (200 × 140)</text>
<text class="note" x="326" y="232">predicted box (200 × 140)</text>
<text class="table-name" x="180" y="134" text-anchor="middle">overlap</text>
<text class="key-tag" x="180" y="150" text-anchor="middle">120 × 100</text>
<text x="400" y="60">intersection = 120 × 100 = 12,000</text>
<text x="400" y="90">union = 28,000 + 28,000 − 12,000 = 44,000</text>
<text class="table-name" x="400" y="125">IoU = 12,000 / 44,000 ≈ 0.27</text>
<text class="note" x="400" y="155">below 0.5, so this prediction counts as a</text>
<text class="note" x="400" y="172">false positive even at the lenient AP50 threshold</text>
</svg>
</div>
<figcaption>IoU for one prediction. The union counts the overlap once, which is why it is subtracted.</figcaption>
</figure>

- **Matching** — a predicted box is a true positive if its IoU with a still-unmatched true box of the same class reaches the threshold; otherwise it is a false positive. True boxes left unmatched are false negatives.
- **AP (average precision)** — for one class, sort predictions by confidence, compute precision and recall down the list, and take the area under the precision-recall curve. The evaluation code of COCO, the standard object-detection benchmark, samples precision at 101 recall levels.
- **mAP** — AP averaged over classes. COCO's headline AP also averages over 10 IoU thresholds from 0.50 to 0.95 in steps of 0.05, so it rewards tight boxes; **AP50** uses only IoU 0.5, the convention of the older PASCAL VOC benchmark, and forgives loose boxes.
- **Segmentation**, labelling every pixel with the object it belongs to, uses IoU on pixel masks instead of boxes.
- **Documents**: OCR is scored by **character error rate**, CER = (substitutions + deletions + insertions) / characters in the reference; table extraction by **TEDS** (tree-edit-distance-based similarity), a similarity over the table's HTML tree that counts both structure and cell content.

**In an interview**

- *A client's RAG answers questions about scanned contracts poorly. What do you change?* First check extraction, not the model: look at what the parser produced for failing pages. Scans need OCR, tables need table-aware extraction, and two-column layouts need reading order, so switch to layout-aware parsing (Textract `LAYOUT` and `TABLES`, or the Bedrock Data Automation parser), chunk by section, and keep tables whole. Send pages with charts or low OCR confidence to a vision LLM, and keep page and bounding box on each chunk for citations.
- *OCR or a vision LLM for 10 million invoice pages?* OCR with layout as the default: about $1.50 per 1,000 pages for text, $15 with tables, deterministic, with a confidence and a bounding box for each word. A vision LLM costs around $18 per 1,000 pages at mid-tier list prices and can invent a plausible number, so I route to it only the pages OCR handles badly, and cross-check its numbers against the OCR text.

Sources: [Textract AnalyzeDocument API](https://docs.aws.amazon.com/textract/latest/dg/API_AnalyzeDocument.html) · [Textract layout response](https://docs.aws.amazon.com/textract/latest/dg/layoutresponse.html) · [Textract pricing](https://aws.amazon.com/textract/pricing/) · [Bedrock Knowledge Bases parsing options](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-advanced-parsing.html) · [Docling](https://github.com/docling-project/docling) · [Azure Document Intelligence layout model](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/layout) · [Google Document AI Layout Parser](https://docs.cloud.google.com/document-ai/docs/layout-parse-chunk) · [Faysse et al., ColPali](https://arxiv.org/abs/2407.01449) · [Claude vision: image token cost](https://platform.claude.com/docs/en/build-with-claude/vision) · [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [Yosinski et al., How transferable are features](https://arxiv.org/abs/1411.1792) · [Dosovitskiy et al., ViT](https://arxiv.org/abs/2010.11929) · [PyTorch transfer learning tutorial](https://docs.pytorch.org/tutorials/beginner/transfer_learning_tutorial.html) · [torchvision transforms v2](https://docs.pytorch.org/vision/stable/transforms.html) · [COCO evaluation code (IoU thresholds, recall levels)](https://github.com/cocodataset/cocoapi/blob/master/PythonAPI/pycocotools/cocoeval.py) · [TorchMetrics CER definition](https://github.com/Lightning-AI/torchmetrics/blob/master/src/torchmetrics/text/cer.py) · [Zhong et al., PubTabNet and TEDS](https://arxiv.org/abs/1911.10683)
