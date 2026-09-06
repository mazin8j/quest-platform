/**
 * Same-origin assertion for every state-changing console route (audit P01-12).
 *
 * `SameSite=strict` on the session cookie stops cross-site form posts, but it is one attribute on
 * one cookie: a sibling subdomain is same-site, and a proxy or framework change that drops the
 * attribute would silently remove the only defence on staff sanction actions. `Sec-Fetch-Site`
 * (sent by every current browser) plus an `Origin` allow-list is a second, independent layer.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  const origin = request.headers.get('origin');
  if (origin === null) return fetchSite !== null; // no Origin and no Sec-Fetch-Site: refuse
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
