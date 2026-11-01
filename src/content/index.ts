import { detectSite } from '../utils/site';
import { loadSettings, onSettingsChanged, saveSettings } from '../core/storage';
import { applyRootState, cycleView, VIEW_LABEL } from '../utils/dom';
import { observeMutations, onUrlChange } from '../utils/observer';
import { Engine } from './engine';
import { scanTwitter } from './twitter';
import { redditAdapter } from './reddit';
import { startYouTube, updateYouTubeSettings } from './youtube';
import { startXVideo, updateXVideoSettings } from './x-video';
import { startNetflix, updateNetflixSettings } from './netflix';
import { isAltA } from './alt-a-key';
import { startWordPopup, stopWordPopup } from './word-popup';
import { Settings } from '../core/types';

// This script auto-runs on X / Reddit / YouTube (declared in the manifest). When the
// user opts in to "double-click word popup", it's ALSO dynamically registered on all
// other sites (see core/dblclick.ts) — there detectSite() is null, so only the popup
// runs. The "translate any page" feature is still injected on demand via Alt+A.
(async function main() {
  let settings = await loadSettings();

  // Double-click word popup — works on ANY page, gated purely by the setting, and
  // kept in sync if the user toggles it while the page is open.
  if (settings.dblClickTranslate) startWordPopup();
  onSettingsChanged((s) => { if (s.dblClickTranslate) startWordPopup(); else stopWordPopup(); });

  const site = detectSite();
  if (!site) return; // non-auto page: nothing below runs, only the word popup above

  // Netflix video subs only. Alt+A stays with the page translator (alt-a-global),
  // which skips the player. Browse pages are not an auto-site.
  if (site === 'netflix') {
    applyRoot(settings);
    let live = settings;
    startNetflix(() => live);
    onSettingsChanged((s) => { live = s; applyRoot(s); updateNetflixSettings(s); });
    return;
  }

  applyRoot(settings);

  // Alt+A (or the popup button) on these auto-sites cycles the 3-state display:
  // 原文 + 中文 → 只顯示原文 → 只顯示中文 → … (pure CSS, no re-translation).
  let lastDirectToggle = 0;
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'ibt-toggle-visibility') {
      // If our own keydown handler just toggled (<1s ago), skip — the SW
      // command and the keypress both fire for one Alt+A, don't double-toggle.
      if (Date.now() - lastDirectToggle < 1000) return;
      cycleAndSave();
    }
  });

  // Direct Alt+A keypress handling: works even when the chrome.commands binding
  // is missing/broken (e.g. new extension ID after re-install). The SW command
  // above is deduped via lastDirectToggle so a single press toggles once.
  window.addEventListener('keydown', (e) => {
    if (!isAltA(e)) return;
    e.preventDefault();
    lastDirectToggle = Date.now();
    cycleAndSave();
  }, true);

  if (site === 'youtube') {
    let live = settings;
    startYouTube(() => live);
    onSettingsChanged((s) => { live = s; applyRoot(s); updateYouTubeSettings(s); });
    return;
  }

  if (site === 'x') {
    let live = settings;
    startXVideo(() => live);
    const scan = () => scanTwitter(live);
    scan();
    observeMutations(document.body, scan, 300);
    onUrlChange(() => setTimeout(scan, 400));
    onSettingsChanged((s) => { live = s; settings = s; applyRoot(s); scan(); updateXVideoSettings(s); });
    return;
  }

  // reddit
  const engine = new Engine(redditAdapter, settings);
  const scan = () => engine.scan();
  scan();
  observeMutations(document.body, scan, 300);
  onUrlChange(() => setTimeout(scan, 400));
  onSettingsChanged((s) => { settings = s; applyRoot(s); engine.setSettings(s); scan(); });
})();

function cycleAndSave(): void {
  const next = cycleView();
  flash(VIEW_LABEL[next]);
  void saveSettings({ viewMode: next });
}

function applyRoot(s: Settings) {
  applyRootState({
    enabled: s.enabled, showOriginal: s.showOriginal, layout: s.layout, fontScale: s.fontScale,
    targetLangCode: s.targetLangCode, transStyle: s.transStyle, transColor: s.transColor,
    barStyle: s.barStyle, barColor: s.barColor,
    viewMode: s.viewMode,
  });
}

// brief toast for hotkey feedback on auto-sites
let fEl: HTMLDivElement | null = null;
let fTimer: number | undefined;
function flash(msg: string): void {
  if (!fEl) { fEl = document.createElement('div'); fEl.className = 'ibt-toast'; }
  fEl.textContent = msg;
  if (!fEl.isConnected) document.documentElement.appendChild(fEl);
  fEl.classList.add('ibt-toast-show');
  if (fTimer) clearTimeout(fTimer);
  fTimer = setTimeout(() => fEl?.classList.remove('ibt-toast-show'), 1800) as unknown as number;
}
