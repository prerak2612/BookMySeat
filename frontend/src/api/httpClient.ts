/**
 * Single HTTP gateway for the whole UI. Unwraps the API's `{ success, data | error }` envelope,
 * attaches the bearer token and turns every failure (HTTP error or network error) into ApiError,
 * so components handle errors one way.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isConflict(): boolean {
    return this.status === 409 || this.status === 410;
  }
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export type TokenProvider = () => string | null;

export class HttpClient {
  private onUnauthorized: (() => void) | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly getToken: TokenProvider,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  setUnauthorizedHandler(handler: () => void): void {
    this.onUnauthorized = handler;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, body, headers);
  }
  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }
  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const token = this.getToken();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
    }

    let payload: { success?: boolean; data?: T; error?: { code: string; message: string; details?: unknown } } = {};
    try {
      payload = await res.json();
    } catch {
      /* non-JSON response */
    }
    if (!res.ok || payload.success === false) {
      const err = payload.error ?? { code: 'HTTP_ERROR', message: `Request failed (${res.status})` };
      if (res.status === 401 && token) this.onUnauthorized?.();
      throw new ApiError(res.status, err.code, err.message, err.details);
    }
    return payload.data as T;
  }
}

/** Human-friendly text for an error, including field-level validation details. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
      const parts = err.details.map((d) => (typeof d === 'string' ? d : `${(d as { path: string }).path}: ${(d as { message: string }).message}`));
      return `${err.message}: ${parts.join('; ')}`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Unexpected error';
}
