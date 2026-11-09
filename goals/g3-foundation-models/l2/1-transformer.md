---
title: Transformer architecture
---

Recap (G3.1 L1): text becomes tokens, tokens become embedding vectors, and self-attention lets each token's vector take in information from the other tokens. This section computes attention by hand, then in code, and runs a real tokenizer and model.

**Scaled dot-product attention** is the formula every attention head computes (a head is one attention computation; a layer runs several side by side, see multi-head attention below):

Attention(Q, K, V) = softmax(QKᵀ / √dₖ) V

- **X** — the input: one row per token, each row that token's vector of length d_model (its embedding plus position, or the previous layer's output).
- **Q, K, V** — three projections of X: Q = XW_Q, K = XW_K, V = XW_V. The W matrices are parameters learned in training; each maps a length-d_model row to a shorter row of length dₖ.
  - **Query** (a row of Q) — what this token is looking for.
  - **Key** (a row of K) — what this token offers to be matched on.
  - **Value** (a row of V) — the content this token passes on when it is attended to.
- **QKᵀ** — every query dotted with every key: an n × n matrix for n tokens, where row i, column j scores how well token i's query matches token j's key.
- **√dₖ** — the square root of the query and key length. Dot products grow with dₖ; the paper divides by √dₖ because large scores push softmax into a region where its gradients are tiny, which stalls training (gradients: G2.4 L1).
- **softmax** — applied to each row separately: exponentiate each score, then divide by the row's sum. Every weight becomes positive and each row sums to 1.
- **× V** — each output row is the weighted sum of all value rows, using that row's weights. The output has one new vector per token.

A decoder-only model (GPT, Llama) adds a **causal mask** M before the softmax: softmax(QKᵀ / √dₖ + M) V, where M holds −∞ wherever the key comes after the query. Since e^−∞ = 0, a token gets zero weight on every later token, so generation cannot peek ahead.

**Worked example.** Three tokens with dₖ = 2. Take Q, K, and V as given, as if already projected:

| token | query q | key k | value v |
|---|---|---|---|
| cat | [1, 0] | [2, 0] | [1, 0] |
| sat | [0, 1] | [0, 1] | [0, 1] |
| it | [2, 0] | [1, 1] | [0.5, 0.5] |

1. **Scores QKᵀ.** Row "it": q_it · k_cat = 2×2 + 0×0 = 4; q_it · k_sat = 2×0 + 0×1 = 0; q_it · k_it = 2×1 + 0×1 = 2.
2. **Scale.** Divide by √2 ≈ 1.41: row "it" becomes 2.83, 0, 1.41.
3. **Softmax.** e^2.83 = 16.92, e^0 = 1, e^1.41 = 4.11; the sum is 22.03, so the weights are 0.77, 0.05, 0.19 (0.768, 0.045, 0.187 before rounding).
4. **Weighted sum of values.** 0.768 × [1, 0] + 0.045 × [0, 1] + 0.187 × [0.5, 0.5] = [0.86, 0.14].

All three rows:

| query ↓ · key → | cat | sat | it | output |
|---|---|---|---|---|
| cat | 0.58 | 0.14 | 0.28 | [0.72, 0.28] |
| sat | 0.20 | 0.40 | 0.40 | [0.40, 0.60] |
| it | 0.77 | 0.05 | 0.19 | [0.86, 0.14] |

"it" puts 77% of its weight on "cat", so its new vector sits close to cat's value [1, 0]: in a trained model, this is how a pronoun picks up what it refers to. The walkthrough below runs these steps one row at a time; its second example adds the causal mask.

The same computation in NumPy, Python's array library, to check the numbers:

```python
import numpy as np

def softmax(scores: np.ndarray) -> np.ndarray:
    exponentials = np.exp(scores - scores.max(axis=-1, keepdims=True))
    return exponentials / exponentials.sum(axis=-1, keepdims=True)

def attention(queries, keys, values, causal=False):
    scores = queries @ keys.T / np.sqrt(keys.shape[-1])
    if causal:
        future = np.triu(np.ones_like(scores, dtype=bool), k=1)
        scores = np.where(future, -np.inf, scores)
    weights = softmax(scores)
    return weights @ values, weights

queries = np.array([[1, 0], [0, 1], [2, 0]], dtype=float)
keys = np.array([[2, 0], [0, 1], [1, 1]], dtype=float)
values = np.array([[1, 0], [0, 1], [0.5, 0.5]])

outputs, weights = attention(queries, keys, values)
print(weights.round(3))   # [[0.576 0.14 0.284] [0.198 0.401 0.401] [0.768 0.045 0.187]]
print(outputs.round(3))   # [[0.718 0.282] [0.398 0.602] [0.861 0.139]]
```

Subtracting each row's maximum before `exp` changes nothing mathematically (it cancels in the division) and keeps `exp` from overflowing on large scores. PyTorch, the deep-learning library most open models are written in, ships the whole formula as one call, `torch.nn.functional.scaled_dot_product_attention(query, key, value, is_causal=True)`, whose default scale is 1/√dₖ.

**Multi-head attention** runs h attention computations, the **heads**, side by side, each with its own W_Q, W_K, W_V, then joins their outputs:

MultiHead(Q, K, V) = Concat(head₁, …, head_h) W_O, where headᵢ = Attention(XW_Qⁱ, XW_Kⁱ, XW_Vⁱ)

- **h** — the number of heads. Each head gets dₖ = d_model / h, so h heads cost about as much as one full-width head.
- **W_O** — a learned matrix that mixes the concatenated head outputs back into one vector of length d_model.
- **Why several heads** — one softmax gives one set of weights per token. Separate heads can each track a different relation at once; the paper's visualizations show heads that follow sentence structure and a head that links a pronoun to what it refers to.
- **Sizes** — the original paper uses d_model = 512 and h = 8, so dₖ = 64. Qwen2.5-0.5B-Instruct, a small open-weight chat model from Alibaba's Qwen team, uses a hidden size (d_model) of 896 with 14 heads (64 each) over 24 layers; its config also lists only 2 key/value heads, which several query heads share (grouped-query attention, G3.1 L3).

**Tokenize and count tokens.** Every model has its own tokenizer, so the same text gives different token counts on different models. Count with the target model's tokenizer.

OpenAI models: `tiktoken`. `encoding_for_model("gpt-4o")` returns the `o200k_base` encoding, tiktoken's name for a tokenizer.

```python
import tiktoken

encoding = tiktoken.get_encoding("o200k_base")          # or tiktoken.encoding_for_model("gpt-4o")
token_ids = encoding.encode("Tokenization splits text into tokens.")
print(len(token_ids))                                   # 7
print(token_ids)                                        # [4421, 2860, 76848, 2201, 1511, 20290, 13]
print([encoding.decode_single_token_bytes(t) for t in token_ids])
# [b'Token', b'ization', b' splits', b' text', b' into', b' tokens', b'.']
print(len(encoding.encode("Unbelievable!")))            # 4: 'Un' 'bel' 'ievable' '!'
```

Open-weight models: the Hugging Face tokenizer that ships with the model. Hugging Face hosts most open-weight models, and its Python library `transformers` downloads and runs them; `from_pretrained` fetches the named model's files.

```python
from transformers import AutoTokenizer

tokenizer = AutoTokenizer.from_pretrained("Qwen/Qwen2.5-0.5B-Instruct")
text = "Tokenization splits text into tokens."
print(tokenizer.tokenize(text))
# ['Token', 'ization', 'Ġsplits', 'Ġtext', 'Ġinto', 'Ġtokens', '.']
token_ids = tokenizer(text)["input_ids"]
print(len(token_ids), token_ids)    # 7 [3323, 2022, 40467, 1467, 1119, 11211, 13]
print(tokenizer.decode(token_ids))  # Tokenization splits text into tokens.
```

`Ġ` marks a leading space in byte-level BPE vocabularies. Both tokenizers split this sentence the same way, yet the IDs differ: each vocabulary numbers its tokens differently. The outputs above were produced with tiktoken and transformers 5.18.

A chat model does not read a list of messages; it reads one token sequence with control tokens marking each turn. `apply_chat_template` builds that sequence from the model's own template:

```python
messages = [
    {"role": "system", "content": "You are terse."},
    {"role": "user", "content": "Hi"},
]
print(tokenizer.apply_chat_template(messages, add_generation_prompt=True, tokenize=False))
# <|im_start|>system
# You are terse.<|im_end|>
# <|im_start|>user
# Hi<|im_end|>
# <|im_start|>assistant
```

`add_generation_prompt=True` appends the opening of an assistant turn, so the model answers instead of continuing the user's message. These control tokens count toward the context window and the bill.

Claude's tokenizer is not public. Count Claude tokens with the free `client.messages.count_tokens(model=..., system=..., messages=...)` endpoint, which returns `input_tokens`. Claude Opus 4.7 and later use a newer tokenizer that produces about 30% more tokens for the same text, so recount when you change models.

**Run a small model locally.** Qwen2.5-0.5B-Instruct (0.49 billion parameters, Apache 2.0, not gated: it downloads without first accepting the maker's terms on Hugging Face) is about 1 GB in bf16, a 16-bit number format (0.49 billion × 2 bytes) and runs on a laptop CPU. Install `transformers` and `torch` first.

```python
from transformers import pipeline

chat = pipeline("text-generation", model="Qwen/Qwen2.5-0.5B-Instruct", dtype="auto", device_map="auto")
messages = [
    {"role": "system", "content": "Answer in one sentence."},
    {"role": "user", "content": "What does a transformer's attention layer do?"},
]
response = chat(messages, max_new_tokens=60)
print(response[0]["generated_text"][-1]["content"])
```

`dtype="auto"` loads the weights in the number format they were saved in, `device_map="auto"` places the model on a GPU when one is available, and `max_new_tokens` is the max-tokens limit of G3.2 L1. The pipeline applies the chat template, generates, and returns the whole conversation with the new assistant message last. The lower-level API shows the attention weights themselves:

```python
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

model_id = "Qwen/Qwen2.5-0.5B-Instruct"
tokenizer = AutoTokenizer.from_pretrained(model_id)
model = AutoModelForCausalLM.from_pretrained(model_id, dtype=torch.float32, attn_implementation="eager")

inputs = tokenizer("The cat sat because it was tired", return_tensors="pt")
with torch.no_grad():
    outputs = model(**inputs, output_attentions=True)

print(len(outputs.attentions))       # 24: one tensor per layer
print(outputs.attentions[0].shape)   # (batch, heads, tokens, tokens) = (1, 14, 7, 7)
last_layer_weights = outputs.attentions[-1][0].mean(dim=0)   # average the 14 heads
tokens = tokenizer.convert_ids_to_tokens(inputs["input_ids"][0])
print(dict(zip(tokens, last_layer_weights[tokens.index("Ġit")].round(decimals=2).tolist())))
```

`AutoModelForCausalLM` loads the model with its next-token output ("causal LM" means decoder-only), `return_tensors="pt"` returns PyTorch tensors (multi-dimensional arrays), `torch.no_grad()` skips the gradient bookkeeping that only training needs, and `output_attentions=True` returns the attention weights. Each attention tensor holds the softmax weights of the formula above, one n × n matrix per head. Every row sums to 1, and every entry above the diagonal is 0 because of the causal mask. `attn_implementation="eager"` selects the plain attention code, which can return these weights. Real attention maps are messier than the "it → cat" story: models put a large share of attention on the first tokens even when those carry no meaning, an effect called the **attention sink**.

Sources: [Vaswani et al., Attention Is All You Need](https://arxiv.org/abs/1706.03762) · [Xiao et al., attention sinks](https://arxiv.org/abs/2309.17453) · [PyTorch — scaled_dot_product_attention](https://docs.pytorch.org/docs/stable/generated/torch.nn.functional.scaled_dot_product_attention.html) · [tiktoken](https://github.com/openai/tiktoken) · [Hugging Face — Chat templates](https://huggingface.co/docs/transformers/main/en/chat_templating) · [Hugging Face — Chat basics (pipeline)](https://huggingface.co/docs/transformers/main/en/conversations) · [Hugging Face — Model outputs (`attentions`)](https://huggingface.co/docs/transformers/main/en/main_classes/output) · [Qwen2.5-0.5B-Instruct model card](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct) and [config](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/blob/main/config.json) · [Anthropic — Token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting)
