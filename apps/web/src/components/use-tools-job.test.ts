import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolsService } from '../services/tools.service';
import { waitForJob } from './use-tools-job';

describe('waitForJob', () => {
  afterEach(() => vi.useRealTimers());
  const stuck = () =>
    ({ jobStatus: vi.fn().mockResolvedValue({ state: 'active' }) }) as unknown as ToolsService;

  it('gives up on a job still running after 5 min', async () => {
    vi.useFakeTimers();
    const done = expect(waitForJob(stuck(), 'p1', 'j1')).rejects.toThrow(/Tempo esgotado/);
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1500);
    await done;
  });

  it('stops polling once aborted', async () => {
    vi.useFakeTimers();
    const tools = stuck();
    const ctrl = new AbortController();
    const done = expect(waitForJob(tools, 'p1', 'j1', ctrl.signal)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3000);
    ctrl.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    expect(tools.jobStatus).toHaveBeenCalledTimes(2);
  });
});
