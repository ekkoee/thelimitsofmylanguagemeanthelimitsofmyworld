// Sound-effect / non-speech annotations in video captions — e.g. [music],
// [applause], (laughing), ♪ music ♪. Translating them (→ [音樂]) is pure noise,
// so they are stripped before translation; a cue that is ONLY annotations is
// skipped entirely (no Chinese line shown). Mirrors read-frog's
// utils/subtitles/fetchers/youtube/noise-filter.ts approach.

const NOISE_PATTERNS: RegExp[] = [
/\[.*?\]/g, // [Music], [Applause], [Speaker 1], [inaudible]
/\(.*?\)/g, // (Music), (Applause), (laughing)
//g, //
/（.*?）/g, // （笑）
/♪.*?♪/g, // ♪ Music ♪
/🎵.*?🎵/g,
/🎶.*?🎶/g,
];

/** Remove sound-effect annotations; mixed content keeps the spoken part. */
export function stripSubtitleNoise(text: string): string {
let out = text;
for (const re of NOISE_PATTERNS) {
re.lastIndex = 0;
out = out.replace(re, '');
}
return out.replace(/\s{2,}/g, ' ').trim();
}

/** True when a cue holds nothing worth translating — e.g. "[music]", "(applause) ♪". */
export function isAnnotationOnly(text: string): boolean {
const t = text.trim();
if (!t) return true;
// A lone musical-note run with no words is also just ambience.
if (/^[♪♫🎵🎶\s]+$/.test(t)) return true;
return stripSubtitleNoise(t).length === 0;
}
