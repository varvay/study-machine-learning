---
title: Transformer architecture
---

A **large language model (LLM)** is a neural network (G2.4) trained on a huge amount of text to do one thing: predict the next token. Nearly all LLMs are **transformers**, the architecture introduced in the 2017 paper "Attention Is All You Need". A transformer reads all the tokens of its input at once and relates them to each other through attention, with no recurrence or convolution.

The input travels this path:

<figure>
<div class="diagram-scroll">
<svg class="diagram" viewBox="0 0 760 330" role="img" aria-labelledby="transformer-pipeline-title">
<title id="transformer-pipeline-title">From text to next-token probabilities: the text is split into tokens, each token has an ID, each ID looks up an embedding vector, and the transformer layers turn the vectors into a probability for every possible next token</title>
<text class="note" x="20" y="35">text</text>
<rect class="fold-train" x="150" y="14" width="598" height="32" rx="6" />
<text x="449" y="35" text-anchor="middle">Transformers read tokens.</text>
<text class="note" x="20" y="93">tokens</text>
<rect class="fold-train" x="150" y="72" width="110" height="32" rx="6" /><text x="205" y="93" text-anchor="middle">Transform</text>
<rect class="fold-train" x="272" y="72" width="110" height="32" rx="6" /><text x="327" y="93" text-anchor="middle">ers</text>
<rect class="fold-train" x="394" y="72" width="110" height="32" rx="6" /><text x="449" y="93" text-anchor="middle">␣read</text>
<rect class="fold-train" x="516" y="72" width="110" height="32" rx="6" /><text x="571" y="93" text-anchor="middle">␣tokens</text>
<rect class="fold-train" x="638" y="72" width="110" height="32" rx="6" /><text x="693" y="93" text-anchor="middle">.</text>
<path class="key-link" d="M205,104 L205,124" /><path class="key-link" d="M327,104 L327,124" /><path class="key-link" d="M449,104 L449,124" /><path class="key-link" d="M571,104 L571,124" /><path class="key-link" d="M693,104 L693,124" />
<text class="note" x="20" y="142">token IDs</text>
<text class="key-column" x="205" y="142" text-anchor="middle">12200</text><text class="key-column" x="327" y="142" text-anchor="middle">409</text><text class="key-column" x="449" y="142" text-anchor="middle">1729</text><text class="key-column" x="571" y="142" text-anchor="middle">20290</text><text class="key-column" x="693" y="142" text-anchor="middle">13</text>
<path class="key-link" d="M205,150 L205,170" /><path class="key-link" d="M327,150 L327,170" /><path class="key-link" d="M449,150 L449,170" /><path class="key-link" d="M571,150 L571,170" /><path class="key-link" d="M693,150 L693,170" />
<text class="note" x="20" y="186">embeddings</text>
<text class="key-tag" x="20" y="202">+ position</text>
<rect class="fold-test" x="163" y="176" width="16" height="16" rx="3" /><rect class="fold-test" x="183" y="176" width="16" height="16" rx="3" /><rect class="fold-test" x="203" y="176" width="16" height="16" rx="3" /><rect class="fold-test" x="223" y="176" width="16" height="16" rx="3" /><text class="key-tag" x="243" y="189">…</text>
<rect class="fold-test" x="285" y="176" width="16" height="16" rx="3" /><rect class="fold-test" x="305" y="176" width="16" height="16" rx="3" /><rect class="fold-test" x="325" y="176" width="16" height="16" rx="3" /><rect class="fold-test" x="345" y="176" width="16" height="16" rx="3" /><text class="key-tag" x="365" y="189">…</text>
<rect class="fold-test" x="407" y="176" width="16" height="16" rx="3" /><rect class="fold-test" x="427" y="176" width="16" height="16" rx="3" /><rect class="fold-test" x="447" y="176" width="16" height="16" rx="3" /><rect class="fold-test" x="467" y="176" width="16" height="16" rx="3" /><text class="key-tag" x="487" y="189">…</text>
<rect class="fold-test" x="529" y="176" width="16" height="16" rx="3" /><rect class="fold-test" x="549" y="176" width="16" height="16" rx="3" /><rect class="fold-test" x="569" y="176" width="16" height="16" rx="3" /><rect class="fold-test" x="589" y="176" width="16" height="16" rx="3" /><text class="key-tag" x="609" y="189">…</text>
<rect class="fold-test" x="651" y="176" width="16" height="16" rx="3" /><rect class="fold-test" x="671" y="176" width="16" height="16" rx="3" /><rect class="fold-test" x="691" y="176" width="16" height="16" rx="3" /><rect class="fold-test" x="711" y="176" width="16" height="16" rx="3" /><text class="key-tag" x="731" y="189">…</text>
<path class="key-link" d="M205,200 L205,236" /><path class="key-link" d="M327,200 L327,236" /><path class="key-link" d="M449,200 L449,236" /><path class="key-link" d="M571,200 L571,236" /><path class="key-link" d="M693,200 L693,236" />
<text class="note" x="20" y="261">layers</text>
<rect class="table-body" x="150" y="236" width="598" height="40" rx="8" />
<rect class="table-outline" x="150" y="236" width="598" height="40" rx="8" />
<text class="table-name" x="449" y="261" text-anchor="middle">transformer layers × N: self-attention, then feed-forward</text>
<path class="key-link" d="M449,276 L449,298" />
<text class="note" x="20" y="316">output</text>
<text x="449" y="316" text-anchor="middle">a probability for every vocabulary token to come next (G3.2)</text>
</svg>
</div>
<figcaption>The real split and IDs from OpenAI's <code>o200k_base</code> tokenizer; ␣ marks a space. Each ID selects one learned vector from the embedding table, and position information is added to it.</figcaption>
</figure>

- **Token** — the unit of text a model reads and writes: a whole word, a piece of a word, or a punctuation mark. A model has a fixed **vocabulary**, the list of every token it knows, and each token's number in that list is its **token ID**. OpenAI's `o200k_base` tokenizer has a vocabulary of about 200,000 tokens.
- **Tokenization** — splitting text into tokens, done by a program called a **tokenizer**. Common words become one token, and rarer words split into pieces: "Transformers" becomes "Transform" + "ers". A space usually belongs to the token after it, so " read" with its leading space is one token.

Why pieces of words? A vocabulary of whole words needs an entry for every form of every word ("love", "loved", "lovingly") and fails on a word it has never seen. Single characters can spell anything, but make sequences very long, and one character carries little meaning. **Subword** tokens sit between: frequent words stay whole, and any new word can still be spelled from pieces. The most common algorithm, **byte-pair encoding (BPE)**, learns the vocabulary from training text: it starts from single characters (or bytes) and repeatedly merges the most frequent adjacent pair into a new token, until the vocabulary reaches its target size.

Tokens matter to an engineer because prices, context windows (the most tokens a model can handle in one request, input and output together), and output limits are all counted in tokens (G3.2, G3.3). In OpenAI's tokenizers a token averages about 4 bytes of text; Anthropic puts 1M tokens at about 555,000 English words for its current tokenizer. Each model family has its own tokenizer, so the same text gives different counts: "The animal didn't cross the street because it was too tired." is 12 tokens in `o200k_base` and 13 in the older `cl100k_base`, which splits "didn't" into "didn" + "'t" (counted with `tiktoken` 0.14.0, OpenAI's Python tokenizer library).

- **Embedding** — the vector (a list of numbers) that represents a token inside the model. The model holds an **embedding table** with one row per vocabulary token, and looks up the row for each token ID. The numbers are parameters learned in training, so tokens used in similar ways end up with similar vectors. They are the same kind of vector as in vector search (G1.7) at a finer grain: an embedding model for search turns a whole passage into one vector, while these are one vector per token.
- **Self-attention** — each token's vector is replaced by a weighted mix of the vectors of all the tokens in the sequence, weighted by how relevant each one is to it. In "The animal didn't cross the street because it was too tired", the token "it" gives most of its weight to "animal"; change "tired" to "wide", and the weight moves to "street". The weights come from comparing tokens in pairs: each pair gets a relevance score computed from learned parameters, and one token's scores are turned into weights that add up to 100% (the formula is in G3.1 L2). After attention, a token's vector carries meaning from its context, which the table lookup alone cannot give: "bank" next to "river" and "bank" next to "loan" start from the same embedding and end with different vectors. The walkthrough below follows "it".
- **Transformer layer** — one round of self-attention, followed by a small feed-forward network applied to each token's vector separately: attention moves information between tokens, and this network then transforms each token's vector on its own; it holds most of the layer's weights (neurons and layers: G2.4 L1). A model stacks many layers, and each one refines every vector with more context. After the last layer, the vector at the final position is turned into a score for every token in the vocabulary, and those scores become the next-token probabilities (G3.2).
- **Positional encoding** — information about each token's position, added to its embedding. Attention needs it because it compares every pair of tokens the same way whatever their order: without positions, "dog bites man" and "man bites dog" would look the same to the model. The original transformer adds a pattern of sine and cosine waves of different frequencies, a distinct pattern for each position; newer models use other schemes (G3.1 L3).

**Encoder and decoder.** The original transformer has two halves. The **encoder** reads the whole input, and each token attends to every other token, before and after it. The **decoder** generates output one token at a time, and each token attends only to the tokens before it. During generation the later tokens do not exist yet; during training a **causal mask** hides them, so the model cannot peek at the token it must predict. Models use one half or both:

| Family | Each token attends to | Trained to | Good at | Examples |
|---|---|---|---|---|
| Encoder-only | all tokens, both directions | recover words hidden (masked) in a sentence | understanding a whole text: classification, named-entity recognition (tagging names of people, places, organizations), embeddings for search | BERT |
| Decoder-only | earlier tokens only | predict the next token | generating text: chat, code, agents | GPT, Llama, Gemma, DeepSeek-V3 |
| Encoder-decoder | encoder: the whole input; decoder: earlier output tokens plus the whole input | turn one text into another | translation, summarization | T5, BART |

Most modern LLMs are decoder-only. Next-token prediction learns from any raw text, with no labels to write, and a model trained that way generates text directly.

Sources: [Vaswani et al., Attention Is All You Need](https://arxiv.org/abs/1706.03762) · [Google Research — the "it" example](https://research.google/blog/transformer-a-novel-neural-network-architecture-for-language-understanding/) · [Hugging Face — Tokenization algorithms](https://huggingface.co/docs/transformers/tokenizer_summary) · [tiktoken README](https://github.com/openai/tiktoken) · [Anthropic — Models overview (tokens per word)](https://platform.claude.com/docs/en/about-claude/models/overview) · [Hugging Face LLM Course — Transformer architectures](https://huggingface.co/learn/llm-course/chapter1/6) · [Devlin et al., BERT](https://arxiv.org/abs/1810.04805) · [Raffel et al., T5](https://arxiv.org/abs/1910.10683)
