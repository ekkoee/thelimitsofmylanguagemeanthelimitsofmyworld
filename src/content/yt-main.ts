// Runs in YouTube's PAGE context at document_start (manifest "world": "MAIN").
//
// YouTube now blocks any third-party fetch of the caption file (empty/403), so
// instead of fetching it ourselves we INTERCEPT the request YouTube itself makes
// when the viewer turns captions on. YouTube's own request carries valid tokens,
// so the data comes back complete. We hook fetch + XHR before YouTube loads
// (possible because this script runs at document_start), capture the timedtext
// response, parse it into cues, and hand them to the isolated content script.
(function () {
  console.log('[IBT] page bridge ready (intercept mode)');

  let latest: { videoId: string | null; cues: any[]; lang: string; kind: string } | null = null;

  const currentV = (): string | null => {
    try { return new URL(location.href).searchParams.get('v'); } catch { return null; }
  };

  function decodeEntities(s: string): string {
    if (!s || s.indexOf('&') === -1) return s;
    const ta = document.createElement('textarea');
    ta.innerHTML = s;
    return ta.value;
  }

  function dedupe(cues: any[]): any[] {
    cues.sort((a, b) => a.start - b.start);
    for (let i = 0; i < cues.length; i++) {
      const n = cues[i + 1];
      if (!cues[i].end || cues[i].end <= cues[i].start) cues[i].end = n ? n.start : cues[i].start + 3000;
      if (n && cues[i].end > n.start) cues[i].end = n.start;
    }
    return cues;
  }

  function parseJson3(txt: string): any[] {
    const data = JSON.parse(txt);
    const cues: any[] = [];
    for (const ev of (data?.events || [])) {
      if (!ev.segs) continue;
      const text = ev.segs.map((s: any) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const start = ev.tStartMs || 0;
      cues.push({ start, end: start + (ev.dDurationMs || 0), text });
    }
    return dedupe(cues);
  }

  function parseXml(txt: string): any[] {
    const doc = new DOMParser().parseFromString(txt, 'text/xml');
    const nodes = Array.from(doc.getElementsByTagName('text'));
    const cues: any[] = [];
    for (const n of nodes) {
      const start = parseFloat(n.getAttribute('start') || '0') * 1000;
      const dur = parseFloat(n.getAttribute('dur') || '0') * 1000;
      const text = decodeEntities((n.textContent || '').replace(/\s+/g, ' ')).trim();
      if (!text) continue;
      cues.push({ start, end: start + dur, text });
    }
    return dedupe(cues);
  }

  function publish(): void {
    if (!latest) return;
    window.postMessage({
      source: 'ibt-main', type: 'cues', ok: true,
      videoId: latest.videoId, cues: latest.cues, lang: latest.lang, kind: latest.kind, via: 'intercept',
    }, '*');
  }

  function capture(url: string, text: string): void {
    try {
      if (!text || !text.trim() || url.indexOf('timedtext') === -1) return;
      const cues = text.trim()[0] === '{' ? parseJson3(text) : parseXml(text);
      if (!cues.length) return;
      const u = new URL(url, location.href);
      // a translated track (tlang set) is fine too; tag with the video id
      latest = {
        videoId: u.searchParams.get('v') || currentV(),
        cues,
        lang: u.searchParams.get('tlang') || u.searchParams.get('lang') || '',
        kind: u.searchParams.get('kind') || 'manual',
      };
      console.log('[IBT] 攔截到字幕:', latest.lang, '/', latest.kind, '—', cues.length, '句');
      publish();
    } catch { /* ignore non-caption or parse errors */ }
  }

  // ---- hook fetch ----
  const origFetch = window.fetch;
  window.fetch = function (this: any, ...args: any[]) {
    let url = '';
    try { const a0 = args[0]; url = typeof a0 === 'string' ? a0 : (a0 && a0.url) || ''; } catch { /* */ }
    const p = origFetch.apply(this, args as any);
    if (url && url.indexOf('timedtext') !== -1) {
      p.then((res: Response) => { try { res.clone().text().then((t) => capture(url, t)); } catch { /* */ } }).catch(() => {});
    }
    return p;
  } as any;

  // ---- hook XHR ----
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (this: any, method: string, url: string, ...rest: any[]) {
    this.__ibtUrl = url;
    return (origOpen as any).call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (this: any, ...a: any[]) {
    const url: string = this.__ibtUrl || '';
    if (url && url.indexOf('timedtext') !== -1) {
      this.addEventListener('load', () => { try { capture(url, this.responseText); } catch { /* */ } });
    }
    return (origSend as any).apply(this, a);
  };

  // ---- answer explicit polls (covers the case where CC was already on and the
  //      fetch happened before the isolated script started listening) ----
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window || !e.data || e.data.source !== 'ibt-iso') return;
    if (e.data.type === 'getCues') {
      if (latest && latest.videoId === currentV()) publish();
      else window.postMessage({ source: 'ibt-main', type: 'cues', ok: false, reason: 'waiting-cc' }, '*');
    }
  });
})();
