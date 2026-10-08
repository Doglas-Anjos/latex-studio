import { describe, expect, it } from 'vitest';
import { bwrapArgs, Sandbox } from './sandbox';

describe('bwrapArgs', () => {
  const args = bwrapArgs('/tmp/ls-build-x', { PATH: '/usr/bin', HOME: '/tmp', EMPTY: undefined });
  const flag = (name: string) => args.indexOf(name);

  it('confines to the work dir read-write and the system read-only', () => {
    expect(args).toContain('--unshare-all'); // no network, fresh pid namespace
    expect(args).toContain('--clearenv');
    expect(args).toContain('--die-with-parent');
    // The only writable bind is the work dir.
    const binds = args.flatMap((a, i) => (a === '--bind' ? [args[i + 1]] : []));
    expect(binds).toEqual(['/tmp/ls-build-x']);
    expect(args.slice(flag('--ro-bind'), flag('--ro-bind') + 3)).toEqual([
      '--ro-bind',
      '/usr',
      '/usr',
    ]);
    expect(args.at(-1)).toBe('/tmp/ls-build-x'); // --chdir target
  });

  it('passes only defined env through, and mounts tmpfs before the work dir', () => {
    expect(args).toContain('--setenv');
    const home = args.indexOf('HOME');
    expect(args[home + 1]).toBe('/tmp');
    expect(args).not.toContain('EMPTY'); // undefined values are dropped
    // A snapshot that lives under /tmp must be re-bound on top of the private tmpfs.
    expect(flag('--tmpfs')).toBeLessThan(flag('--bind'));
  });
});

describe('Sandbox (inactive)', () => {
  const s = new Sandbox({ COMPILE_SANDBOX: 'off' } as never);

  it('runs the command directly until bootstrap activates it', () => {
    expect(s.enabled).toBe(false);
    const spec = s.spawn('latexmk', ['-pdf', 'main.tex'], '/w', { HOME: '/h' });
    expect(spec.file).toBe('latexmk');
    expect(spec.args).toEqual(['-pdf', 'main.tex']);
    expect(spec.env).toEqual({ HOME: '/h' });
  });
});
