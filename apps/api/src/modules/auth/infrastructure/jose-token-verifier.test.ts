import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { JoseTokenVerifier } from './jose-token-verifier';

const SECRET = 's'.repeat(32);
const key = new TextEncoder().encode(SECRET);
const verifier = new JoseTokenVerifier({
  AUTH_SECRET: SECRET,
  AUTH_ISSUER: 'https://fasorx.example',
  AUTH_AUDIENCE: 'latex',
  AUTH_MAX_TOKEN_TTL_S: 900,
});

const sign = (claims: Record<string, unknown>, exp = '5m', k = key) =>
  new SignJWT({
    iss: 'https://fasorx.example',
    aud: 'latex',
    sub: 'u-1',
    email: 'Ana@Example.com',
    name: 'Ana',
    ...claims,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(exp)
    .sign(k);

describe('JoseTokenVerifier', () => {
  it('accepts a valid token and normalizes the identity', async () => {
    const result = await verifier.verify(await sign({ name: ' Ana\u0007 ' }));
    expect(result?.identity).toEqual({
      issuer: 'https://fasorx.example',
      subject: 'u-1',
      email: 'ana@example.com',
      name: 'Ana',
    });
    expect(result?.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('refuses a wrong secret, a wrong audience, a missing email and a lifetime above the cap', async () => {
    const other = new TextEncoder().encode('t'.repeat(32));
    expect(await verifier.verify(await sign({}, '5m', other))).toBeNull();
    expect(await verifier.verify(await sign({ aud: 'other-app' }))).toBeNull();
    expect(await verifier.verify(await sign({ email: undefined }))).toBeNull();
    expect(await verifier.verify(await sign({ iss: undefined }))).toBeNull();
    expect(await verifier.verify(await sign({ sub: 42 }))).toBeNull();
    expect(await verifier.verify(await sign({}, '2h'))).toBeNull();
    expect(await verifier.verify('not-a-jwt')).toBeNull();
  });
});
