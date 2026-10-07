// Alt+A handler for non-auto sites (BBC, blogs, docs, …).
// Runs as a content script on all http/https pages via manifest matches.
//
// Why not go through the service worker? The original used chrome.commands,
// which grants the SW `activeTab` so it can executeScript the universal
// translator. A content-script→SW message does NOT grant activeTab, so the
// SW's executeScript is denied. Instead, this script IS already on the page —
// it directly instantiates UniversalTranslator, no extra permission needed.
//
// Auto-sites (x/reddit/youtube) are excluded: content.js handles Alt+A there.
import { loadSettings, onSettingsChanged } from '../core/storage';
import { applyRootState, cycleView, VIEW_LABEL } from '../utils/dom';
import { UniversalTranslator, toast } from './universal';
import { Settings } from '../core/types';

const AUTO_SITE_RE = /^https?:\/\/([^/]*\.)?(x\.com|twitter\.com|reddit\.com|youtube\.com)\//i;
if (AUTO_SITE_RE.test(location.href)) {
  // content.js owns Alt+A on auto-sites; do nothing here.
} else {
  const w = window as unknown as { __ibtUniversal?: UniversalTranslator };

  function applyVisual(s: Settings) {
    applyRootState({
      enabled: s.enabled, showOriginal: s.showOriginal, layout: s.layout, fontScale: s.fontScale,
      targetLangCode: s.targetLangCode, transStyle: s.transStyle, transColor: s.transColor,
      barStyle: s.barStyle, barColor: s.barColor,
    });
  }

  async function onAltA(): Promise<void> {
    // Already translated → cycle the 3-state display (pure CSS).
    if (w.__ibtUniversal) { toast(VIEW_LABEL[cycleView()]); return; }

    let settings = await loadSettings();
    applyVisual(settings);

    const uni = new UniversalTranslator(() => settings);
    w.__ibtUniversal = uni;
    onSettingsChanged((s) => { settings = s; applyVisual(s); uni.setSettings(s); });
    uni.activate();
  }

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (
      e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey &&
      (e.key === 'a' || e.key === 'A')
    ) {
      e.preventDefault();
      e.stopPropagation();
      onAltA().catch(() => {});
    }
  }, true);
}
