const ALWAYS = [
  // -- model & product names (keep verbatim) --
  { en: "gpt-4o(?:-mini)?", zh: null },
  { en: "gpt-4(?:-turbo|-[a-z0-9-]+)?", zh: null },
  { en: "o1(?:-mini|-preview)?", zh: null },
  { en: "o3(?:-mini)?", zh: null },
  { en: "chatgpt", zh: null },
  { en: "claude(?: (?:sonnet|opus|haiku))?(?: [\\d.]+)?", zh: null },
  { en: "gemini(?: [\\d.]+(?: (?:flash|pro|ultra))?)?", zh: null },
  { en: "llama(?: [\\d.]+)?", zh: null },
  { en: "mistral(?: [a-z]+)?", zh: null },
  { en: "mixtral", zh: null },
  { en: "qwen\\d?(?:-[\\d.a-z]+)?", zh: null },
  { en: "deepseek(?:-v\\d+)?", zh: null },
  { en: "grok(?:-[\\d.]+)?", zh: null },
  { en: "gemma(?: \\d+)?", zh: null },
  { en: "phi(?:-\\d+)?", zh: null },
  { en: "falcon", zh: null },
  { en: "palm(?:-2)?", zh: null },
  { en: "bert", zh: null },
  { en: "t5", zh: null },
  { en: "whisper", zh: null },
  { en: "dall-e", zh: null },
  { en: "sora", zh: null },
  { en: "veo", zh: null },
  { en: "imagen", zh: null },
  { en: "stable diffusion", zh: null },
  { en: "flux(?:\\.\\d+)?", zh: null },
  { en: "sdxl", zh: null },
  { en: "midjourney", zh: null },
  { en: "copilot", zh: null },
  { en: "hermes agents?", zh: null },
  // Hermes Agent (Nous Research) — keep verbatim
  { en: "kimi", zh: null },
  { en: "moonshot", zh: null },
  { en: "codestral", zh: null },
  { en: "clip", zh: null },
  // generic versioned model/artifact IDs: letters + separator + digits, e.g.
  // DeepSeek-V3, gpt-4o-mini, Qwen3-32B, llama-3.1-8b — keep verbatim
  { en: "(?=[a-z0-9._-]*\\d)[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)+", zh: null },
  // -- acronyms (keep verbatim) --
  { en: "llms?", zh: null },
  { en: "ai", zh: "AI", bad: ["\u4EBA\u5DE5\u667A\u6167", "\u4EBA\u5DE5\u667A\u80FD"] },
  { en: "agi", zh: null },
  { en: "asi", zh: null },
  { en: "nlp", zh: null },
  { en: "rlhf", zh: null },
  { en: "rag", zh: null },
  { en: "moe", zh: null },
  { en: "gan", zh: null },
  { en: "vae", zh: null },
  { en: "mcp", zh: null },
  { en: "api", zh: null },
  { en: "sdk", zh: null },
  { en: "cli", zh: null },
  { en: "gui", zh: null },
  { en: "vram", zh: null },
  { en: "cuda", zh: null },
  { en: "cve(?:-\\d+-\\d+)?", zh: null },
  { en: "ci/cd", zh: null },
  // -- common first names (keep verbatim) --
  // MT transliterates them (matt → 馬特), which reads terribly in casual /
  // social translation. Only unambiguous names are listed: excluded are ones
  // that double as common nouns (bill, mark, chase, frank, jack, will, bob...).
  { en: "matt", zh: null },
  { en: "john", zh: null },
  { en: "david", zh: null },
  { en: "mike", zh: null },
  { en: "chris", zh: null },
  { en: "sarah", zh: null },
  { en: "emma", zh: null },
  { en: "lisa", zh: null },
  { en: "tom", zh: null },
  { en: "steve", zh: null },
  { en: "brian", zh: null },
  { en: "kevin", zh: null },
  { en: "andrew", zh: null },
  { en: "josh", zh: null },
  { en: "jennifer", zh: null },
  { en: "jessica", zh: null },
  { en: "emily", zh: null },
  { en: "ashley", zh: null },
  { en: "anna", zh: null },
  { en: "kate", zh: null },
  { en: "laura", zh: null },
  { en: "nick", zh: null },
  { en: "tony", zh: null },
  { en: "ryan", zh: null },
  { en: "jake", zh: null },
  { en: "luke", zh: null },
  { en: "sam", zh: null },
  { en: "alex", zh: null },
  { en: "ben", zh: null },
  { en: "dan", zh: null },
  { en: "tim", zh: null },
  { en: "jim", zh: null },
  { en: "joe", zh: null },
  { en: "paul", zh: null },
  { en: "peter", zh: null },
  { en: "james", zh: null },
  { en: "robert", zh: null },
  { en: "michael", zh: null },
  { en: "jonathan", zh: null },
  { en: "stephen", zh: null },
  { en: "greg", zh: null },
  { en: "larry", zh: null },
  { en: "dennis", zh: null },
  { en: "aaron", zh: null },
  { en: "nathan", zh: null },
  { en: "jason", zh: null },
  { en: "kyle", zh: null },
  { en: "sean", zh: null },
  { en: "patrick", zh: null },
  { en: "ethan", zh: null },
  { en: "liam", zh: null },
  { en: "noah", zh: null },
  { en: "olivia", zh: null },
  { en: "sophia", zh: null },
  { en: "mia", zh: null },
  { en: "ava", zh: null },
  { en: "zoe", zh: null },
  { en: "amy", zh: null },
  { en: "julia", zh: null },
  { en: "rachel", zh: null },
  { en: "hannah", zh: null },
  { en: "rebecca", zh: null },
  { en: "daniel", zh: null },
  { en: "justin", zh: null },
  { en: "eric", zh: null },
  { en: "scott", zh: null },
  { en: "jeff", zh: null },
  { en: "adam", zh: null },
  { en: "leo", zh: null },
  // -- well-known tech personalities (keep verbatim, normalized case) --
  // chamath transliterates inconsistently (查馬斯 in-sentence vs 查馬特 alone),
  // so L1 alone can't catch it — L2 covers the observed variants.
  { en: "chamath", zh: "Chamath", bad: ["\u67E5\u99AC\u65AF", "\u67E5\u99AC\u7279"] },
  { en: "elon", zh: "Elon" },
  { en: "vitalik", zh: "Vitalik" },
  { en: "balaji", zh: "Balaji" },
  // -- social handles & crypto/popular slang --
  // @muse: a handle is a proper noun — never transliterate to 繆斯.
  { en: "@muse", zh: null },
  // gm/gn: the crypto-Twitter greeting ("good morning" / "good night").
  // Keeping the abbreviation verbatim is also correct for General Motors.
  { en: "gm", zh: "GM" },
  { en: "gn", zh: "GN" },
  { en: "hodl", zh: "HODL" },
  { en: "frens?", zh: null },
  { en: "wagmi", zh: null },
  { en: "ngmi", zh: null },
  { en: "dyor", zh: "DYOR" },
  { en: "nfa", zh: "NFA" },
  { en: "degen", zh: null },
  { en: "ath", zh: null },
  { en: "fomo", zh: null },
  { en: "fud", zh: null },
  { en: "rekt", zh: null },
  { en: "meme coins?", zh: "\u8FF7\u56E0\u5E63" },
  { en: "airdrops?", zh: "\u7A7A\u6295" },
  { en: "stablecoins?", zh: "\u7A69\u5B9A\u5E63" },
  { en: "bull markets?", zh: "\u725B\u5E02" },
  { en: "bear markets?", zh: "\u718A\u5E02" },
  { en: "on-?chain", zh: "\u93C8\u4E0A" },
  { en: "vibe coding", zh: null },
  // -- companies / orgs (keep verbatim) --
  { en: "openai", zh: null },
  { en: "anthropic", zh: null },
  { en: "nous(?: research)?", zh: null },
  // Nous Research (Hermes) — never translate the company name
  { en: "google deepmind", zh: "Google DeepMind" },
  { en: "deepmind", zh: "DeepMind" },
  { en: "hugging ?face", zh: "Hugging Face" },
  { en: "mistral ai", zh: "Mistral AI" },
  { en: "xai", zh: "xAI" },
  { en: "cohere", zh: null },
  { en: "perplexity", zh: null },
  { en: "databricks", zh: null },
  { en: "nvidia", zh: null },
  { en: "tsmc", zh: null },
  // -- unambiguous tech terms --
  { en: "large language models?", zh: "\u5927\u578B\u8A9E\u8A00\u6A21\u578B" },
  { en: "natural language processing", zh: "\u81EA\u7136\u8A9E\u8A00\u8655\u7406" },
  { en: "open-source", zh: "\u958B\u6E90" },
  { en: "closed-source", zh: "\u9589\u6E90" },
  { en: "open-weights", zh: "\u958B\u653E\u6B0A\u91CD", bad: ["\u958B\u653E\u91CD\u91CF"] },
  { en: "benchmarks?", zh: "\u57FA\u6E96" },
  { en: "latency", zh: "\u5EF6\u9072" },
  { en: "throughput", zh: "\u541E\u5410\u91CF" },
  { en: "streaming", zh: "\u4E32\u6D41" },
  { en: "containers?", zh: "\u5BB9\u5668" },
  { en: "docker", zh: null },
  { en: "kubernetes", zh: null },
  { en: "microservices?", zh: "\u5FAE\u670D\u52D9" },
  { en: "serverless", zh: "\u7121\u4F3A\u670D\u5668" },
  { en: "orchestration", zh: "\u7DE8\u6392" },
  { en: "deployments?", zh: "\u90E8\u7F72" },
  { en: "cloud", zh: "\u96F2\u7AEF" },
  { en: "on-prem(?:ise)?", zh: "\u5730\u7AEF" },
  { en: "repositor(?:y|ies)", zh: "\u5132\u5B58\u5EAB" },
  { en: "repos?", zh: "\u5132\u5B58\u5EAB" },
  { en: "codebase", zh: "\u7A0B\u5F0F\u78BC\u5EAB" },
  { en: "plugins?", zh: "\u5916\u639B" },
  { en: "browser extensions?", zh: "\u700F\u89BD\u5668\u64F4\u5145\u529F\u80FD" },
  { en: "tech debt", zh: "\u6280\u8853\u50B5" },
  { en: "stack traces?", zh: "\u5806\u758A\u8FFD\u8E64" },
  { en: "debugger", zh: "\u9664\u932F\u5668" },
  { en: "firewall", zh: "\u9632\u706B\u7246" },
  { en: "vpn", zh: null },
  { en: "malware", zh: "\u60E1\u610F\u8EDF\u9AD4" },
  { en: "ransomware", zh: "\u52D2\u7D22\u8EDF\u9AD4" },
  { en: "phishing", zh: "\u7DB2\u8DEF\u91E3\u9B5A" },
  { en: "zero-days?", zh: "\u96F6\u65E5\u6F0F\u6D1E" },
  { en: "chatbots?", zh: "\u804A\u5929\u6A5F\u5668\u4EBA" },
  { en: "prompt engineering", zh: "\u63D0\u793A\u5DE5\u7A0B" },
  { en: "prompt injection", zh: "\u63D0\u793A\u8A5E\u6CE8\u5165" },
  { en: "system prompts?", zh: "\u7CFB\u7D71\u63D0\u793A\u8A5E" },
  { en: "few-shot", zh: "\u5C11\u6A23\u672C", bad: ["\u5C11\u91CF\u4F8B\u5B50", "\u5C11\u9EDE", ["\u5E7E\u6B21\u63D0\u793A", "\u5C11\u6A23\u672C\u63D0\u793A"]] },
  { en: "zero-shot", zh: "\u96F6\u6A23\u672C" },
  { en: "one-shot", zh: "\u55AE\u6A23\u672C" },
  { en: "in-context learning", zh: "\u4E0A\u4E0B\u6587\u5B78\u7FD2" },
  { en: "chain-of-thought", zh: "\u601D\u7DAD\u93C8", bad: ["\u601D\u8DEF\u9023\u9396", "\u601D\u7DD2\u93C8", "\u601D\u8DEF\u93C8"] },
  { en: "chain of thought", zh: "\u601D\u7DAD\u93C8", bad: ["\u601D\u8DEF\u9023\u9396", "\u601D\u7DD2\u93C8", "\u601D\u8DEF\u93C8"] },
  { en: "retrieval-augmented generation", zh: "\u6AA2\u7D22\u589E\u5F37\u751F\u6210" },
  { en: "reinforcement learning from human feedback", zh: "\u4EBA\u985E\u56DE\u994B\u5F37\u5316\u5B78\u7FD2" },
  { en: "knowledge distillation", zh: "\u77E5\u8B58\u84B8\u993E", bad: ["\u77E5\u8B58\u8403\u53D6", "\u77E5\u8B58\u63D0\u7149"] },
  { en: "mixture[ -]of[ -]experts", zh: "\u6DF7\u5408\u5C08\u5BB6", bad: ["\u5C08\u5BB6\u6DF7\u5408"] },
  { en: "text-to-image", zh: "\u6587\u751F\u5716" },
  { en: "text-to-speech", zh: "\u6587\u5B57\u8F49\u8A9E\u97F3" },
  { en: "speech-to-text", zh: "\u8A9E\u97F3\u8F49\u6587\u5B57" },
  { en: "image generation", zh: "\u5716\u50CF\u751F\u6210" },
  { en: "speech recognition", zh: "\u8A9E\u97F3\u8FA8\u8B58" },
  { en: "computer vision", zh: "\u96FB\u8166\u8996\u89BA" },
  { en: "self-attention", zh: "\u81EA\u6CE8\u610F\u529B" },
  { en: "multi-head attention", zh: "\u591A\u982D\u6CE8\u610F\u529B" },
  { en: "sliding window attention", zh: "\u6ED1\u52D5\u7A97\u53E3\u6CE8\u610F\u529B" },
  { en: "grouped-query attention", zh: "\u5206\u7D44\u67E5\u8A62\u6CE8\u610F\u529B" },
  { en: "positional encoding", zh: "\u4F4D\u7F6E\u7DE8\u78BC" },
  { en: "next-token prediction", zh: "\u4E0B\u4E00\u500B\u8A5E\u5143\u9810\u6E2C" },
  { en: "kv cache", zh: "KV \u5FEB\u53D6" },
  { en: "continuous batching", zh: "\u9023\u7E8C\u6279\u8655\u7406", bad: ["\u6301\u7E8C\u6279\u6B21\u8655\u7406"] },
  { en: "pagedattention", zh: "PagedAttention" },
  { en: "vllm", zh: "vLLM" },
  { en: "flash ?attention", zh: "FlashAttention" },
  { en: "speculative decoding", zh: "\u63A8\u6E2C\u89E3\u78BC" }
];
const AI_ONLY = [
  // Nous Research models (keep verbatim; "fable" is a common word outside AI)
  { en: "astra", zh: null, bad: ["\u963F\u65AF\u7279\u62C9"] },
  { en: "fable", zh: null, bad: ["\u5BD3\u8A00", "\u9810\u8A00"] },
  { en: "models?", zh: "\u6A21\u578B" },
  { en: "transformers?", zh: "Transformer" },
  { en: "diffusion models?", zh: "\u64F4\u6563\u6A21\u578B" },
  { en: "foundation models?", zh: "\u57FA\u790E\u6A21\u578B" },
  { en: "frontier models?", zh: "\u524D\u6CBF\u6A21\u578B" },
  { en: "multimodal", zh: "\u591A\u6A21\u614B" },
  { en: "vision-language models?", zh: "\u8996\u89BA\u8A9E\u8A00\u6A21\u578B" },
  { en: "world models?", zh: "\u4E16\u754C\u6A21\u578B" },
  { en: "neural networks?", zh: "\u795E\u7D93\u7DB2\u8DEF" },
  { en: "deep learning", zh: "\u6DF1\u5EA6\u5B78\u7FD2" },
  { en: "machine learning", zh: "\u6A5F\u5668\u5B78\u7FD2" },
  { en: "embeddings?", zh: "\u5D4C\u5165" },
  { en: "vector databases?", zh: "\u5411\u91CF\u8CC7\u6599\u5EAB" },
  { en: "tokens?", zh: "\u8A5E\u5143", bad: ["\u4EE3\u5E63", "\u4EE4\u724C"] },
  { en: "tokenizers?", zh: "\u5206\u8A5E\u5668" },
  { en: "special tokens?", zh: "\u7279\u6B8A\u8A5E\u5143" },
  { en: "context windows?", zh: "\u4E0A\u4E0B\u6587\u7A97\u53E3", bad: ["\u4E0A\u4E0B\u6587\u8996\u7A97"] },
  { en: "long context", zh: "\u9577\u4E0A\u4E0B\u6587" },
  { en: "prompts?", zh: "\u63D0\u793A\u8A5E" },
  { en: "prompting", zh: "\u63D0\u793A" },
  { en: "prompted", zh: "\u63D0\u793A" },
  { en: "prompt caching", zh: "\u63D0\u793A\u5FEB\u53D6" },
  { en: "agents?", zh: null, bad: ["\u4EE3\u7406\u4EBA", "\u4EE3\u7406"] },
  // user asked: never translate Agent
  { en: "agentic", zh: "\u4EE3\u7406\u5F0F" },
  { en: "multi-agent", zh: "\u591A\u4EE3\u7406" },
  { en: "tool calling", zh: "\u5DE5\u5177\u547C\u53EB" },
  { en: "function calling", zh: "\u51FD\u5F0F\u547C\u53EB" },
  { en: "tool use", zh: "\u5DE5\u5177\u4F7F\u7528" },
  { en: "inference", zh: "\u63A8\u8AD6" },
  { en: "training", zh: "\u8A13\u7DF4" },
  { en: "pre-?train(?:ing|ed)?", zh: "\u9810\u8A13\u7DF4" },
  { en: "post-training", zh: "\u5F8C\u8A13\u7DF4" },
  { en: "fine-tun(?:e|ed|ing)", zh: "\u5FAE\u8ABF" },
  { en: "instruction tuning", zh: "\u6307\u4EE4\u5FAE\u8ABF" },
  { en: "supervised", zh: "\u76E3\u7763\u5F0F" },
  { en: "unsupervised", zh: "\u975E\u76E3\u7763\u5F0F" },
  { en: "self-supervised", zh: "\u81EA\u76E3\u7763\u5F0F" },
  { en: "reinforcement learning", zh: "\u5F37\u5316\u5B78\u7FD2" },
  { en: "distillation", zh: "\u84B8\u993E" },
  { en: "distill(?:s|ed|ing)?", zh: "\u84B8\u993E", bad: ["\u63D0\u7149"] },
  { en: "teacher models?", zh: "\u6559\u5E2B\u6A21\u578B" },
  { en: "student models?", zh: "\u5B78\u751F\u6A21\u578B", bad: ["\u5B78\u751F\u6A21\u5F0F"] },
  { en: "teachers?", zh: "\u6559\u5E2B" },
  { en: "students?", zh: "\u5B78\u751F" },
  { en: "overfitting", zh: "\u904E\u64EC\u5408" },
  { en: "underfitting", zh: "\u6B20\u64EC\u5408" },
  { en: "gradient descent", zh: "\u68AF\u5EA6\u4E0B\u964D" },
  { en: "backpropagation", zh: "\u53CD\u5411\u50B3\u64AD" },
  { en: "learning rates?", zh: "\u5B78\u7FD2\u7387" },
  { en: "batch sizes?", zh: "\u6279\u6B21\u5927\u5C0F" },
  { en: "epochs?", zh: "\u8A13\u7DF4\u8F2A\u6B21" },
  { en: "checkpoints?", zh: "\u6AA2\u67E5\u9EDE" },
  { en: "weights?", zh: "\u6B0A\u91CD" },
  { en: "parameters?", zh: "\u53C3\u6578" },
  { en: "hyperparameters?", zh: "\u8D85\u53C3\u6578" },
  { en: "quantiz(?:ation|ed)", zh: "\u91CF\u5316" },
  { en: "pruning", zh: "\u526A\u679D" },
  { en: "temperature", zh: "\u6EAB\u5EA6" },
  { en: "top-p", zh: null },
  { en: "top-k", zh: null },
  { en: "beam search", zh: "\u6CE2\u675F\u641C\u5C0B" },
  { en: "greedy decoding", zh: "\u8CAA\u5A6A\u89E3\u78BC" },
  { en: "sampling", zh: "\u53D6\u6A23" },
  { en: "perplexity", zh: "\u56F0\u60D1\u5EA6" },
  { en: "logits", zh: null },
  { en: "softmax", zh: null },
  { en: "dropout", zh: null },
  { en: "activation functions?", zh: "\u6D3B\u5316\u51FD\u6578" },
  { en: "rope", zh: "RoPE" },
  { en: "autoregressive", zh: "\u81EA\u8FF4\u6B78" },
  { en: "bidirectional", zh: "\u96D9\u5411" },
  { en: "encoder-decoder", zh: "\u7DE8\u78BC\u5668-\u89E3\u78BC\u5668" },
  { en: "decoder-only", zh: "\u50C5\u89E3\u78BC\u5668" },
  { en: "dense models?", zh: "\u7A20\u5BC6\u6A21\u578B" },
  { en: "sparse", zh: "\u7A00\u758F" },
  { en: "sharding", zh: "\u5206\u7247" },
  { en: "distributed training", zh: "\u5206\u6563\u5F0F\u8A13\u7DF4" },
  { en: "data parallel", zh: "\u8CC7\u6599\u4E26\u884C" },
  { en: "tensor parallel", zh: "\u5F35\u91CF\u4E26\u884C" },
  { en: "pipeline parallel", zh: "\u7BA1\u7DDA\u4E26\u884C" },
  { en: "mixed precision", zh: "\u6DF7\u5408\u7CBE\u5EA6" },
  { en: "loss functions?", zh: "\u640D\u5931\u51FD\u6578" },
  { en: "cross-entropy", zh: "\u4EA4\u53C9\u71B5" },
  { en: "regularization", zh: "\u6B63\u5247\u5316" },
  { en: "layer norm", zh: "\u5C64\u6B63\u898F\u5316" },
  { en: "normalization", zh: "\u6B63\u898F\u5316" },
  { en: "residual", zh: "\u6B98\u5DEE" },
  { en: "feedforward", zh: "\u524D\u994B" },
  { en: "synthetic data", zh: "\u5408\u6210\u8CC7\u6599" },
  { en: "human feedback", zh: "\u4EBA\u985E\u56DE\u994B" },
  { en: "structured outputs?", zh: "\u7D50\u69CB\u5316\u8F38\u51FA" },
  { en: "json mode", zh: "JSON \u6A21\u5F0F" },
  { en: "hallucinations?", zh: "\u5E7B\u89BA" },
  { en: "reasoning", zh: "\u63A8\u7406" },
  { en: "alignment", zh: "\u5C0D\u9F4A" },
  { en: "red teaming", zh: "\u7D05\u968A\u6E2C\u8A66" },
  { en: "jailbreaks?", zh: "\u8D8A\u7344" },
  { en: "guardrails?", zh: "\u8B77\u6B04" },
  { en: "evals?", zh: "\u8A55\u6E2C" },
  { en: "leaderboards?", zh: "\u6392\u884C\u699C" },
  { en: "scaling laws?", zh: "\u898F\u6A21\u6CD5\u5247" },
  { en: "emergent abilities", zh: "\u6E67\u73FE\u80FD\u529B" },
  { en: "corpus|corpora", zh: "\u8A9E\u6599\u5EAB" },
  { en: "deduplication", zh: "\u53BB\u91CD" },
  { en: "assistant", zh: "\u52A9\u624B" },
  { en: "optimizer", zh: "\u512A\u5316\u5668" },
  { en: "router", zh: "\u8DEF\u7531\u5668" },
  { en: "autonomous", zh: "\u81EA\u4E3B" }
];
const AI_STRONG_RE = /\b(ai|agi|llm|gpt|chatgpt|claude|gemini|llama|mistral|qwen|deepseek|grok|neural|transformers?|diffusion|embeddings?|rag|chatbots?|fine-tun\w*|quantiz\w*|vllm|pagedattention|nous|machine learning|deep learning|generative ai|artificial intelligence|language models?)\b/i;
const AI_WEAK_RE = /\b(models?|tokens?|prompts?|agents?|weights?|training|reasoning|inference|checkpoints?)\b/gi;
function hasAiContext(text, hint) {
  if (AI_STRONG_RE.test(hint) || AI_STRONG_RE.test(text)) return true;
  const seen = /* @__PURE__ */ new Set();
  for (const hay of [text, hint]) {
    for (const m of hay.matchAll(AI_WEAK_RE)) {
      seen.add(m[1].toLowerCase());
      if (seen.size >= 2) return true;
    }
  }
  return false;
}
const SKIP_RE = /(\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;
function buildMatcher(entries) {
  const sorted = [...entries].sort((a, b) => b.en.length - a.en.length);
  const src = sorted.map((e, i) => `(?<g${i}>(?<!\\w)(?:${e.en})(?!\\w))`).join("|");
  return { re: new RegExp(src, "gi"), entries: sorted };
}
const ALWAYS_MATCHER = buildMatcher(ALWAYS);
const FULL_MATCHER = buildMatcher([...ALWAYS, ...AI_ONLY]);
function findTermMatches(text, contextHint = "") {
  if (!text) return [];
  const aiContext = hasAiContext(text, contextHint);
  const matcher = aiContext ? FULL_MATCHER : ALWAYS_MATCHER;
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const parts = text.split(SKIP_RE);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i].replace(matcher.re, (...args) => {
      const groups = args[args.length - 1];
      const matched = args[0];
      for (const name of Object.keys(groups)) {
        if (groups[name] !== void 0) {
          const key = matched.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            const entry = matcher.entries[Number(name.slice(1))];
            out.push({ en: matched, zh: entry.zh === null ? matched : entry.zh, bad: entry.bad ?? [] });
          }
          break;
        }
      }
      return matched;
    });
  }
  return out;
}
const ANCHORED = [...ALWAYS, ...AI_ONLY].map((e) => ({
  re: new RegExp(`^(?:${e.en})$`, "i"),
  zh: e.zh
}));
function lookupGlossary(term) {
  const t = term.trim();
  if (!t || /[\u4e00-\u9fff]/.test(t)) return null;
  for (const { re, zh } of ANCHORED) {
    if (re.test(t)) return zh === null ? t : zh;
  }
  return null;
}
export {
  findTermMatches,
  lookupGlossary
};
