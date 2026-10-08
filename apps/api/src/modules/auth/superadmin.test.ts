import { describe, expect, it } from 'vitest';
import { isSuperadmin } from './superadmin';

const cfg = (SUPERADMIN_EMAILS?: string) => ({ SUPERADMIN_EMAILS }) as never;

describe('isSuperadmin', () => {
  it('matches the configured e-mails, case-insensitively, ignoring spaces', () => {
    const c = cfg(' Admin@Uni.edu , boss@uni.edu ');
    expect(isSuperadmin('admin@uni.edu', c)).toBe(true);
    expect(isSuperadmin('BOSS@uni.edu', c)).toBe(true);
    expect(isSuperadmin('student@uni.edu', c)).toBe(false);
  });

  it('treats the local user as admin and no one else when the list is empty', () => {
    expect(isSuperadmin('local@localhost', cfg(undefined))).toBe(true);
    expect(isSuperadmin('anyone@uni.edu', cfg(''))).toBe(false);
  });
});
