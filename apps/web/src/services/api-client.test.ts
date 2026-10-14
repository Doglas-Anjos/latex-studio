import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api-client';
import type { FasorxIdentity } from './identity';

const identity = (token: string | null, breakerOpen = false) =>
  ({
    enabled: true,
    token: async () => token,
    goToLogin: vi.fn(),
    goToLoginGuarded: vi.fn(() => !breakerOpen),
  }) as unknown as FasorxIdentity;

describe('ApiClient on 401', () => {
  afterEach(() => vi.unstubAllGlobals());
  const unauthorized = () =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

  it('goes to login without the breaker when FasorX gave no token (no session there)', async () => {
    unauthorized();
    const id = identity(null);
    await expect(new ApiClient(id).get('/me')).rejects.toThrow('Entrando…');
    expect(id.goToLogin).toHaveBeenCalled();
    expect(id.goToLoginGuarded).not.toHaveBeenCalled();
  });

  it('uses the breaker when this API refused a fresh FasorX token', async () => {
    unauthorized();
    const id = identity('t', true);
    await expect(new ApiClient(id).get('/me')).rejects.toThrow(/não conseguiu confirmá-la/);
    expect(id.goToLoginGuarded).toHaveBeenCalled();
    expect(id.goToLogin).not.toHaveBeenCalled();
  });
});
