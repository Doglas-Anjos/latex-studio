export const DOCUMENT_SYNC = Symbol('DOCUMENT_SYNC');

/**
 * Keeps collaborative documents in step with REST writes to the working tree. Callers run it
 * inside their own `ProjectLock.run`; implementations must not take the lock.
 */
export interface DocumentSync {
  /** The file now holds `text`: patch the open doc, or drop the saved state so it reloads. */
  replaceText(projectId: string, path: string, text: string): Promise<void>;
  /** The file was renamed or deleted: close the open doc and drop its saved state. */
  forget(projectId: string, path: string): Promise<void>;
}
