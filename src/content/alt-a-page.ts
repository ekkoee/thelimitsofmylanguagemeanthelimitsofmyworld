// Page world, document_start. LinkedIn registers its own capture-phase key
// handler; stopImmediatePropagation there does not cross worlds reliably, and
// Alt+A often arrives as key "å". This listener is installed before page
// scripts and forwards the physical A key to the isolated content script.
console.log('[IBT] Alt+A listener ready', location.hostname);
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.repeat || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const k = e.key || '';
  if (e.code !== 'KeyA' && k !== 'a' && k !== 'A' && k !== 'å' && k !== 'Å') return;
  console.log('[IBT] Alt+A received (page)', location.hostname, e.code, e.key);
  e.preventDefault();
  e.stopPropagation();
  window.postMessage({ source: 'ibt-alt-a', type: 'toggle' }, '*');
}, true);
