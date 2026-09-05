import {
  API_VERSION,
  type ApiErrorCode,
  type ApiErrorEnvelope,
  isApiErrorEnvelope,
} from '@quest/types';

/**
 * Typed HTTP client used by mobile, web and admin. Deliberately small: it standardises base URL,
 * version prefix, correlation ids, JSON handling, timeouts and error-envelope parsing. Feature
 * code layers typed endpoint functions on top (Phase 01+); it never calls fetch directly.
 */
export interface ApiClientOptions {
  baseUrl: string;
  /** Returns a bearer token (or null when signed out). Wired by Identity in Phase 01. */
  getAccessToken?: () => Promise<string | null> | string | null;
  /** Default request timeout. */
  timeoutMs?: number;
  /** Injected for tests / environments without a global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for deterministic ids in tests. */
  generateId?: () => string;
  /** Called for every response — hook for analytics/telemetry. */
  onResponse?: (info: {
    method: string;
    path: string;
    status: number;
    durationMs: number;
    correlationId?: string;
  }) => void;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** Supply to join an existing user journey; otherwise a new id is generated. */
  correlationId?: string;
  /** Idempotency key for unsafe methods (server support arrives with the first mutating endpoint). */
  idempotencyKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Skip the /v1 prefix (health endpoints are version-neutral). */
  versionNeutral?: boolean;
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode | 'NETWORK_ERROR' | 'TIMEOUT' | 'UNKNOWN',
    message: string,
    public readonly correlationId?: string,
    public readonly envelope?: ApiErrorEnvelope,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  get isRetryable(): boolean {
    return (
      this.code === 'NETWORK_ERROR' ||
      this.code === 'TIMEOUT' ||
      this.code === 'SERVICE_UNAVAILABLE' ||
      this.code === 'RATE_LIMITED'
    );
  }
}

function defaultId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly generateId: () => string;

  constructor(private readonly options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    const f = options.fetchImpl ?? globalThis.fetch;
    if (!f) throw new Error('No fetch implementation available');
    this.fetchImpl = f;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.generateId = options.generateId ?? defaultId;
  }

  buildUrl(path: string, opts: Pick<RequestOptions, 'query' | 'versionNeutral'> = {}): string {
    const clean = path.startsWith('/') ? path : `/${path}`;
    const prefix = opts.versionNeutral ? '' : `/${API_VERSION}`;
    const url = new URL(`${this.baseUrl}${prefix}${clean}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? 'GET';
    const correlationId = opts.correlationId ?? this.generateId();
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-correlation-id': correlationId,
      ...opts.headers,
    };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    const token = await this.options.getAccessToken?.();
    if (token) headers.authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.timeoutMs);
    opts.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    const started = Date.now();
    const url = this.buildUrl(path, opts);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeout);
      const aborted = controller.signal.aborted;
      throw new ApiClientError(
        0,
        aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
        aborted ? 'Request timed out' : 'Network request failed',
        correlationId,
      );
    }
    clearTimeout(timeout);

    const serverCorrelationId = response.headers.get('x-correlation-id') ?? correlationId;
    this.options.onResponse?.({
      method,
      path,
      status: response.status,
      durationMs: Date.now() - started,
      correlationId: serverCorrelationId,
    });

    const text = await response.text();
    const json: unknown = text ? safeJson(text) : undefined;

    if (!response.ok) {
      if (isApiErrorEnvelope(json)) {
        throw new ApiClientError(
          response.status,
          json.error.code,
          json.error.message,
          json.error.correlationId,
          json,
        );
      }
      throw new ApiClientError(
        response.status,
        'UNKNOWN',
        `Request failed with status ${response.status}`,
        serverCorrelationId,
      );
    }
    return json as T;
  }

  get<T>(path: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...opts, method: 'GET' });
  }
  post<T>(
    path: string,
    body?: unknown,
    opts: Omit<RequestOptions, 'method' | 'body'> = {},
  ): Promise<T> {
    return this.request<T>(path, { ...opts, method: 'POST', body });
  }
  put<T>(
    path: string,
    body?: unknown,
    opts: Omit<RequestOptions, 'method' | 'body'> = {},
  ): Promise<T> {
    return this.request<T>(path, { ...opts, method: 'PUT', body });
  }
  patch<T>(
    path: string,
    body?: unknown,
    opts: Omit<RequestOptions, 'method' | 'body'> = {},
  ): Promise<T> {
    return this.request<T>(path, { ...opts, method: 'PATCH', body });
  }
  delete<T>(path: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...opts, method: 'DELETE' });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}
