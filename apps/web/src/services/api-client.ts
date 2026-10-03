export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  constructor(private readonly base = '/api') {}

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  delete<T = void>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  /** Multipart upload. Never set Content-Type by hand: the browser adds the boundary. */
  postForm<T>(path: string, form: FormData): Promise<T> {
    return this.request<T>('POST', path, form);
  }

  /** GET for non-JSON bodies (text, binary). */
  async getRaw(path: string): Promise<Response> {
    const res = await fetch(this.base + path, { credentials: 'same-origin' });
    if (!res.ok) throw await toError(res);
    return res;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (method !== 'GET') headers['X-Requested-With'] = 'fetch';
    const init: RequestInit = { method, headers, credentials: 'same-origin' };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(this.base + path, init);
    if (!res.ok) throw await toError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

async function toError(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const message = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
  return new ApiError(res.status, message ?? res.statusText);
}
