import { expect, it } from 'vitest';
import { watchCancel } from './compile.processor';

it('keeps polling for cancellation after a failed query', async () => {
  const abort = new AbortController();
  let calls = 0;
  const watch = watchCancel(
    abort,
    async () => {
      if (++calls === 1) throw new Error('connection reset');
      return true;
    },
    5,
  );
  await new Promise((r) => abort.signal.addEventListener('abort', r));
  clearInterval(watch);
  expect(calls).toBeGreaterThanOrEqual(2);
});
