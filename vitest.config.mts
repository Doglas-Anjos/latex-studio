import { configDefaults, defineConfig } from 'vitest/config';

// `--mode latex` (pnpm test:latex) runs only the real-LaTeX suites (*.e2e.test.ts); they take
// minutes, so the default run leaves them out.
export default defineConfig(({ mode }) => ({
  test:
    mode === 'latex'
      ? { include: ['apps/*/src/**/*.e2e.test.ts'], testTimeout: 300_000 }
      : {
          include: ['{apps,packages}/*/src/**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, '**/*.e2e.test.ts'],
          // Git and filesystem tests can exceed 5 s on Windows.
          testTimeout: 15000,
        },
}));
