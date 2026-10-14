import { useEffect, useRef } from 'react';
import { useService } from '../di/service-provider';
import { type JobStatus, type ToolsService, ToolsServiceToken } from '../services/tools.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = 1500;
const MAX_WAIT_MS = 5 * 60_000;

/**
 * Polls a tools job until it ends; a failed job becomes a thrown Error, and so does a job still
 * running after 5 min or an aborted `signal` (no one left to show the result to).
 */
export async function waitForJob<T>(
  tools: ToolsService,
  projectId: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<T | undefined> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    signal?.throwIfAborted();
    const job: JobStatus<T> = await tools.jobStatus<T>(projectId, jobId);
    if (job.state === 'completed') return job.result;
    if (job.state === 'failed') throw new Error(job.error || 'Falhou');
  }
  throw new Error('Tempo esgotado: o servidor não concluiu a tarefa');
}

/** `waitForJob` for this project, which stops polling once the calling component unmounts. */
export function useWaitForJob(projectId: string) {
  const tools = useService(ToolsServiceToken);
  const mounted = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    mounted.current = c;
    return () => c.abort();
  }, []);
  return <T>(jobId: string) => waitForJob<T>(tools, projectId, jobId, mounted.current?.signal);
}
