import type { FasorxIdentity } from './identity';

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
  constructor(
    private readonly identity: FasorxIdentity,
    private readonly base = '/api',
  ) {}

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
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
    const res = await this.send(path, { headers: await this.authHeaders() });
    if (!res.ok) throw await toError(res);
    return res;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers = await this.authHeaders();
    if (method !== 'GET') headers['X-Requested-With'] = 'fetch';
    const init: RequestInit = { method, headers, credentials: 'same-origin' };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await this.send(path, init);
    if (!res.ok) throw await toError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Authenticated download: saves as `filename`, or opens in a new tab when omitted. */
  async download(path: string, filename?: string): Promise<void> {
    const tab = filename ? null : window.open('', '_blank');
    try {
      const url = URL.createObjectURL(await (await this.getRaw(path)).blob());
      if (tab) {
        tab.location.href = url;
      } else {
        const a = Object.assign(document.createElement('a'), {
          href: url,
          download: filename ?? '',
        });
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      tab?.close();
      throw e;
    }
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.identity.token();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    const res = await fetch(this.base + path, init);
    if (res.status === 401 && this.identity.enabled && !this.identity.goToLoginGuarded()) {
      throw new ApiError(
        401,
        'Sua sessão no FasorX está ativa, mas esta aplicação não conseguiu confirmá-la. Tente de novo em instantes.',
      );
    }
    return res;
  }
}

async function toError(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const message = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
  return new ApiError(res.status, message ?? res.statusText);
}
