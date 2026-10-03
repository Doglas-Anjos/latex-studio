import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Git and filesystem tests can exceed 5 s on Windows.
  test: { include: ['{apps,packages}/*/src/**/*.test.{ts,tsx}'], testTimeout: 15000 },
});
