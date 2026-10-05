export const DOCUMENT_SYNC = Symbol('DOCUMENT_SYNC');

/**
 * Keeps collaborative documents in step with REST writes to the working tree. Callers run it
 * inside their own `ProjectLock.run`; implementations must not take the lock.
 */
export interface DocumentSync {
  /** The file now holds `text`: patch the open doc, or the saved state when it is not open. */
  replaceText(projectId: string, path: string, text: string): Promise<void>;
  /** The file was renamed or deleted: close the open doc and drop its saved state. */
  forget(projectId: string, path: string): Promise<void>;
  /**
   * Writes the open doc's current state and text now instead of waiting out the 2-10s debounce,
   * so a just-typed edit reaches the working tree before a caller reads or commits it. Always
   * writes when the doc is open, even with no debounce pending (a disk write from an earlier,
   * still in-flight store cannot be trusted to be current). A no-op only when the doc is not open.
   */
  flush(projectId: string, path: string): Promise<void>;
}
