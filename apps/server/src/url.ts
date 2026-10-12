const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref_src|ref_url|igshid)$/i;
/** X share links append ?s=..&t=..; these mean nothing elsewhere so they're only stripped on x.com. */
const X_SHARE_PARAMS = /^(s|t)$/i;

const HOST_ALIASES: Record<string, string> = {
  'twitter.com': 'x.com',
  'mobile.twitter.com': 'x.com',
  'mobile.x.com': 'x.com',
};

/** Parses user input into an http(s) URL, tolerating a missing scheme. */
export function parseUserUrl(input: string): URL | null {
  const trimmed = input.trim();
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Key used for de-duplication: same article saved twice from different share links collapses to one. */
export function canonicalize(url: URL): string {
  const u = new URL(url.href);
  u.hash = '';
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.hostname = HOST_ALIASES[u.hostname] ?? u.hostname;
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key) || (u.hostname === 'x.com' && X_SHARE_PARAMS.test(key))) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.href;
}
