import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LEN = 32;

/** A uniform random 4-digit PIN as a string, "0000"–"9999". */
export function generatePin(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}

/** Exactly four ASCII digits. */
export const isPin = (pin: string): boolean => /^\d{4}$/.test(pin);

/**
 * scrypt hash of a PIN as `salt:hash` (hex). Salted so equal PINs differ at rest, and slow so a
 * brute force of the 10k space costs real time; the per-attempt lockout is the other half.
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(pin, salt, KEY_LEN)) as Buffer;
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/** Constant-time check of a PIN against a stored `salt:hash`. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length === 0) return false;
  const actual = (await scryptAsync(pin, Buffer.from(saltHex, 'hex'), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
