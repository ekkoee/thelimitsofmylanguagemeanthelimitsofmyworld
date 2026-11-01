/** BCP-47 tag for line breaking. The target language, not the page font hint. */
export function langTag(code: string | null | undefined): string {
  const raw = (code || '').trim();
  const lower = raw.toLowerCase().replace(/_/g, '-');
  if (lower.startsWith('ko')) return 'ko';
  if (lower.startsWith('ja')) return 'ja';
  if (lower === 'zh-cn' || lower.includes('hans')) return 'zh-CN';
  if (lower.startsWith('zh')) return 'zh-TW';
  if (lower.startsWith('en')) return 'en';
  if (lower.startsWith('de')) return 'de';
  if (lower.startsWith('fr')) return 'fr';
  if (lower.startsWith('es')) return 'es';
  return raw || 'zh-TW';
}
