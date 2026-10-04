import type { JobStatus, ToolsService } from '../services/tools.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls a tools job until it ends; a failed job becomes a thrown Error. */
export async function waitForJob<T>(
  tools: ToolsService,
  projectId: string,
  jobId: string,
): Promise<T | undefined> {
  for (;;) {
    await sleep(1500);
    const job: JobStatus<T> = await tools.jobStatus<T>(projectId, jobId);
    if (job.state === 'completed') return job.result;
    if (job.state === 'failed') throw new Error(job.error || 'Falhou');
  }
}
