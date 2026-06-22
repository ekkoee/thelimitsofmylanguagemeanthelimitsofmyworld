// Debounced MutationObserver wrapper. Dynamic feeds (X/Reddit/YouTube) mutate
// constantly; we coalesce bursts into a single scan.
export function observeMutations(target: Node, onChange: () => void, delay = 250): MutationObserver {
  let timer: number | undefined;
  const obs = new MutationObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, delay) as unknown as number;
  });
  obs.observe(target, { childList: true, subtree: true });
  return obs;
}

// SPA URL-change detection (history API + popstate). YouTube/Reddit/X navigate
// without full reloads.
export function onUrlChange(cb: (url: string) => void): void {
  let last = location.href;
  const fire = () => {
    if (location.href !== last) { last = location.href; cb(last); }
  };
  const wrap = (k: 'pushState' | 'replaceState') => {
    const orig = history[k];
    history[k] = function (this: History, ...args: any[]) {
      const r = orig.apply(this, args as any);
      fire();
      return r;
    } as any;
  };
  wrap('pushState');
  wrap('replaceState');
  window.addEventListener('popstate', fire);
  // YouTube fires this custom event on navigation
  window.addEventListener('yt-navigate-finish', fire as EventListener);
}
