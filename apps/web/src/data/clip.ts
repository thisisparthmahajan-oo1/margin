/**
 * Experimental "Save to Margin" bookmarklet, for sites that block Margin's server (e.g. behind a
 * Cloudflare challenge). Your browser has already got past the block, so the bookmarklet takes the
 * page from there: it strips what extraction doesn't need, gzips it and opens Margin's /clip page in
 * the same tab with the page in the URL fragment. A fragment never leaves the browser, and opening a
 * page is allowed even where the site's CSP blocks requests to other servers (or COOP cuts popups off),
 * so no token ever enters the site's page: /clip saves it with this device's own sign-in.
 */

/** Longest fragment the bookmarklet sends; Chrome stops at 2 MB of URL. */
export const CLIP_FRAGMENT_MAX = 1_500_000;

/**
 * The bookmarklet itself. It runs on the site's page, so it must be self-contained: everything it
 * uses is a parameter or a browser global. `go` opens the URL it builds (`location.assign` there).
 */
export async function clipPage(origin: string, max: number, doc: Document, go: (href: string) => void, warn: (m: string) => void) {
  const root = doc.documentElement.cloneNode(true) as HTMLElement;
  root
    .querySelectorAll('script:not([type="application/ld+json"]),style,link,noscript,svg,template,iframe:not([src*="youtube"]):not([src*="vimeo"])')
    .forEach((e) => e.remove());
  const gzipped = new Response('<!doctype html>' + root.outerHTML).body!.pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(gzipped).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const data = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (data.length > max) return warn('This page is too large for Save to Margin.');
  go(`${origin}/clip#u=${encodeURIComponent(doc.location.href)}&h=${data}`);
}

/** The `javascript:` address to save as a bookmark, for the Margin at `origin`. */
export const bookmarkletFor = (origin: string) =>
  'javascript:' +
  encodeURIComponent(
    `(${clipPage.toString()})(${JSON.stringify(origin)},${CLIP_FRAGMENT_MAX},document,h=>location.assign(h),m=>alert(m))`,
  );

/** Reads what the bookmarklet sent (`#u=…&h=…`); null if it isn't a clip or is damaged. */
export async function decodeClip(hash: string): Promise<{ url: string; html: string } | null> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const url = params.get('u');
  const data = params.get('h');
  if (!url || !data) return null;
  try {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    const html = await new Response(new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'))).text();
    return { url, html };
  } catch {
    return null;
  }
}
