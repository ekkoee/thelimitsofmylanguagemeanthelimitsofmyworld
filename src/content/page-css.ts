import cssText from '../styles/bilingual.css';

/** Inject bilingual.css into the page.
 *  Manifest content_scripts only ship it to X / Reddit / YouTube. Alt+A on any
 *  other site used to insert `.ibt-block` nodes with no stylesheet, so the
 *  host page's `div` rules (flex, absolute, width) placed the translation
 *  wherever they liked. A style tag at the end of <head> also wins same-specificity
 *  ties against stylesheets that loaded earlier. */
export function ensureIbtCss(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('ibt-css')) return;
  const style = document.createElement('style');
  style.id = 'ibt-css';
  style.textContent = cssText;
  (document.head || document.documentElement).appendChild(style);
}
