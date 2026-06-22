// Two-layer translation cache used in the background service worker.
//  - in-memory Map for the current SW lifetime (fast, no quota)
//  - optional chrome.storage.local persistence keyed by content hash
// Keys incorporate provider+model+targetLang so switching models is safe.

const mem = new Map<string, string>();
const LOCAL_PREFIX = 'ibt_tc_';
const MAX_MEM = 5000;

export function cacheKey(provider: string, model: string, target: string, sentence: string): string {
  return `${provider}|${model}|${target}|${hash(sentence)}`;
}

export async function getCached(keys: string[], persist: boolean): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const missing: string[] = [];
  for (const k of keys) {
    if (mem.has(k)) found.set(k, mem.get(k)!);
    else missing.push(k);
  }
  if (persist && missing.length) {
    const localKeys = missing.map((k) => LOCAL_PREFIX + k);
    const got = await chrome.storage.local.get(localKeys);
    for (const k of missing) {
      const v = got[LOCAL_PREFIX + k];
      if (typeof v === 'string') {
        found.set(k, v);
        memSet(k, v);
      }
    }
  }
  return found;
}

export async function putCached(entries: Map<string, string>, persist: boolean): Promise<void> {
  const localPatch: Record<string, string> = {};
  for (const [k, v] of entries) {
    memSet(k, v);
    if (persist) localPatch[LOCAL_PREFIX + k] = v;
  }
  if (persist && Object.keys(localPatch).length) {
    try { await chrome.storage.local.set(localPatch); } catch { /* quota — ignore */ }
  }
}

export async function clearPersistentCache(): Promise<void> {
  mem.clear();
  const all = await chrome.storage.local.get(null);
  const toRemove = Object.keys(all).filter((k) => k.startsWith(LOCAL_PREFIX));
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
}

function memSet(k: string, v: string) {
  if (mem.size >= MAX_MEM) {
    const first = mem.keys().next().value;
    if (first) mem.delete(first);
  }
  mem.set(k, v);
}

// djb2 — small, fast, good enough for cache keys (not security)
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
