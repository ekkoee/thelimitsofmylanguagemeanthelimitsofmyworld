// Runs in X's page context at document_start (manifest world: MAIN).
//
// X closed captions are WebVTT files from video.twimg.com/subtitles/...
// fetched when the viewer turns CC on (and sometimes listed from the HLS
// playlist). Hook fetch + XHR, parse the file, and hand the cues to the
// isolated content script. We do not OCR pixels, so burned-in captions
// (text painted into the video) never show up here.
(function () {
  const tracks = new Map<string, { mediaId: string; url: string; cues: { start: number; end: number; text: string }[] }>();

  function strip(s: string): string {
    return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function toMs(h: string | undefined, m: string, s: string, frac: string): number {
    const ms = Number((frac + '000').slice(0, 3));
    return (((h ? Number(h) : 0) * 60 + Number(m)) * 60 + Number(s)) * 1000 + ms;
  }
  function parseVtt(vtt: string): { start: number; end: number; text: string }[] {
    const time = /(?:(\d+):)?(\d{1,2}):(\d{2})[.](\d{1,3})/;
    const cues: { start: number; end: number; text: string }[] = [];
    for (const block of vtt.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split(/\n{2,}/)) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const i = lines.findIndex((l) => l.includes('-->'));
      if (i === -1) continue;
      const parts = lines[i].split(/\s+-->\s+/);
      const a = time.exec(parts[0] || '');
      const b = time.exec(parts[1] || '');
      if (!a || !b) continue;
      const text = strip(lines.slice(i + 1).join(' '));
      if (!text) continue;
      const start = toMs(a[1], a[2], a[3], a[4]);
      let end = toMs(b[1], b[2], b[3], b[4]);
      if (end <= start) end = start + 1200;
      cues.push({ start, end, text });
    }
    cues.sort((x, y) => x.start - y.start);
    return cues;
  }
  function mediaId(url: string): string {
    const m = url.match(/\/(?:subtitles|amplify_video|ext_tw_video|tweet_video)\/(?:amplify_video|ext_tw_video|tweet_video)?\/?(\d{6,})/);
    return m ? m[1] : '';
  }
  function publishOne(mediaId: string): void {
    const t = tracks.get(mediaId);
    if (!t) return;
    window.postMessage({ source: 'ibt-x-main', type: 'cues', ok: true, mediaId: t.mediaId, url: t.url, cues: t.cues }, '*');
  }
  function publishAll(): void {
    if (!tracks.size) {
      window.postMessage({ source: 'ibt-x-main', type: 'cues', ok: false, reason: 'waiting-cc' }, '*');
      return;
    }
    for (const id of tracks.keys()) publishOne(id);
  }
  function store(url: string, text: string): void {
    const cues = parseVtt(text);
    if (!cues.length) return;
    const id = mediaId(url) || url;
    tracks.set(id, { mediaId: id, url, cues });
    console.log('[IBT] X 字幕軌', id, cues.length, '句');
    publishOne(id);
  }
  function looksVtt(url: string): boolean {
    return /\.vtt(\?|$)/i.test(url) || url.indexOf('/subtitles/') !== -1;
  }
  function harvestPlaylist(url: string, text: string): void {
    if (!text || text.indexOf('#EXTM3U') === -1) return;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const tagged = /TYPE=SUBTITLES/i.test(line) ? line.match(/URI="([^"]+)"/) : null;
      const raw = tagged?.[1] || (/^[^#].+\.vtt(\?|$)/i.test(line.trim()) ? line.trim() : '');
      if (!raw) continue;
      let abs = raw;
      try { abs = new URL(raw, url).href; } catch { /* keep raw */ }
      if (tracks.has(mediaId(abs) || abs)) continue;
      origFetch(abs).then((r) => r.text()).then((t) => {
        if (t.indexOf('#EXTM3U') !== -1) harvestPlaylist(abs, t);
        else store(abs, t);
      }).catch(() => {});
    }
  }

  const origFetch = window.fetch;
  window.fetch = function (this: unknown, ...args: unknown[]) {
    let url = '';
    try {
      const a0 = args[0] as { url?: string } | string;
      url = typeof a0 === 'string' ? a0 : (a0 && a0.url) || '';
    } catch { /* */ }
    const p = origFetch.apply(this, args as [RequestInfo, RequestInit]);
    if (url && (looksVtt(url) || /\.m3u8(\?|$)/i.test(url))) {
      p.then((res) => {
        try {
          res.clone().text().then((t) => {
            if (looksVtt(url) || /^\s*WEBVTT/i.test(t)) store(url, t);
            else harvestPlaylist(url, t);
          });
        } catch { /* */ }
      }).catch(() => {});
    }
    return p;
  } as typeof window.fetch;

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __ibtUrl?: string }, method: string, url: string | URL, ...rest: unknown[]) {
    this.__ibtUrl = String(url);
    return origOpen.call(this, method, url, ...(rest as [boolean, string, string]));
  };
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __ibtUrl?: string }, ...a: unknown[]) {
    const url = this.__ibtUrl || '';
    if (looksVtt(url) || /\.m3u8(\?|$)/i.test(url)) {
      this.addEventListener('load', () => {
        try {
          const t = String(this.responseText || '');
          if (looksVtt(url) || /^\s*WEBVTT/i.test(t)) store(url, t);
          else harvestPlaylist(url, t);
        } catch { /* */ }
      });
    }
    return origSend.apply(this, a as [Document | XMLHttpRequestBodyInit | null]);
  };

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window || !e.data || e.data.source !== 'ibt-x-iso') return;
    if (e.data.type === 'getCues') publishAll();
  });
  console.log('[IBT] X subtitle bridge ready');
})();
