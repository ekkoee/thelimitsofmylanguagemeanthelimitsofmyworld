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

/** X paints source chips, clocks, and captions inside these. Not tweet text. */
export const X_PLAYER_SELECTOR = '[data-testid="videoPlayer"], [data-testid="videoComponent"]';

export function insideXVideo(node: Node | null | undefined): boolean {
  if (!node) return false;
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return !!el?.closest(X_PLAYER_SELECTOR);
}

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
  /** Content that should still be translated even when it is only a short title. */
  include?: string;
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
  {
    // GitHub. The generic gate already skips buttons and short labels. This drops
    // the app header, search, and Copilot composer chrome, and keeps README /
    // issue / commit text even when the title is short.
    match: /(^|\.)github\.com$/,
    exclude: [
      'header', 'nav', 'footer',
      '.AppHeader', '.js-header-wrapper', '.Header',
      'qbsearch-input', '[role="search"]', '.AppHeader-search',
      '.copilot-chat-input', 'form.js-site-search-form',
    ].join(','),
    include: [
      '.markdown-body', '.js-issue-title', '.gh-header-title', '.markdown-title',
      '.comment-body', '.js-comment-body', '.review-comment',
      '.commit-title', '.commit-desc', '.commit-message',
      '[itemprop="description"]',
    ].join(','),
  },
  {
    // LinkedIn feed. Nav, the share box, and the Like/Comment bar are chrome.
    // Post bodies and comments stay in the generic prose path.
    match: /(^|\.)linkedin\.com$/,
    exclude: [
      'header', 'nav', 'footer',
      '.global-nav', '.scaffold-layout__aside',
      '.share-box-feed-entry__wrapper', '.share-creation-state',
      '.social-actions', '.feed-shared-social-action-bar',
      '.comments-comment-social-bar',
      '.feed-shared-see-translation-button',
      '[class*="see-translation"]',
      '[data-test-id*="translation"]',
    ].join(','),
    include: [
      '.update-components-text', '.feed-shared-update-v2__description',
      '.feed-shared-inline-show-more-text', '.comments-comment-item__main-content',
      '[data-test-id="main-feed-activity-card__commentary"]',
      '.attributed-text-segment-list__content',
    ].join(','),
  },
  {
    // Netflix player chrome and the timed-text layer. Browse titles stay on the
    // generic page path. The video overlay is drawn separately.
    match: /(^|\.)netflix\.com$/,
    exclude: [
      '.watch-video', '[data-uia="watch-video"]', '.watch-video--player-view',
      '.player-timedtext', '[data-uia="player-timedtext"]', '[data-uia="player"]',
      '.NFPlayer', '.nf-player-container', '.AkiraPlayer',
      '.PlayerControlsNeo__layout', '[data-uia="controls-standard"]',
      '[data-uia="player-controls"]',
    ].join(','),
  },
];

export function matchSiteRule(hostname: string): SiteRule | null {
  return SITE_RULES.find((r) => r.match.test(hostname)) ?? null;
}
