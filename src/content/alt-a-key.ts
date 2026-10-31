/** Alt+A, including layouts where the key produces "å" instead of "a". `code` is the physical key. */
export function isAltA(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; repeat?: boolean; code?: string; key?: string }): boolean {
  if (e.repeat) return false;
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  if (e.code === 'KeyA') return true;
  const k = e.key || '';
  return k === 'a' || k === 'A' || k === 'å' || k === 'Å';
}
