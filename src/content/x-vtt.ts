// X serves closed captions as WebVTT from video.twimg.com/subtitles/...
// Each cue is wrapped in <X-word-ms ms=... character_ranges=...>text</X-word-ms>.
// The visible line is the text; the tag is only word timing.

export interface XCue {
  start: number; // ms
  end: number;
  text: string;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.](\d{1,3})/;

export function stripXTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function toMs(h: string | undefined, m: string, s: string, frac: string): number {
  const hours = h ? Number(h) : 0;
  const ms = Number((frac + '000').slice(0, 3));
  return ((hours * 60 + Number(m)) * 60 + Number(s)) * 1000 + ms;
}

/** Pull timed lines out of an X WebVTT file. Empty and tag-only cues are dropped. */
export function parseXVtt(vtt: string): XCue[] {
  const src = vtt.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const blocks = src.split(/\n{2,}/);
  const cues: XCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx === -1) continue;
    const parts = lines[timeIdx].split(/\s+-->\s+/);
    if (parts.length < 2) continue;
    const a = TIME.exec(parts[0]);
    const b = TIME.exec(parts[1]);
    if (!a || !b) continue;
    const text = stripXTags(lines.slice(timeIdx + 1).join(' '));
    if (!text) continue;
    const start = toMs(a[1], a[2], a[3], a[4]);
    let end = toMs(b[1], b[2], b[3], b[4]);
    if (end <= start) end = start + 1200;
    cues.push({ start, end, text });
  }
  cues.sort((x, y) => x.start - y.start);
  return cues;
}

/** Numeric media id inside an X subtitle or thumbnail URL, or ''. */
export function mediaIdFromUrl(url: string): string {
  const m = url.match(/\/(?:subtitles|amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb|amplify_video|ext_tw_video)\/(?:amplify_video|ext_tw_video|tweet_video)?\/?(\d{6,})/);
  if (m) return m[1];
  const m2 = url.match(/\/(\d{10,})\//);
  return m2 ? m2[1] : '';
}

/** Subtitle file or playlist URLs mentioned by an HLS manifest. */
export function subtitleUris(playlist: string, baseUrl: string): string[] {
  const out: string[] = [];
  const lines = playlist.split(/\r?\n/);
  for (const line of lines) {
    const tagged = /TYPE=SUBTITLES/i.test(line) ? line.match(/URI="([^"]+)"/) : null;
    const raw = tagged?.[1] || (/^[^#].+\.vtt(\?|$)/i.test(line.trim()) ? line.trim() : '');
    if (!raw) continue;
    try { out.push(new URL(raw, baseUrl).href); } catch { /* bad uri */ }
  }
  return out;
}

/**
 * Caption box in the player's coordinate space, centered on the video picture
 * and lifted above the control bar and any bottom letterbox.
 */
export function xCaptionBox(video: Rect, player: Rect, controlsOverlap: number): { center: number; bottom: number; maxWidth: number } {
  const letterbox = Math.max(0, player.bottom - video.bottom);
  const margin = Math.round(Math.max(8, video.height * 0.06));
  const bottom = Math.round(letterbox + margin + Math.max(0, controlsOverlap));
  const center = Math.round((video.left - player.left) + video.width / 2);
  const maxWidth = Math.max(80, Math.round(video.width * 0.92));
  return { center, bottom, maxWidth };
}
