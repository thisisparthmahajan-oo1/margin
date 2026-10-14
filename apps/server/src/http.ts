const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * GET with a browser's headers. `userAgent` overrides it for sites that only serve their details to
 * link-preview bots (Spotify renders its pages in the browser otherwise).
 */
export async function httpGet(url: string, init: { timeoutMs?: number; accept?: string; userAgent?: string } = {}): Promise<Response> {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
    headers: {
      'user-agent': init.userAgent ?? BROWSER_UA,
      accept: init.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  return res;
}
