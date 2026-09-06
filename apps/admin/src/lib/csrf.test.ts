import { describe, expect, it } from 'vitest';

import { isSameOriginRequest } from './csrf';

const req = (headers: Record<string, string>) =>
  new Request('https://admin.quest.example/api/accounts/abc/suspend', {
    method: 'POST',
    headers,
  });

/**
 * Audit P01-12: staff sanction routes must not rely on the session cookie's `SameSite=strict`
 * attribute as their only CSRF defence.
 */
describe('admin console same-origin guard', () => {
  it('accepts a form posted from the console itself', () => {
    expect(
      isSameOriginRequest(
        req({ origin: 'https://admin.quest.example', 'sec-fetch-site': 'same-origin' }),
      ),
    ).toBe(true);
  });

  it('rejects a cross-site or sibling-subdomain post', () => {
    expect(
      isSameOriginRequest(req({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })),
    ).toBe(false);
    // Same registrable domain, different origin: `SameSite=strict` would allow this one.
    expect(
      isSameOriginRequest(
        req({ origin: 'https://content.quest.example', 'sec-fetch-site': 'same-site' }),
      ),
    ).toBe(false);
  });

  it('rejects a request that carries neither header, and a malformed Origin', () => {
    expect(isSameOriginRequest(req({}))).toBe(false);
    expect(isSameOriginRequest(req({ origin: 'not a url', 'sec-fetch-site': 'same-origin' }))).toBe(
      false,
    );
  });
});
