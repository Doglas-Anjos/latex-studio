export type FinishedStatus = 'succeeded' | 'failed' | 'timeout';

/** A build succeeds only if latexmk exited 0 and left a PDF; a killed run is a timeout. */
export function toBuildStatus(run: {
  exitCode: number;
  timedOut: boolean;
  pdfExists: boolean;
}): FinishedStatus {
  if (run.timedOut) return 'timeout';
  return run.exitCode === 0 && run.pdfExists ? 'succeeded' : 'failed';
}
