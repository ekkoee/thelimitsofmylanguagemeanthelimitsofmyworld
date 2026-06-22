// Optional, on-demand "double-click word popup" plumbing.
//
// The popup needs the content script to run on ANY page, which means broad host
// access. To keep the DEFAULT install at minimum privilege, we DON'T declare
// <all_urls> statically. Instead, when the user opts in (a toggle in the full
// settings), we request <all_urls> as an OPTIONAL host permission and then
// dynamically register the existing content bundle on every site.
//
// The auto-sites (X / Reddit / YouTube) already ship content.js via the static
// manifest, so we exclude them here to avoid injecting it twice.

const ALL_URLS = '<all_urls>';
const DBLCLICK_SCRIPT_ID = 'ibt-dblclick-popup';
const EXCLUDE_AUTO_SITES = [
  'https://x.com/*',
  'https://twitter.com/*',
  'https://www.reddit.com/*',
  'https://www.youtube.com/*',
];

/** Whether the user has already granted the broad <all_urls> host permission. */
export async function hasAllUrls(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [ALL_URLS] });
  } catch {
    return false;
  }
}

/** Ask the user for <all_urls>. MUST be called from a user gesture (e.g. a click
 *  in the options page). Resolves true only if the user accepts. */
export async function requestAllUrls(): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: [ALL_URLS] });
  } catch {
    return false;
  }
}

/** Register the content bundle on all (non-auto) sites. Idempotent. */
export async function registerDblClick(): Promise<void> {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [DBLCLICK_SCRIPT_ID] });
    if (existing.length) return;
    await chrome.scripting.registerContentScripts([{
      id: DBLCLICK_SCRIPT_ID,
      matches: [ALL_URLS],
      excludeMatches: EXCLUDE_AUTO_SITES,
      js: ['content.js'],
      runAt: 'document_idle',
      allFrames: false,
    }]);
  } catch (e) {
    console.log('[IBT] registerDblClick failed:', e);
  }
}

/** Remove the dynamic registration. Idempotent. */
export async function unregisterDblClick(): Promise<void> {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [DBLCLICK_SCRIPT_ID] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [DBLCLICK_SCRIPT_ID] });
  } catch (e) {
    console.log('[IBT] unregisterDblClick failed:', e);
  }
}

/** Turn the feature OFF and hand the broad permission back (least privilege). */
export async function disableDblClick(): Promise<void> {
  await unregisterDblClick();
  try {
    await chrome.permissions.remove({ origins: [ALL_URLS] });
  } catch {
    /* nothing else needs <all_urls>; ignore if removal isn't possible */
  }
}
