// Injected on demand by the background worker (via chrome.scripting) into the
// ACTIVE tab when the user presses the Alt+A command. Because it's injected on a
// user gesture under the activeTab permission, the extension does NOT need broad
// "all sites" host access — which keeps the Web Store review fast and clean.
import { loadSettings, onSettingsChanged } from '../core/storage';
import { applyRootState } from '../utils/dom';
import { UniversalTranslator } from './universal';
import { Settings } from '../core/types';

(async function () {
  const w = window as unknown as { __ibtUniversal?: UniversalTranslator };

  // Already injected on this page → just toggle on/off.
  if (w.__ibtUniversal) { w.__ibtUniversal.toggle(); return; }

  let settings = await loadSettings();
  applyVisual(settings);

  const uni = new UniversalTranslator(() => settings);
  w.__ibtUniversal = uni;

  // keep styles/colors/language live while options are changed
  onSettingsChanged((s) => { settings = s; applyVisual(s); uni.setSettings(s); });

  uni.toggle(); // first press → activate

  function applyVisual(s: Settings) {
    applyRootState({
      enabled: s.enabled, showOriginal: s.showOriginal, layout: s.layout, fontScale: s.fontScale,
      targetLangCode: s.targetLangCode, transStyle: s.transStyle, transColor: s.transColor,
    });
  }
})();
