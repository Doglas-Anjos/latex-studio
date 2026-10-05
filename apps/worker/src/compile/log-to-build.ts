export type FinishedStatus = 'succeeded' | 'failed' | 'timeout' | 'cancelled';

/**
 * A build succeeds if it left a PDF and either exited 0 or was asked to keep going past errors;
 * a killed run is a timeout or, when the user stopped it, cancelled.
 */
export function toBuildStatus(run: {
  exitCode: number;
  timedOut: boolean;
  cancelled?: boolean | undefined;
  pdfExists: boolean;
  haltOnError?: boolean | undefined;
}): FinishedStatus {
  if (run.cancelled) return 'cancelled';
  if (run.timedOut) return 'timeout';
  if (!run.pdfExists) return 'failed';
  return run.exitCode === 0 || run.haltOnError === false ? 'succeeded' : 'failed';
}
