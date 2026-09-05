import { describe, expect, it, vi } from 'vitest';

import { ApiClient, ApiClientError } from './index';

function fakeFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  const impl: typeof fetch = (input, init) =>
    Promise.resolve(
      handler(
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        init ?? {},
      ),
    );
  return vi.fn(impl);
}

const ok = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('ApiClient', () => {
  it('prefixes the API version, serialises query params, and sends a correlation id', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const f = fakeFetch((url, init) => {
      seenUrl = url;
      seenHeaders = init.headers as Record<string, string>;
      return ok({ hello: 'world' });
    });
    const client = new ApiClient({
      baseUrl: 'https://api.example.com/',
      fetchImpl: f,
      generateId: () => 'corr-fixed-0001',
    });
    const out = await client.get<{ hello: string }>('/system/info', {
      query: { limit: 20, cursor: undefined, verbose: true },
    });
    expect(out).toEqual({ hello: 'world' });
    expect(seenUrl).toBe('https://api.example.com/v1/system/info?limit=20&verbose=true');
    expect(seenHeaders['x-correlation-id']).toBe('corr-fixed-0001');
    expect(seenHeaders.authorization).toBeUndefined();
  });

  it('supports version-neutral paths and bearer tokens from the provider', async () => {
    let seenUrl = '';
    let auth: string | undefined;
    const f = fakeFetch((url, init) => {
      seenUrl = url;
      auth = (init.headers as Record<string, string>).authorization;
      return ok({ status: 'ok' });
    });
    const client = new ApiClient({
      baseUrl: 'http://localhost:4000',
      fetchImpl: f,
      getAccessToken: () => 'tok',
    });
    await client.get('/health', { versionNeutral: true });
    expect(seenUrl).toBe('http://localhost:4000/health');
    expect(auth).toBe('Bearer tok');
  });

  it('parses the standard error envelope into a typed ApiClientError', async () => {
    const f = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Bad input',
              issues: [{ path: 'name', message: 'Required' }],
              correlationId: 'srv-corr',
              timestamp: 'x',
            },
          }),
          { status: 400, headers: { 'x-correlation-id': 'srv-corr' } },
        ),
    );
    const client = new ApiClient({ baseUrl: 'http://x', fetchImpl: f });
    const err = await client.post('/things', { name: '' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    const e = err as ApiClientError;
    expect(e.status).toBe(400);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.correlationId).toBe('srv-corr');
    expect(e.envelope?.error.issues?.[0]?.path).toBe('name');
    expect(e.isRetryable).toBe(false);
  });

  it('classifies non-envelope failures, network errors and timeouts', async () => {
    const html = new ApiClient({
      baseUrl: 'http://x',
      fetchImpl: fakeFetch(() => new Response('<html>502</html>', { status: 502 })),
    });
    await expect(html.get('/a')).rejects.toMatchObject({ code: 'UNKNOWN', status: 502 });

    const down = new ApiClient({
      baseUrl: 'http://x',
      fetchImpl: () => Promise.reject(new TypeError('fetch failed')),
    });
    const netErr = await down.get('/a').catch((e: unknown) => e as ApiClientError);
    expect(netErr).toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
    expect((netErr as ApiClientError).isRetryable).toBe(true);

    const slow = new ApiClient({
      baseUrl: 'http://x',
      timeoutMs: 20,
      fetchImpl: (_u, init) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    });
    await expect(slow.get('/a')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('reports every response to the telemetry hook and forwards idempotency keys', async () => {
    const onResponse = vi.fn();
    let key: string | undefined;
    const f = fakeFetch((_u, init) => {
      key = (init.headers as Record<string, string>)['idempotency-key'];
      return ok({}, { 'x-correlation-id': 'from-server' });
    });
    const client = new ApiClient({ baseUrl: 'http://x', fetchImpl: f, onResponse });
    await client.post('/things', { a: 1 }, { idempotencyKey: 'idem-1' });
    expect(key).toBe('idem-1');
    expect(onResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/things',
        status: 200,
        correlationId: 'from-server',
      }),
    );
  });
});
