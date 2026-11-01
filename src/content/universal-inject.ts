// Injected on demand by the background worker (via chrome.scripting) into the
// ACTIVE tab when the user presses the Alt+A command. Because it's injected on a
// user gesture under the activeTab permission, the extension does NOT need broad
// "all sites" host access — which keeps the Web Store review fast and clean.
import { loadSettings, onSettingsChanged, saveSettings } from '../core/storage';
import { setUiLang, watchUiLang } from '../core/i18n';
import { applyRootState, cycleView, viewLabel } from '../utils/dom';
import { UniversalTranslator, toast } from './universal';
import { Settings } from '../core/types';
import { startLinkedIn } from './linkedin';

(async function () {
  try { startLinkedIn(); } catch (err) { console.log('[IBT] LinkedIn watcher failed', err); }
  const w = window as unknown as { __ibtUniversal?: UniversalTranslator; __ibtAltAAt?: number };

  // Already translated this page → each subsequent Alt+A cycles the 3-state
  // display (original+translation → original → translation → …), pure CSS, no re-translation.
  // The content-script listener and chrome.commands can both see one keypress.
  if (w.__ibtUniversal) {
    if (Date.now() - (w.__ibtAltAAt || 0) < 800) return;
    const next = cycleView();
    toast(viewLabel(next));
    void saveSettings({ viewMode: next });
    return;
  }
  w.__ibtAltAAt = Date.now();

  let settings = await loadSettings();
  applyVisual(settings); // also sets the default 'both' view

  const uni = new UniversalTranslator(() => settings);
  w.__ibtUniversal = uni;

  // keep styles/colors/language live while options are changed
  onSettingsChanged((s) => { settings = s; applyVisual(s); uni.setSettings(s); });

  watchUiLang();
  uni.activate();

  function applyVisual(s: Settings) {
    setUiLang(s.uiLang || '');
    applyRootState({
      enabled: s.enabled, showOriginal: s.showOriginal, layout: s.layout, fontScale: s.fontScale,
      targetLangCode: s.targetLangCode, transStyle: s.transStyle, transColor: s.transColor,
      barStyle: s.barStyle, barColor: s.barColor, viewMode: s.viewMode,
      transHighlight: s.transHighlight, highlightColor: s.highlightColor,
    });
  }
})();
