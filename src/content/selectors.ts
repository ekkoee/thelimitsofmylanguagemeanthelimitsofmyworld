// ⚠️ All site-specific selectors live here so they can be patched in one place
// when X / Reddit / YouTube change their DOM. Each entry lists fallbacks tried
// in order.

export const SELECTORS = {
  x: {
    // tweet body, replies, quoted tweets all share this testid
    text: ['[data-testid="tweetText"]'],
    bio: ['[data-testid="UserDescription"]'],
    // X Articles (long-form). ReadView wraps title + body; RichTextView/the
    // Draft.js content are the body. Order: broadest (incl. title) first.
    article: [
      '[data-testid="twitterArticleReadView"]',
      '[data-testid="twitterArticleRichTextView"]',
      '[data-testid="longformRichTextComponent"]',
    ],
    // primary content column — used to also pick up the article title (an <h1>)
    primaryColumn: ['[data-testid="primaryColumn"]'],
  },
  reddit: {
    title: ['[slot="title"]', 'a[slot="full-post-link"]', 'h1[slot="title"]'],
    body: ['[slot="text-body"] .md', '[slot="text-body"]', '[slot="post-rtjson-content"]'],
    comment: ['[id$="-comment-rtjson-content"]', 'shreddit-comment [slot="comment"] .md'],
  },
  youtube: {
    // live caption window rendered by the player
    captionWindow: ['.ytp-caption-window-container', '#ytp-caption-window-container'],
    captionWindowInner: ['.caption-window'],  // the positioned box that holds the text
    captionSegment: ['.ytp-caption-segment'],
    player: ['#movie_player', '.html5-video-player'],
  },
} as const;

export function queryFirst(selectors: readonly string[], root: ParentNode = document): Element[] {
  for (const sel of selectors) {
    const found = root.querySelectorAll(sel);
    if (found.length) return Array.from(found);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Per-site CORRECTION layer for the generic "translate any page" engine.
//
// The generic detector (content/blocks.ts) already works on most sites WITHOUT a
// rule — these are only a thin, OPTIONAL safety net for a few SPA sites. Keep them
// EXCLUDE-ONLY: a `closest(exclude)` that matches nothing is a harmless no-op, so a
// stale/guessed selector can never drop real content — it only ever removes chrome
// when it actually matches. Never put a post-body selector in `exclude`.
export interface SiteRule {
  /** Matched against location.hostname. */
  match: RegExp;
  /** Drop any generic unit whose element is inside one of these (UI chrome only). */
  exclude?: string;
}

export const SITE_RULES: SiteRule[] = [
  {
    // Mastodon / Soapbox family (Truth Social is a Soapbox fork). Class names vary
    // across forks, so these are safe no-ops where absent and only ever hit chrome.
    match: /(^|\.)truthsocial\.com$|(^|\.)mastodon|(^|\.)hachyderm\.io$/,
    exclude: [
      '[role="button"]', '[role="toolbar"]', '[role="menu"]',
      '.status__action-bar', '.status__relative-time', '.display-name', '.account',
      '.status__content__spoiler-link', '.status__content__translate-button',
      '.detailed-status__meta',
    ].join(','),
  },
  {
    // Facebook. The generic link-density/role gate already drops author names and
    // action affordances; this just hardens the interactive-role exclusions. No root
    // scoping (keeps the right-hand About panel translatable too).
    match: /(^|\.)facebook\.com$/,
    exclude: '[role="button"],[role="toolbar"],[role="menu"],[role="menuitem"]',
  },
];

export function matchSiteRule(hostname: string): SiteRule | null {
  return SITE_RULES.find((r) => r.match.test(hostname)) ?? null;
}
