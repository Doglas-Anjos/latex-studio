// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FasorxIdentity } from './identity';

const URL = 'https://fasorx.test';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('FasorxIdentity', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns null without fetching in local mode', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await new FasorxIdentity({ url: '', app: 'latex' }).token()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches the token and shares one in-flight fetch', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => json(200, { token: 't1', validade: 300 }));
    vi.stubGlobal('fetch', fetchMock);
    const id = new FasorxIdentity({ url: URL, app: 'latex' });
    const all = await Promise.all([id.token(), id.token(), id.token()]);
    expect(all).toEqual(['t1', 't1', 't1']);
    await id.token();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('yields null on 401 from the token endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => json(401, {})),
    );
    expect(await new FasorxIdentity({ url: URL, app: 'latex' }).token()).toBeNull();
  });
});
