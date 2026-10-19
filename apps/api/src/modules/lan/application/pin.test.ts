import { describe, expect, it } from 'vitest';
import { generatePin, hashPin, isPin, verifyPin } from './pin';

describe('pin', () => {
  it('generates four-digit pins', () => {
    for (let i = 0; i < 50; i++) expect(isPin(generatePin())).toBe(true);
  });

  it('isPin accepts exactly four digits', () => {
    expect(isPin('0000')).toBe(true);
    expect(isPin('9999')).toBe(true);
    expect(isPin('123')).toBe(false);
    expect(isPin('12345')).toBe(false);
    expect(isPin('12a4')).toBe(false);
    expect(isPin('')).toBe(false);
  });

  it('hashes and verifies a pin, rejecting a wrong one', async () => {
    const stored = await hashPin('4821');
    // `salt:hash`, both 16+ byte hex — not the plaintext. (A substring check would be flaky: the
    // hex can coincidentally contain the 4 digits.)
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(await verifyPin('4821', stored)).toBe(true);
    expect(await verifyPin('4822', stored)).toBe(false);
  });

  it('salts, so the same pin hashes differently each time', async () => {
    expect(await hashPin('1234')).not.toBe(await hashPin('1234'));
  });

  it('rejects a malformed stored hash', async () => {
    expect(await verifyPin('1234', 'nope')).toBe(false);
    expect(await verifyPin('1234', '')).toBe(false);
    expect(await verifyPin('1234', 'abcd:')).toBe(false);
  });
});
