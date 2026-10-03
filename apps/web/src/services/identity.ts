import { createToken } from '../di/container';

const MARGIN_MS = 30_000;
const PING_MS = 4 * 60 * 1000;
const BREAKER_KEY = 'latex:went-to-login';

/** Identity from the external FasorX authenticator. Token lives in memory only. */
export class FasorxIdentity {
  readonly enabled: boolean;
  private tokenValue: string | null = null;
  private expires = 0;
  private signOutUrl = '';
  private complete = '';
  private inflight: Promise<string | null> | null = null;

  constructor(private readonly cfg: { url: string; app: string }) {
    this.enabled = cfg.url !== '';
  }

  /** Current token, renewed when needed. Null only in local mode or without a session. */
  async token(): Promise<string | null> {
    if (!this.enabled) return null;
    if (this.tokenValue !== null && Date.now() < this.expires - MARGIN_MS) return this.tokenValue;
    this.inflight ??= this.fetchToken().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  goToLogin(): void {
    if (this.enabled) window.location.href = this.loginUrl();
  }

  /** Like goToLogin, but returns false when we already went there less than 60 s ago. */
  goToLoginGuarded(): boolean {
    if (!this.enabled) return false;
    try {
      const before = Number(window.sessionStorage.getItem(BREAKER_KEY) || 0);
      if (Date.now() - before < 60_000) return false;
      window.sessionStorage.setItem(BREAKER_KEY, String(Date.now()));
    } catch {
      // no sessionStorage: proceed without the breaker
    }
    window.location.href = this.loginUrl();
    return true;
  }

  signOut(): void {
    if (!this.enabled) return;
    this.tokenValue = null;
    this.expires = 0;
    window.location.href = this.signOutUrl || `${this.cfg.url}/sair/`;
  }

  /** Renews every 4 min while visible (and on tab focus); calls onSignedOut when the session is gone. */
  watch(onSignedOut: () => void): () => void {
    if (!this.enabled) return () => {};
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        this.expires = 0;
        if ((await this.token()) === null) onSignedOut();
      } catch {
        // network trouble is not a signed-out session; retry next cycle
      }
    };
    const id = window.setInterval(check, PING_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }

  private loginUrl(): string {
    const target = this.complete || `${this.cfg.url}/entrar/`;
    return `${target}${target.includes('?') ? '&' : '?'}volta=${this.cfg.app}`;
  }

  private async fetchToken(): Promise<string | null> {
    const { url, app } = this.cfg;
    const res = await fetch(`${url}/api/token/${app}`, { method: 'POST', credentials: 'include' });
    if (res.status === 401 || res.status === 403) {
      this.tokenValue = null;
      this.expires = 0;
      this.complete = '';
      const body = (await res.json().catch(() => null)) as { completar?: unknown } | null;
      if (typeof body?.completar === 'string' && body.completar.startsWith(`${url}/`)) {
        this.complete = body.completar;
      }
      return null;
    }
    if (!res.ok) throw new Error(`token: ${res.status}`);
    const j = (await res.json()) as { token: string; validade: number; sair?: string };
    this.tokenValue = j.token;
    this.expires = Date.now() + j.validade * 1000;
    if (typeof j.sair === 'string' && j.sair.startsWith(`${url}/`)) this.signOutUrl = j.sair;
    return this.tokenValue;
  }
}

export const IdentityToken = createToken<FasorxIdentity>('Identity');
