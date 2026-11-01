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
import { loadSettings, onSettingsChanged, saveSettings } from '../core/storage';
import { applyRootState, cycleView, VIEW_LABEL, watchTransSurfaces } from '../utils/dom';
import { UniversalTranslator, toast } from './universal';
import { Settings } from '../core/types';
import { isAltA } from './alt-a-key';
import { startLinkedIn } from './linkedin';
import { startImageTranslate } from './image-translate';
import { startSelectionTranslate } from './selection';

console.log('[IBT] content script loaded', location.hostname, location.href);
startImageTranslate();
startSelectionTranslate();
watchTransSurfaces();

const AUTO_SITE_RE = /^https?:\/\/([^/]*\.)?(x\.com|twitter\.com|reddit\.com|youtube\.com)\//i;
if (AUTO_SITE_RE.test(location.href)) {
  // content.js owns Alt+A on auto-sites; do nothing here.
  console.log('[IBT] auto-site, Alt+A owned by content.js', location.hostname);
} else {
  try {
  const w = window as unknown as { __ibtUniversal?: UniversalTranslator; __ibtAltAAt?: number };

  function applyVisual(s: Settings) {
    applyRootState({
      enabled: s.enabled, showOriginal: s.showOriginal, layout: s.layout, fontScale: s.fontScale,
      targetLangCode: s.targetLangCode, transStyle: s.transStyle, transColor: s.transColor,
      barStyle: s.barStyle, barColor: s.barColor, viewMode: s.viewMode,
      transHighlight: s.transHighlight, highlightColor: s.highlightColor,
    });
  }

  async function onAltA(): Promise<void> {
    const now = Date.now();
    // Page-world forward, this listener, and chrome.commands all see one keypress.
    if (now - (w.__ibtAltAAt || 0) < 500) {
      console.log('[IBT] Alt+A ignored, duplicate');
      return;
    }
    w.__ibtAltAAt = now;
    // Already translated → cycle the 3-state display (pure CSS).
    if (w.__ibtUniversal) {
      const next = cycleView();
      toast(VIEW_LABEL[next]);
      void saveSettings({ viewMode: next });
      return;
    }

    let settings = await loadSettings();
    applyVisual(settings);

    const uni = new UniversalTranslator(() => settings);
    w.__ibtUniversal = uni;
    onSettingsChanged((s) => { settings = s; applyVisual(s); uni.setSettings(s); });
    uni.activate();
  }

  // Apply the saved color as soon as this script exists, and again if the
  // options page changes it. The stylesheet is injected with this script.
  onSettingsChanged((s) => applyVisual(s));
  loadSettings().then((s) => { if (!w.__ibtUniversal) applyVisual(s); }).catch(() => {});

  const onKey = (e: KeyboardEvent) => {
    if (!e.altKey) return;
    if (!isAltA(e)) return;
    console.log('[IBT] Alt+A received', location.hostname, e.code, e.key);
    e.preventDefault();
    e.stopPropagation();
    onAltA().catch((err) => console.log('[IBT] Alt+A failed', err));
  };
  console.log('[IBT] Alt+A listener ready (isolated)', location.hostname);
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('keydown', onKey, true);

  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data;
    if (!d || d.source !== 'ibt-alt-a' || d.type !== 'toggle') return;
    // MAIN-world postMessage is same-origin. Do not drop it when the isolated
    // window object is not === event.source.
    if (e.source !== window && e.origin !== location.origin) return;
    console.log('[IBT] Alt+A received (from page)', location.hostname);
    onAltA().catch((err) => console.log('[IBT] Alt+A failed', err));
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'ibt-toggle-page') return;
    console.log('[IBT] Alt+A received (popup/command)', location.hostname);
    onAltA()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.log('[IBT] Alt+A failed', err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  });
  startLinkedIn();
} catch (err) {
  console.log('[IBT] content script init failed', err);
}
}
