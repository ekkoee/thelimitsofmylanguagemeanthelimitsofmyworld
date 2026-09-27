// Bilingual term glossary for the FREE engines (Google gtx / Microsoft Edge).
//
// Why: the free endpoints mistranslate AI/tech terminology ("open-weights" →
// 開放重量機型, "knowledge distillation" → 知識萃取, "chain-of-thought" → 思路連鎖提示).
// LLM engines get these right, but cost a key + quota.
//
// How it works (service-worker correctTerminology, AFTER translation):
//   L1 — isolated-rendering swap: for each glossary term found in the source,
//        translate the term alone through the same engine; if the engine rendered
//        it differently in context, swap in our canonical form.
//   L2 — known-bad list: per-entry `bad` renderings observed empirically, replaced
//        whenever the source contains the English term (covers cases where the
//        isolated translation is already canonical but the in-context one isn't).
// Pre-translation substitution was tried and rejected: injected Chinese spans flip
// Google's auto language detection (it returns the text untranslated), and
// Microsoft partially echoes mixed text. Post-correction has neither problem and
// degrades gracefully when renderings don't line up.
//
// Two tiers:
//   - ALWAYS: proper nouns + unambiguous tech terms. Safe on any page.
//   - AI_ONLY: conceptual terms that are only safe when the text is about AI
//     (e.g. "weights" → 權重 would be wrong in a fitness article). Considered
//     only when AI_CONTEXT_RE matches the text (or the page title).
//
// Script note: entries are curated in Traditional Chinese (the default target).
// L2 and CJK-canonical L1 replacements only apply to Traditional targets; for
// Simplified targets we never inject Traditional spans (no mixed-script output).
// Term translations are persistently cached, so per-term requests happen once.

export interface GlossaryEntry {
  /** regex source (without \b wrappers — added at compile time), case-insensitive */
  en: string;
  /** Traditional Chinese; null = keep the matched text verbatim (proper nouns) */
  zh: string | null;
  /**
   * known-bad renderings observed from free engines (L2). Plain string → replaced
   * with zh; [badSpan, fixSpan] tuple → replaced with fixSpan (for cases where the
   * bad span covers more than the term, e.g. "few-shot prompting" → 幾次提示).
   */
  bad?: Array<string | [string, string]>;
}

// ---------------------------------------------------------------------------
// Tier 1: always safe — model / product / company names + unambiguous tech
// ---------------------------------------------------------------------------
const ALWAYS: GlossaryEntry[] = [
  // -- model & product names (keep verbatim) --
  { en: 'gpt-4o(?:-mini)?', zh: null },
  { en: 'gpt-4(?:-turbo|-[a-z0-9-]+)?', zh: null },
  { en: 'o1(?:-mini|-preview)?', zh: null },
  { en: 'o3(?:-mini)?', zh: null },
  { en: 'chatgpt', zh: null },
  { en: 'claude(?: (?:sonnet|opus|haiku))?(?: [\\d.]+)?', zh: null },
  { en: 'gemini(?: [\\d.]+(?: (?:flash|pro|ultra))?)?', zh: null },
  { en: 'llama(?: [\\d.]+)?', zh: null },
  { en: 'mistral(?: [a-z]+)?', zh: null },
  { en: 'mixtral', zh: null },
  { en: 'qwen\\d?(?:-[\\d.a-z]+)?', zh: null },
  { en: 'deepseek(?:-v\\d+)?', zh: null },
  { en: 'grok(?:-[\\d.]+)?', zh: null },
  { en: 'gemma(?: \\d+)?', zh: null },
  { en: 'phi(?:-\\d+)?', zh: null },
  { en: 'falcon', zh: null },
  { en: 'palm(?:-2)?', zh: null },
  { en: 'bert', zh: null },
  { en: 't5', zh: null },
  { en: 'whisper', zh: null },
  { en: 'dall-e', zh: null },
  { en: 'sora', zh: null },
  { en: 'veo', zh: null },
  { en: 'imagen', zh: null },
  { en: 'stable diffusion', zh: null },
  { en: 'flux(?:\\.\\d+)?', zh: null },
  { en: 'sdxl', zh: null },
  { en: 'midjourney', zh: null },
  { en: 'copilot', zh: null },
  { en: 'hermes agents?', zh: null }, // Hermes Agent (Nous Research) — keep verbatim
  { en: 'kimi', zh: null },
  { en: 'moonshot', zh: null },
  { en: 'codestral', zh: null },
  { en: 'clip', zh: null },
  // generic versioned model/artifact IDs: letters + separator + digits, e.g.
  // DeepSeek-V3, gpt-4o-mini, Qwen3-32B, llama-3.1-8b — keep verbatim
  { en: '(?=[a-z0-9._-]*\\d)[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)+', zh: null },

  // -- acronyms (keep verbatim) --
  { en: 'llms?', zh: null },
  { en: 'ai', zh: 'AI', bad: ['人工智慧', '人工智能'] },
  { en: 'agi', zh: null },
  { en: 'asi', zh: null },
  { en: 'nlp', zh: null },
  { en: 'rlhf', zh: null },
  { en: 'rag', zh: null },
  { en: 'moe', zh: null },
  { en: 'gan', zh: null },
  { en: 'vae', zh: null },
  { en: 'mcp', zh: null },
  { en: 'api', zh: null },
  { en: 'sdk', zh: null },
  { en: 'cli', zh: null },
  { en: 'gui', zh: null },
  { en: 'vram', zh: null },
  { en: 'cuda', zh: null },
  { en: 'cve(?:-\\d+-\\d+)?', zh: null },
  { en: 'ci/cd', zh: null },

  // -- common first names (keep verbatim) --
  // MT transliterates them (matt → 馬特), which reads terribly in casual /
  // social translation. Only unambiguous names are listed: excluded are ones
  // that double as common nouns (bill, mark, chase, frank, jack, will, bob...).
  { en: 'matt', zh: null },
  { en: 'john', zh: null },
  { en: 'david', zh: null },
  { en: 'mike', zh: null },
  { en: 'chris', zh: null },
  { en: 'sarah', zh: null },
  { en: 'emma', zh: null },
  { en: 'lisa', zh: null },
  { en: 'tom', zh: null },
  { en: 'steve', zh: null },
  { en: 'brian', zh: null },
  { en: 'kevin', zh: null },
  { en: 'andrew', zh: null },
  { en: 'josh', zh: null },
  { en: 'jennifer', zh: null },
  { en: 'jessica', zh: null },
  { en: 'emily', zh: null },
  { en: 'ashley', zh: null },
  { en: 'anna', zh: null },
  { en: 'kate', zh: null },
  { en: 'laura', zh: null },
  { en: 'nick', zh: null },
  { en: 'tony', zh: null },
  { en: 'ryan', zh: null },
  { en: 'jake', zh: null },
  { en: 'luke', zh: null },
  { en: 'sam', zh: null },
  { en: 'alex', zh: null },
  { en: 'ben', zh: null },
  { en: 'dan', zh: null },
  { en: 'tim', zh: null },
  { en: 'jim', zh: null },
  { en: 'joe', zh: null },
  { en: 'paul', zh: null },
  { en: 'peter', zh: null },
  { en: 'james', zh: null },
  { en: 'robert', zh: null },
  { en: 'michael', zh: null },
  { en: 'jonathan', zh: null },
  { en: 'stephen', zh: null },
  { en: 'greg', zh: null },
  { en: 'larry', zh: null },
  { en: 'dennis', zh: null },
  { en: 'aaron', zh: null },
  { en: 'nathan', zh: null },
  { en: 'jason', zh: null },
  { en: 'kyle', zh: null },
  { en: 'sean', zh: null },
  { en: 'patrick', zh: null },
  { en: 'ethan', zh: null },
  { en: 'liam', zh: null },
  { en: 'noah', zh: null },
  { en: 'olivia', zh: null },
  { en: 'sophia', zh: null },
  { en: 'mia', zh: null },
  { en: 'ava', zh: null },
  { en: 'zoe', zh: null },
  { en: 'amy', zh: null },
  { en: 'julia', zh: null },
  { en: 'rachel', zh: null },
  { en: 'hannah', zh: null },
  { en: 'rebecca', zh: null },
  { en: 'daniel', zh: null },
  { en: 'justin', zh: null },
  { en: 'eric', zh: null },
  { en: 'scott', zh: null },
  { en: 'jeff', zh: null },
  { en: 'adam', zh: null },
  { en: 'leo', zh: null },

  // -- well-known tech personalities (keep verbatim, normalized case) --
  // chamath transliterates inconsistently (查馬斯 in-sentence vs 查馬特 alone),
  // so L1 alone can't catch it — L2 covers the observed variants.
  { en: 'chamath', zh: 'Chamath', bad: ['查馬斯', '查馬特'] },
  { en: 'elon', zh: 'Elon' },
  { en: 'vitalik', zh: 'Vitalik' },
  { en: 'balaji', zh: 'Balaji' },

  // -- social handles & crypto/popular slang --
  // @muse: a handle is a proper noun — never transliterate to 繆斯.
  { en: '@muse', zh: null },
  // gm/gn: the crypto-Twitter greeting ("good morning" / "good night").
  // Keeping the abbreviation verbatim is also correct for General Motors.
  { en: 'gm', zh: 'GM' },
  { en: 'gn', zh: 'GN' },
  { en: 'hodl', zh: 'HODL' },
  { en: 'frens?', zh: null },
  { en: 'wagmi', zh: null },
  { en: 'ngmi', zh: null },
  { en: 'dyor', zh: 'DYOR' },
  { en: 'nfa', zh: 'NFA' },
  { en: 'degen', zh: null },
  { en: 'ath', zh: null },
  { en: 'fomo', zh: null },
  { en: 'fud', zh: null },
  { en: 'rekt', zh: null },
  { en: 'meme coins?', zh: '迷因幣' },
  { en: 'airdrops?', zh: '空投' },
  { en: 'stablecoins?', zh: '穩定幣' },
  { en: 'bull markets?', zh: '牛市' },
  { en: 'bear markets?', zh: '熊市' },
  { en: 'on-?chain', zh: '鏈上' },
  { en: 'vibe coding', zh: null },

  // -- companies / orgs (keep verbatim) --
  { en: 'openai', zh: null },
  { en: 'anthropic', zh: null },
  { en: 'nous(?: research)?', zh: null }, // Nous Research (Hermes) — never translate the company name
  { en: 'google deepmind', zh: 'Google DeepMind' },
  { en: 'deepmind', zh: 'DeepMind' },
  { en: 'hugging ?face', zh: 'Hugging Face' },
  { en: 'mistral ai', zh: 'Mistral AI' },
  { en: 'xai', zh: 'xAI' },
  { en: 'cohere', zh: null },
  { en: 'perplexity', zh: null },
  { en: 'databricks', zh: null },
  { en: 'nvidia', zh: null },
  { en: 'tsmc', zh: null },

  // -- unambiguous tech terms --
  { en: 'large language models?', zh: '大型語言模型' },
  { en: 'natural language processing', zh: '自然語言處理' },
  { en: 'open-source', zh: '開源' },
  { en: 'closed-source', zh: '閉源' },
  { en: 'open-weights', zh: '開放權重', bad: ['開放重量'] },
  { en: 'benchmarks?', zh: '基準' },
  { en: 'latency', zh: '延遲' },
  { en: 'throughput', zh: '吞吐量' },
  { en: 'streaming', zh: '串流' },
  { en: 'containers?', zh: '容器' },
  { en: 'docker', zh: null },
  { en: 'kubernetes', zh: null },
  { en: 'microservices?', zh: '微服務' },
  { en: 'serverless', zh: '無伺服器' },
  { en: 'orchestration', zh: '編排' },
  { en: 'deployments?', zh: '部署' },
  { en: 'cloud', zh: '雲端' },
  { en: 'on-prem(?:ise)?', zh: '地端' },
  { en: 'repositor(?:y|ies)', zh: '儲存庫' },
  { en: 'repos?', zh: '儲存庫' },
  { en: 'codebase', zh: '程式碼庫' },
  { en: 'plugins?', zh: '外掛' },
  { en: 'browser extensions?', zh: '瀏覽器擴充功能' },
  { en: 'tech debt', zh: '技術債' },
  { en: 'stack traces?', zh: '堆疊追蹤' },
  { en: 'debugger', zh: '除錯器' },
  { en: 'firewall', zh: '防火牆' },
  { en: 'vpn', zh: null },
  { en: 'malware', zh: '惡意軟體' },
  { en: 'ransomware', zh: '勒索軟體' },
  { en: 'phishing', zh: '網路釣魚' },
  { en: 'zero-days?', zh: '零日漏洞' },
  { en: 'chatbots?', zh: '聊天機器人' },
  { en: 'prompt engineering', zh: '提示工程' },
  { en: 'prompt injection', zh: '提示詞注入' },
  { en: 'system prompts?', zh: '系統提示詞' },
  { en: 'few-shot', zh: '少樣本', bad: ['少量例子', '少點', ['幾次提示', '少樣本提示']] },
  { en: 'zero-shot', zh: '零樣本' },
  { en: 'one-shot', zh: '單樣本' },
  { en: 'in-context learning', zh: '上下文學習' },
  { en: 'chain-of-thought', zh: '思維鏈', bad: ['思路連鎖', '思緒鏈', '思路鏈'] },
  { en: 'chain of thought', zh: '思維鏈', bad: ['思路連鎖', '思緒鏈', '思路鏈'] },
  { en: 'retrieval-augmented generation', zh: '檢索增強生成' },
  { en: 'reinforcement learning from human feedback', zh: '人類回饋強化學習' },
  { en: 'knowledge distillation', zh: '知識蒸餾', bad: ['知識萃取', '知識提煉'] },
  { en: 'mixture[ -]of[ -]experts', zh: '混合專家', bad: ['專家混合'] },
  { en: 'text-to-image', zh: '文生圖' },
  { en: 'text-to-speech', zh: '文字轉語音' },
  { en: 'speech-to-text', zh: '語音轉文字' },
  { en: 'image generation', zh: '圖像生成' },
  { en: 'speech recognition', zh: '語音辨識' },
  { en: 'computer vision', zh: '電腦視覺' },
  { en: 'self-attention', zh: '自注意力' },
  { en: 'multi-head attention', zh: '多頭注意力' },
  { en: 'sliding window attention', zh: '滑動窗口注意力' },
  { en: 'grouped-query attention', zh: '分組查詢注意力' },
  { en: 'positional encoding', zh: '位置編碼' },
  { en: 'next-token prediction', zh: '下一個詞元預測' },
  { en: 'kv cache', zh: 'KV 快取' },
  { en: 'continuous batching', zh: '連續批處理', bad: ['持續批次處理'] },
  { en: 'pagedattention', zh: 'PagedAttention' },
  { en: 'vllm', zh: 'vLLM' },
  { en: 'flash ?attention', zh: 'FlashAttention' },
  { en: 'speculative decoding', zh: '推測解碼' },
];

// ---------------------------------------------------------------------------
// Tier 2: AI-context only — common words with a precise AI meaning
// ---------------------------------------------------------------------------
const AI_ONLY: GlossaryEntry[] = [
  // Nous Research models (keep verbatim; "fable" is a common word outside AI)
  { en: 'astra', zh: null, bad: ['阿斯特拉'] },
  { en: 'fable', zh: null, bad: ['寓言', '預言'] },
  { en: 'models?', zh: '模型' },
  { en: 'transformers?', zh: 'Transformer' },
  { en: 'diffusion models?', zh: '擴散模型' },
  { en: 'foundation models?', zh: '基礎模型' },
  { en: 'frontier models?', zh: '前沿模型' },
  { en: 'multimodal', zh: '多模態' },
  { en: 'vision-language models?', zh: '視覺語言模型' },
  { en: 'world models?', zh: '世界模型' },
  { en: 'neural networks?', zh: '神經網路' },
  { en: 'deep learning', zh: '深度學習' },
  { en: 'machine learning', zh: '機器學習' },
  { en: 'embeddings?', zh: '嵌入' },
  { en: 'vector databases?', zh: '向量資料庫' },
  { en: 'tokens?', zh: '詞元', bad: ['代幣', '令牌'] },
  { en: 'tokenizers?', zh: '分詞器' },
  { en: 'special tokens?', zh: '特殊詞元' },
  { en: 'context windows?', zh: '上下文窗口', bad: ['上下文視窗'] },
  { en: 'long context', zh: '長上下文' },
  { en: 'prompts?', zh: '提示詞' },
  { en: 'prompting', zh: '提示' },
  { en: 'prompted', zh: '提示' },
  { en: 'prompt caching', zh: '提示快取' },
  { en: 'agents?', zh: null, bad: ['代理人', '代理'] }, // user asked: never translate Agent
  { en: 'agentic', zh: '代理式' },
  { en: 'multi-agent', zh: '多代理' },
  { en: 'tool calling', zh: '工具呼叫' },
  { en: 'function calling', zh: '函式呼叫' },
  { en: 'tool use', zh: '工具使用' },
  { en: 'inference', zh: '推論' },
  { en: 'training', zh: '訓練' },
  { en: 'pre-?train(?:ing|ed)?', zh: '預訓練' },
  { en: 'post-training', zh: '後訓練' },
  { en: 'fine-tun(?:e|ed|ing)', zh: '微調' },
  { en: 'instruction tuning', zh: '指令微調' },
  { en: 'supervised', zh: '監督式' },
  { en: 'unsupervised', zh: '非監督式' },
  { en: 'self-supervised', zh: '自監督式' },
  { en: 'reinforcement learning', zh: '強化學習' },
  { en: 'distillation', zh: '蒸餾' },
  { en: 'distill(?:s|ed|ing)?', zh: '蒸餾', bad: ['提煉'] },
  { en: 'teacher models?', zh: '教師模型' },
  { en: 'student models?', zh: '學生模型', bad: ['學生模式'] },
  { en: 'teachers?', zh: '教師' },
  { en: 'students?', zh: '學生' },
  { en: 'overfitting', zh: '過擬合' },
  { en: 'underfitting', zh: '欠擬合' },
  { en: 'gradient descent', zh: '梯度下降' },
  { en: 'backpropagation', zh: '反向傳播' },
  { en: 'learning rates?', zh: '學習率' },
  { en: 'batch sizes?', zh: '批次大小' },
  { en: 'epochs?', zh: '訓練輪次' },
  { en: 'checkpoints?', zh: '檢查點' },
  { en: 'weights?', zh: '權重' },
  { en: 'parameters?', zh: '參數' },
  { en: 'hyperparameters?', zh: '超參數' },
  { en: 'quantiz(?:ation|ed)', zh: '量化' },
  { en: 'pruning', zh: '剪枝' },
  { en: 'temperature', zh: '溫度' },
  { en: 'top-p', zh: null },
  { en: 'top-k', zh: null },
  { en: 'beam search', zh: '波束搜尋' },
  { en: 'greedy decoding', zh: '貪婪解碼' },
  { en: 'sampling', zh: '取樣' },
  { en: 'perplexity', zh: '困惑度' },
  { en: 'logits', zh: null },
  { en: 'softmax', zh: null },
  { en: 'dropout', zh: null },
  { en: 'activation functions?', zh: '活化函數' },
  { en: 'rope', zh: 'RoPE' },
  { en: 'autoregressive', zh: '自迴歸' },
  { en: 'bidirectional', zh: '雙向' },
  { en: 'encoder-decoder', zh: '編碼器-解碼器' },
  { en: 'decoder-only', zh: '僅解碼器' },
  { en: 'dense models?', zh: '稠密模型' },
  { en: 'sparse', zh: '稀疏' },
  { en: 'sharding', zh: '分片' },
  { en: 'distributed training', zh: '分散式訓練' },
  { en: 'data parallel', zh: '資料並行' },
  { en: 'tensor parallel', zh: '張量並行' },
  { en: 'pipeline parallel', zh: '管線並行' },
  { en: 'mixed precision', zh: '混合精度' },
  { en: 'loss functions?', zh: '損失函數' },
  { en: 'cross-entropy', zh: '交叉熵' },
  { en: 'regularization', zh: '正則化' },
  { en: 'layer norm', zh: '層正規化' },
  { en: 'normalization', zh: '正規化' },
  { en: 'residual', zh: '殘差' },
  { en: 'feedforward', zh: '前饋' },
  { en: 'synthetic data', zh: '合成資料' },
  { en: 'human feedback', zh: '人類回饋' },
  { en: 'structured outputs?', zh: '結構化輸出' },
  { en: 'json mode', zh: 'JSON 模式' },
  { en: 'hallucinations?', zh: '幻覺' },
  { en: 'reasoning', zh: '推理' },
  { en: 'alignment', zh: '對齊' },
  { en: 'red teaming', zh: '紅隊測試' },
  { en: 'jailbreaks?', zh: '越獄' },
  { en: 'guardrails?', zh: '護欄' },
  { en: 'evals?', zh: '評測' },
  { en: 'leaderboards?', zh: '排行榜' },
  { en: 'scaling laws?', zh: '規模法則' },
  { en: 'emergent abilities', zh: '湧現能力' },
  { en: 'corpus|corpora', zh: '語料庫' },
  { en: 'deduplication', zh: '去重' },
  { en: 'assistant', zh: '助手' },
  { en: 'optimizer', zh: '優化器' },
  { en: 'router', zh: '路由器' },
  { en: 'autonomous', zh: '自主' },
];

// Seed terms that mark a text as "about AI" → Tier-2 entries are considered.
// Two levels: STRONG signals (unambiguous AI markers) trigger on their own;
// WEAK signals (common words like "model") need at least two distinct ones —
// so "The model walked down the runway" doesn't get AI treatment.
const AI_STRONG_RE =
  /\b(ai|agi|llm|gpt|chatgpt|claude|gemini|llama|mistral|qwen|deepseek|grok|neural|transformers?|diffusion|embeddings?|rag|chatbots?|fine-tun\w*|quantiz\w*|vllm|pagedattention|nous|machine learning|deep learning|generative ai|artificial intelligence|language models?)\b/i;
const AI_WEAK_RE = /\b(models?|tokens?|prompts?|agents?|weights?|training|reasoning|inference|checkpoints?)\b/gi;

function hasAiContext(text: string, hint: string): boolean {
  if (AI_STRONG_RE.test(hint) || AI_STRONG_RE.test(text)) return true;
  const seen = new Set<string>();
  for (const hay of [text, hint]) {
    for (const m of hay.matchAll(AI_WEAK_RE)) {
      seen.add(m[1].toLowerCase());
      if (seen.size >= 2) return true;
    }
  }
  return false;
}

// URLs / emails must never match terms.
const SKIP_RE = /(\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

interface Matcher {
  re: RegExp;
  entries: GlossaryEntry[];
}

function buildMatcher(entries: GlossaryEntry[]): Matcher {
  // longest pattern first → alternation prefers the longest match at each position
  const sorted = [...entries].sort((a, b) => b.en.length - a.en.length);
  // (?<!\w)/(?!\w) instead of \b so patterns that start/end with non-word
  // chars (e.g. @muse) still match; \b would fail at string start for those.
  const src = sorted.map((e, i) => `(?<g${i}>(?<!\\w)(?:${e.en})(?!\\w))`).join('|');
  return { re: new RegExp(src, 'gi'), entries: sorted };
}

const ALWAYS_MATCHER = buildMatcher(ALWAYS);
const FULL_MATCHER = buildMatcher([...ALWAYS, ...AI_ONLY]);

export interface TermMatch {
  /** the term as it appears in the source text */
  en: string;
  /** canonical translation (the source text itself for keep-verbatim terms) */
  zh: string;
  /** known-bad renderings → replaced with zh (or the tuple's fix span) (L2) */
  bad: Array<string | [string, string]>;
}

/**
 * Find glossary terms in the source text. URLs and emails are skipped.
 * Returns unique matches (case-insensitive dedupe).
 */
export function findTermMatches(text: string, contextHint = ''): TermMatch[] {
  if (!text) return [];
  const aiContext = hasAiContext(text, contextHint);
  const matcher = aiContext ? FULL_MATCHER : ALWAYS_MATCHER;
  const seen = new Set<string>();
  const out: TermMatch[] = [];
  // split keeps the skipped spans (odd indices) out of matching
  const parts = text.split(SKIP_RE);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i].replace(matcher.re, (...args: unknown[]) => {
      const groups = args[args.length - 1] as Record<string, string | undefined>;
      const matched = args[0] as string;
      for (const name of Object.keys(groups)) {
        if (groups[name] !== undefined) {
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

// Anchored whole-term matchers for the double-click popup: if the entire
// selection is one glossary term, answer instantly without an API call.
const ANCHORED = [...ALWAYS, ...AI_ONLY].map((e) => ({
  re: new RegExp(`^(?:${e.en})$`, 'i'),
  zh: e.zh,
}));

/** Whole-selection glossary hit → translation (or the original text for keep-verbatim terms). Null = no hit. */
export function lookupGlossary(term: string): string | null {
  const t = term.trim();
  if (!t || /[\u4e00-\u9fff]/.test(t)) return null;
  for (const { re, zh } of ANCHORED) {
    if (re.test(t)) return zh === null ? t : zh;
  }
  return null;
}
