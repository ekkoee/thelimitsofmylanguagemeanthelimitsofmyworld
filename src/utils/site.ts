import { SiteId } from '../core/types';

export function detectSite(host = location.hostname): SiteId | null {
  if (host === 'x.com' || host.endsWith('.x.com') || host.endsWith('twitter.com')) return 'x';
  if (host.endsWith('reddit.com')) return 'reddit';
  if (host.endsWith('youtube.com')) return 'youtube';
  return null;
}
